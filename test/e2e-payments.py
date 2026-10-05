"""
Payment-layer journeys. Runs against a server started with
PAYMENT_PROVIDER=sandbox-redirect, i.e. the hosted-redirect shape where the
provider — not the buyer's browser — is what confirms a payment.

  PORT=4311 PAYMENT_PROVIDER=sandbox-redirect node server.js
  python3 test/e2e-payments.py
"""
import hashlib
import hmac
import json
import os
import sqlite3
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:4311")
DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "marketplace.db")
SECRET = os.environ.get("SANDBOX_WEBHOOK_SECRET", "sandbox-shared-secret")
PW = "demo1234"
fails = []


def check(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails.append(name)


def q1(sql, *args):
    con = sqlite3.connect(DB)
    try:
        row = con.execute(sql, args).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def sign(raw: str) -> str:
    return hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()


def login(page, email, password=PW):
    page.goto(f"{BASE}/login")
    page.fill("input[name=email]", email)
    page.fill("input[name=password]", password)
    page.click("form[action='/login'] button[type=submit]")
    page.wait_for_load_state()


def buy(page, product_id):
    """Put one product through checkout. Returns the new order id."""
    page.goto(f"{BASE}/product/{product_id}")
    page.click("form[action='/cart/add'] button")
    page.wait_for_load_state()
    page.goto(f"{BASE}/checkout")
    page.fill("input[name=ship_name]", "Pay Tester")
    page.fill("input[name=ship_address]", "14 Hollis Lane")
    page.fill("input[name=ship_city]", "Bristol")
    page.fill("input[name=ship_zip]", "BS1 4TR")
    page.fill("input[name=ship_country]", "United Kingdom")
    page.click("form[action='/checkout'] button[type=submit]")
    page.wait_for_load_state()
    return q1("SELECT MAX(id) FROM orders")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    # a buyer account that exists in every seeded database
    login(page, "dana@example.test")

    # ---------- 1. hosted redirect leaves the order unpaid ----------
    stock_before = q1("SELECT stock FROM products WHERE id = 1")
    order_id = buy(page, 1)

    check("buyer is sent to the provider's page", "/payments/sandbox/" in page.url, page.url)
    check("order starts unpaid",
          q1("SELECT status FROM orders WHERE id = ?", order_id) == "awaiting_payment",
          q1("SELECT status FROM orders WHERE id = ?", order_id))
    check("a pending payment row was written",
          q1("SELECT status FROM payments WHERE order_id = ?", order_id) == "pending")
    check("stock is reserved while payment is pending",
          q1("SELECT stock FROM products WHERE id = 1") == stock_before - 1)

    # ---------- 2. the unpaid order must not leak into the business ----------
    seller = browser.new_page(viewport={"width": 1280, "height": 800})
    login(seller, "meera@kilnandclay.test")
    seller.goto(f"{BASE}/seller/orders")
    check("seller cannot ship an unpaid order", f"#{order_id}" not in seller.inner_text("body"))

    gmv_before = q1("SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE status IN ('paid','shipped','delivered')")
    admin = browser.new_page(viewport={"width": 1280, "height": 800})
    login(admin, "admin@demo.test")
    admin.goto(f"{BASE}/admin")
    check("unpaid order is excluded from GMV", f"${gmv_before / 100:.2f}" in admin.inner_text("body"),
          f"${gmv_before / 100:.2f}")

    # an admin must not be able to declare that money arrived
    r = admin.request.post(f"{BASE}/admin/orders/{order_id}/status", form={"status": "paid"})
    check("admin cannot hand-mark an order paid",
          q1("SELECT status FROM orders WHERE id = ?", order_id) == "awaiting_payment",
          q1("SELECT status FROM orders WHERE id = ?", order_id))
    r = admin.request.post(f"{BASE}/admin/orders/{order_id}/status", form={"status": "shipped"})
    check("admin cannot ship an unpaid order",
          q1("SELECT status FROM orders WHERE id = ?", order_id) == "awaiting_payment",
          q1("SELECT status FROM orders WHERE id = ?", order_id))

    # ---------- 3. the webhook is what settles it ----------
    body = json.dumps({"order_id": order_id, "reference": "wrong", "status": "paid"})
    r = page.request.post(f"{BASE}/payments/webhook/sandbox-redirect",
                          data=body, headers={"content-type": "application/json",
                                              "x-sandbox-signature": "deadbeef"})
    check("unsigned webhook is rejected", r.status == 400, str(r.status))
    check("rejected webhook changed nothing",
          q1("SELECT status FROM orders WHERE id = ?", order_id) == "awaiting_payment")

    ref = q1("SELECT reference FROM payments WHERE order_id = ?", order_id)
    body = json.dumps({"order_id": order_id, "reference": ref, "status": "paid"})
    r = page.request.post(f"{BASE}/payments/webhook/sandbox-redirect",
                          data=body, headers={"content-type": "application/json",
                                              "x-sandbox-signature": sign(body)})
    check("signed webhook is accepted", r.status == 200, str(r.status))
    check("order is now paid", q1("SELECT status FROM orders WHERE id = ?", order_id) == "paid",
          q1("SELECT status FROM orders WHERE id = ?", order_id))
    check("payment row settled", q1("SELECT status FROM payments WHERE order_id = ?", order_id) == "paid")

    # providers retry; a retry must not double-apply
    r = page.request.post(f"{BASE}/payments/webhook/sandbox-redirect",
                          data=body, headers={"content-type": "application/json",
                                              "x-sandbox-signature": sign(body)})
    check("replayed webhook is ignored", r.json().get("result") == "ignored", str(r.json()))
    check("replay did not disturb stock",
          q1("SELECT stock FROM products WHERE id = 1") == stock_before - 1)

    # now it is a real order
    seller.goto(f"{BASE}/seller/orders")
    check("seller can ship it once paid", f"#{order_id}" in seller.inner_text("body"))

    # ---------- 4. a cancelled payment releases the stock ----------
    stock_before2 = q1("SELECT stock FROM products WHERE id = 2")
    order2 = buy(page, 2)
    check("second order is pending too",
          q1("SELECT status FROM orders WHERE id = ?", order2) == "awaiting_payment")
    check("stock held during pending", q1("SELECT stock FROM products WHERE id = 2") == stock_before2 - 1)

    page.click("button[value=cancel]")
    page.wait_for_load_state()
    check("cancelled payment cancels the order",
          q1("SELECT status FROM orders WHERE id = ?", order2) == "cancelled",
          q1("SELECT status FROM orders WHERE id = ?", order2))
    check("cancelled payment puts stock back",
          q1("SELECT stock FROM products WHERE id = 2") == stock_before2,
          f"{q1('SELECT stock FROM products WHERE id = 2')} vs {stock_before2}")
    check("buyer is told no money was taken", "no money was taken" in page.inner_text("body"))

    # ---------- 5. approving on the provider page settles it ----------
    order3 = buy(page, 3)
    page.click("button[value=pay]")
    page.wait_for_load_state()
    check("approved payment marks the order paid",
          q1("SELECT status FROM orders WHERE id = ?", order3) == "paid",
          q1("SELECT status FROM orders WHERE id = ?", order3))

    # ---------- 6. unknown provider ----------
    r = page.request.post(f"{BASE}/payments/webhook/not-a-provider",
                          data="{}", headers={"content-type": "application/json"})
    check("unknown provider webhook is 404", r.status == 404, str(r.status))

    browser.close()

print("\n%d checks failed" % len(fails))
if fails:
    print("failed:", ", ".join(fails))
sys.exit(1 if fails else 0)
