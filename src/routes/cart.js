const express = require('express');
const db = require('../db');
const payments = require('../payments');
const { flash, requireUser } = require('../guards');

const router = express.Router();

const getLiveProduct = db.prepare(`
  SELECT p.*, v.shop_name, v.slug AS shop_slug, v.accent, v.commission_rate
  FROM products p JOIN vendors v ON v.id = p.vendor_id
  WHERE p.id = ? AND p.status = 'active' AND v.status = 'approved'
`);

/** Rebuild the cart from session ids, dropping anything no longer buyable. */
function readCart(req) {
  const raw = req.session.cart || {};
  const lines = [];
  let changed = false;

  for (const [id, wanted] of Object.entries(raw)) {
    const p = getLiveProduct.get(Number(id));
    if (!p || p.stock < 1) {
      delete raw[id];
      changed = true;
      continue;
    }
    const qty = Math.min(Math.max(1, Number(wanted) || 1), p.stock);
    if (qty !== Number(wanted)) {
      raw[id] = qty;
      changed = true;
    }
    lines.push({ product: p, qty, line_cents: p.price_cents * qty });
  }
  if (changed) req.session.cart = raw;

  const subtotal = lines.reduce((t, l) => t + l.line_cents, 0);
  const shipping = lines.length ? (subtotal >= 7500 ? 0 : 499) : 0;
  return { lines, subtotal, shipping, total: subtotal + shipping };
}

router.post('/cart/add', (req, res) => {
  const id = parseInt(req.body.product_id, 10);
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  const p = getLiveProduct.get(id);
  if (!p) {
    flash(req, 'warn', 'That item is no longer available.');
    return res.redirect(req.get('Referer') || '/');
  }
  const cart = req.session.cart || {};
  cart[id] = Math.min((cart[id] || 0) + qty, p.stock);
  req.session.cart = cart;
  flash(req, 'ok', `${p.title} added to your basket.`);
  res.redirect(req.body.redirect || '/cart');
});

router.post('/cart/update', (req, res) => {
  const cart = req.session.cart || {};
  const id = parseInt(req.body.product_id, 10);
  const qty = parseInt(req.body.qty, 10);
  if (!qty || qty < 1) delete cart[id];
  else cart[id] = qty;
  req.session.cart = cart;
  res.redirect('/cart');
});

router.post('/cart/remove', (req, res) => {
  const cart = req.session.cart || {};
  delete cart[parseInt(req.body.product_id, 10)];
  req.session.cart = cart;
  res.redirect('/cart');
});

router.get('/cart', (req, res) => {
  res.render('cart', { title: 'Your basket', cart: readCart(req) });
});

router.get('/checkout', requireUser, (req, res) => {
  const cart = readCart(req);
  if (!cart.lines.length) return res.redirect('/cart');
  res.render('checkout', { title: 'Checkout', cart, form: { ship_name: req.user.name } });
});

router.post('/checkout', requireUser, async (req, res, next) => {
  const cart = readCart(req);
  if (!cart.lines.length) return res.redirect('/cart');

  const form = {
    ship_name: String(req.body.ship_name || '').trim(),
    ship_address: String(req.body.ship_address || '').trim(),
    ship_city: String(req.body.ship_city || '').trim(),
    ship_zip: String(req.body.ship_zip || '').trim(),
    ship_country: String(req.body.ship_country || '').trim(),
  };
  const errors = [];
  if (form.ship_name.length < 2) errors.push('Delivery name is required.');
  if (form.ship_address.length < 4) errors.push('Street address is required.');
  if (form.ship_city.length < 2) errors.push('City is required.');
  if (form.ship_zip.length < 3) errors.push('Postcode is required.');
  if (form.ship_country.length < 2) errors.push('Country is required.');
  if (errors.length) return res.status(400).render('checkout', { title: 'Checkout', cart, form, errors });

  const place = db.transaction(() => {
    // Re-read stock inside the transaction so two buyers cannot oversell one unit.
    for (const line of cart.lines) {
      const fresh = db.prepare('SELECT stock FROM products WHERE id = ?').get(line.product.id);
      if (!fresh || fresh.stock < line.qty) {
        throw Object.assign(new Error('stock'), { soldOut: line.product.title });
      }
    }
    // Created unpaid. Only the payment provider may move it to 'paid'.
    const orderId = db
      .prepare(
        `INSERT INTO orders (buyer_id, total_cents, status, ship_name, ship_address, ship_city, ship_zip, ship_country)
         VALUES (?, ?, 'awaiting_payment', ?, ?, ?, ?, ?)`
      )
      .run(req.user.id, cart.total, form.ship_name, form.ship_address, form.ship_city, form.ship_zip, form.ship_country)
      .lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, vendor_id, title, unit_price_cents, qty, commission_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const line of cart.lines) {
      insItem.run(
        orderId,
        line.product.id,
        line.product.vendor_id,
        line.product.title,
        line.product.price_cents,
        line.qty,
        Math.round(line.line_cents * line.product.commission_rate)
      );
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(line.qty, line.product.id);
    }
    return orderId;
  });

  let orderId;
  try {
    orderId = place();
  } catch (err) {
    if (err.soldOut) {
      flash(req, 'warn', `Sorry - "${err.soldOut}" sold out while you were checking out. Please adjust your basket.`);
      return res.redirect('/cart');
    }
    throw err;
  }

  // Hand the order to whichever provider this deployment is configured with.
  const provider = payments.active();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  let outcome;
  try {
    outcome = await provider.begin({
      order,
      items,
      buyer: req.user,
      returnUrl: `/payments/return/${orderId}`,
    });
  } catch (err) {
    err.orderId = orderId;
    return next(err);
  }

  payments.record({
    orderId,
    provider: provider.name,
    reference: outcome.reference,
    status: outcome.status,
    amountCents: order.total_cents,
  });

  req.session.cart = {};

  if (outcome.status === 'paid') {
    db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(orderId);
    payments.markSettled({ orderId, provider: provider.name, reference: outcome.reference, status: 'paid' });
    flash(req, 'ok', 'Payment accepted. Your order is on its way.');
    return res.redirect(`/order/${orderId}`);
  }

  // Hosted checkout: the buyer pays on the provider's page and the webhook
  // confirms it. Coming back from the redirect is not proof of payment.
  return res.redirect(outcome.redirectUrl);
});

router.get('/order/:id', requireUser, (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!order) return next();
  if (order.buyer_id !== req.user.id && req.user.role !== 'admin') return next();

  const items = db
    .prepare(
      `SELECT oi.*, v.shop_name, v.slug AS shop_slug
       FROM order_items oi JOIN vendors v ON v.id = oi.vendor_id
       WHERE oi.order_id = ?`
    )
    .all(order.id);
  res.render('order', { title: `Order #${order.id}`, order, items });
});

router.get('/account/orders', requireUser, (req, res) => {
  const orders = db
    .prepare(
      `SELECT o.*, COUNT(oi.id) AS item_count
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.buyer_id = ? GROUP BY o.id ORDER BY o.id DESC`
    )
    .all(req.user.id);
  res.render('account-orders', { title: 'Your orders', orders });
});

module.exports = router;
