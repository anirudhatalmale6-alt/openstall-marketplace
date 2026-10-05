"""End-to-end journeys against the running marketplace, with screenshots."""
import os, re, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4310"
SHOTS = "/var/lib/freelancer/projects/40751506/screenshots"
os.makedirs(SHOTS, exist_ok=True)
PW = "demo1234"
fails = []

def check(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails.append(name)

def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"))

def login(page, email):
    page.goto(f"{BASE}/login")
    page.fill("input[name=email]", email)
    page.fill("input[name=password]", PW)
    page.click("form[action='/login'] button[type=submit]")
    page.wait_for_load_state()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_page(viewport={"width": 1280, "height": 800})

    # ---------- 1. storefront ----------
    ctx.goto(BASE)
    check("home renders hero", "marketplace for independent" in ctx.content())
    check("home shows product cards", ctx.locator("article.pcard").count() >= 8,
          str(ctx.locator("article.pcard").count()))
    shot(ctx, "01-home")

    ctx.goto(f"{BASE}/browse")
    n_all = ctx.locator("article.pcard").count()
    check("browse paginates at 12", n_all == 12, str(n_all))
    shot(ctx, "02-browse")

    # search
    ctx.fill("form.search input[name=q]", "chilli")
    ctx.click("form.search button")
    ctx.wait_for_load_state()
    check("search finds chilli products", ctx.locator("article.pcard").count() >= 2,
          str(ctx.locator("article.pcard").count()))

    # category filter
    ctx.goto(f"{BASE}/browse?cat=food-drink")
    check("category filter works", "Food & Drink" in ctx.inner_text("h1"))

    # price sort ascending really is ascending
    ctx.goto(f"{BASE}/browse?sort=price-asc")
    prices = [float(t.replace("$", "").split()[0])
              for t in ctx.locator("article.pcard .price").all_inner_texts()]
    check("price sort ascending", prices == sorted(prices), str(prices[:5]))

    # ---------- 2. product + shop pages ----------
    ctx.goto(f"{BASE}/product/1")
    check("product page has add-to-basket", ctx.locator("form[action='/cart/add'] button").count() == 1)
    shot(ctx, "03-product")

    ctx.goto(f"{BASE}/shop/kiln-clay")
    check("shop page lists its products", ctx.locator("article.pcard").count() == 5,
          str(ctx.locator("article.pcard").count()))
    shot(ctx, "04-shop")

    ctx.goto(f"{BASE}/shops")
    check("shops index hides pending shops", ctx.locator(".scard").count() == 6,
          str(ctx.locator(".scard").count()))

    # pending vendor must not be reachable publicly
    r = ctx.request.get(f"{BASE}/shop/verdant-plantworks")
    check("pending shop page is 404", r.status == 404, str(r.status))

    # ---------- 3. buyer journey: register -> cart -> checkout ----------
    email = "testbuyer@example.test"
    ctx.goto(f"{BASE}/register")
    ctx.fill("input[name=name]", "Test Buyer")
    ctx.fill("input[name=email]", email)
    ctx.fill("input[name=password]", "testpass123")
    ctx.click("form[action='/register'] button[type=submit]")
    ctx.wait_for_load_state()
    check("registration signs the user in", "Sign out" in ctx.content())

    # add two products from two different shops
    for pid in (1, 11):
        ctx.goto(f"{BASE}/product/{pid}")
        ctx.click("form[action='/cart/add'] button")
        ctx.wait_for_load_state()
    check("basket badge counts 2", ctx.locator("nav.main .basket .pill").inner_text() == "2",
          ctx.locator("nav.main .basket .pill").inner_text())
    ctx.goto(f"{BASE}/cart")
    check("cart shows 2 lines", ctx.locator(".cartline").count() == 2)
    shot(ctx, "05-cart")

    # quantity update
    ctx.locator(".cartline input[name=qty]").first.fill("3")
    ctx.locator(".cartline button:has-text('Update')").first.click()
    ctx.wait_for_load_state()
    check("qty update persists", ctx.locator(".cartline input[name=qty]").first.input_value() == "3",
          ctx.locator(".cartline input[name=qty]").first.input_value())

    ctx.click("a:has-text('Checkout')")
    ctx.wait_for_load_state()
    check("checkout reached", "/checkout" in ctx.url, ctx.url)
    shot(ctx, "06-checkout")

    # submit with a missing field -> validation must block
    ctx.fill("input[name=ship_address]", "")
    ctx.fill("input[name=ship_city]", "Bristol")
    ctx.fill("input[name=ship_zip]", "BS1 4TR")
    ctx.fill("input[name=ship_country]", "United Kingdom")
    ctx.eval_on_selector("form[action='/checkout']", "f => f.noValidate = true")
    ctx.click("form[action='/checkout'] button[type=submit]")
    ctx.wait_for_load_state()
    check("checkout rejects a missing address", "Street address is required" in ctx.content())

    ctx.fill("input[name=ship_address]", "14 Hollis Lane")
    ctx.click("form[action='/checkout'] button[type=submit]")
    ctx.wait_for_load_state()
    check("order confirmation reached", re.search(r"/order/\d+$", ctx.url) is not None, ctx.url)
    order_no = ctx.url.rsplit("/", 1)[1]
    body_txt = ctx.inner_text("body").upper()   # shop names render uppercase via CSS
    check("confirmation names both shops", "KILN & CLAY" in body_txt and "PIXEL FORGE" in body_txt)
    shot(ctx, "07-order")

    ctx.goto(f"{BASE}/cart")
    check("basket is empty after checkout", "basket is empty" in ctx.content())

    ctx.goto(f"{BASE}/account/orders")
    check("order appears in buyer history", f"#{order_no}" in ctx.content())
    shot(ctx, "08-account-orders")

    # another buyer must not read this order
    ctx2 = browser.new_page(viewport={"width": 1280, "height": 800})
    login(ctx2, "dana@example.test")
    r = ctx2.request.get(f"{BASE}/order/{order_no}")
    check("other buyers cannot open the order", r.status == 404, str(r.status))
    ctx2.close()

    # ---------- 4. seller journey ----------
    seller = browser.new_page(viewport={"width": 1280, "height": 800})
    login(seller, "meera@kilnandclay.test")
    seller.goto(f"{BASE}/seller")
    check("seller dashboard loads", "Kiln & Clay" in seller.inner_text("h1"))
    shot(seller, "09-seller-dashboard")

    seller.goto(f"{BASE}/seller/products/new")
    seller.fill("input[name=title]", "Glazed Butter Dish")
    seller.fill("textarea[name=description]", "Lidded stoneware butter dish in a cream glaze.")
    seller.fill("input[name=price]", "27.50")
    seller.fill("input[name=stock]", "6")
    seller.select_option("select[name=category_id]", label="Home & Living")
    seller.click("button:has-text('Save product')")
    seller.wait_for_load_state()
    check("new product saved", "Changes saved" in seller.content() or "saved" in seller.content())
    seller.goto(f"{BASE}/seller/products")
    check("new product listed in seller table", "Glazed Butter Dish" in seller.content())
    shot(seller, "10-seller-products")

    # it must be publicly visible straight away
    pub = browser.new_page(viewport={"width": 1280, "height": 800})
    pub.goto(f"{BASE}/browse?q=butter+dish")
    check("new product is public", "Glazed Butter Dish" in pub.content())

    # price validation
    seller.goto(f"{BASE}/seller/products/new")
    seller.fill("input[name=title]", "Bad Price Item")
    seller.fill("input[name=price]", "0")
    seller.select_option("select[name=category_id]", label="Home & Living")
    seller.eval_on_selector("form[enctype]", "f => f.noValidate = true")
    seller.click("button:has-text('Save product')")
    seller.wait_for_load_state()
    check("zero price rejected", "price greater than zero" in seller.content())

    # fulfilment: mark the new order's line shipped
    seller.goto(f"{BASE}/seller/orders")
    row = seller.locator(f"table.data tbody tr:has-text('#{order_no}')").first
    check("seller sees only their line of the order", row.count() == 1)
    row.locator("select[name=status]").select_option("shipped")
    row.locator("button:has-text('Save')").click()
    seller.wait_for_load_state()
    check("line marked shipped", "Marked as shipped" in seller.content())
    shot(seller, "11-seller-orders")

    # buyer sees the status change
    ctx.goto(f"{BASE}/order/{order_no}")
    check("buyer sees shipped badge", "shipped" in ctx.content())

    # seller cannot touch another shop's product
    r = seller.request.get(f"{BASE}/seller/products/11/edit")
    check("seller cannot edit another shop's product", r.status == 404, str(r.status))

    # ---------- 5. admin journey ----------
    admin = browser.new_page(viewport={"width": 1280, "height": 800})
    login(admin, "admin@demo.test")
    check("admin lands on the panel", "/admin" in admin.url, admin.url)
    check("admin shows commission", "Commission earned" in admin.content())
    shot(admin, "12-admin-overview")

    admin.goto(f"{BASE}/admin/vendors")
    shot(admin, "13-admin-shops")
    vrow = admin.locator("table.data tbody tr:has-text('Verdant Plantworks')").first
    vrow.locator("button:has-text('Approve')").click()
    admin.wait_for_load_state()
    check("vendor approved", "marked approved" in admin.content())
    pub.goto(f"{BASE}/shop/verdant-plantworks")
    check("approved shop now public", "Verdant Plantworks" in pub.content())

    # commission rate change
    admin.goto(f"{BASE}/admin/vendors")
    crow = admin.locator("table.data tbody tr:has-text('Kiln & Clay')").first
    crow.locator("input[name=commission_pct]").fill("18")
    crow.locator("button:has-text('Set')").click()
    admin.wait_for_load_state()
    check("commission updated", "Commission set to 18%" in admin.content())

    # unlist a product from admin, confirm it disappears from the storefront
    admin.goto(f"{BASE}/admin/products")
    prow = admin.locator("table.data tbody tr:has-text('Enamel Trail Mug')").first
    prow.locator("button:has-text('Unlist')").click()
    admin.wait_for_load_state()
    pub.goto(f"{BASE}/browse?q=Enamel+Trail+Mug")
    check("unlisted product hidden from buyers", pub.locator("article.pcard").count() == 0,
          str(pub.locator("article.pcard").count()))
    shot(admin, "14-admin-products")

    admin.goto(f"{BASE}/admin/orders")
    check("admin sees the new order", f"#{order_no}" in admin.content())
    shot(admin, "15-admin-orders")

    admin.goto(f"{BASE}/admin/categories")
    admin.fill("input[name=name]", "Stationery")
    admin.click("button:has-text('Add category')")
    admin.wait_for_load_state()
    check("category added", "Stationery" in admin.content())
    shot(admin, "16-admin-categories")

    # non-admin must be refused
    r = seller.request.get(f"{BASE}/admin")
    check("seller blocked from admin", r.status == 403, str(r.status))

    # ---------- 6. mobile view ----------
    m = browser.new_page(viewport={"width": 390, "height": 780})
    m.goto(BASE)
    shot(m, "17-mobile-home")
    home_w = m.evaluate("document.body.scrollWidth")
    m.goto(f"{BASE}/browse")
    shot(m, "18-mobile-browse")
    browse_w = m.evaluate("document.body.scrollWidth")
    m.goto(f"{BASE}/cart")
    cart_w = m.evaluate("document.body.scrollWidth")
    check("no horizontal overflow on mobile", max(home_w, browse_w, cart_w) <= 390,
          f"home={home_w} browse={browse_w} cart={cart_w}")
    m.close()

    browser.close()

print("\n%d checks failed" % len(fails))
if fails:
    print("failed:", ", ".join(fails))
sys.exit(1 if fails else 0)
