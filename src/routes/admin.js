const express = require('express');
const db = require('../db');
const { slugify } = require('../helpers');
const { flash, requireAdmin } = require('../guards');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const kpi = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM users)                              AS users,
              (SELECT COUNT(*) FROM vendors WHERE status='approved')    AS shops,
              (SELECT COUNT(*) FROM vendors WHERE status='pending')     AS pending,
              (SELECT COUNT(*) FROM products WHERE status='active')     AS products,
              (SELECT COUNT(*) FROM orders WHERE status IN ('paid','shipped','delivered'))        AS orders,
              (SELECT COALESCE(SUM(total_cents),0) FROM orders
                 WHERE status IN ('paid','shipped','delivered'))                                  AS gmv,
              (SELECT COALESCE(SUM(oi.commission_cents),0) FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE o.status IN ('paid','shipped','delivered'))                                AS commission,
              (SELECT COUNT(*) FROM orders WHERE status = 'awaiting_payment')                     AS unpaid`
    )
    .get();

  const byVendor = db
    .prepare(
      `SELECT v.shop_name, v.slug, v.commission_rate,
              COALESCE(SUM(oi.unit_price_cents * oi.qty), 0) AS gross,
              COALESCE(SUM(oi.commission_cents), 0)          AS commission,
              COALESCE(SUM(oi.qty), 0)                       AS units
       FROM vendors v
       LEFT JOIN order_items oi ON oi.vendor_id = v.id
         AND oi.order_id IN (SELECT id FROM orders WHERE status IN ('paid','shipped','delivered'))
       WHERE v.status = 'approved'
       GROUP BY v.id ORDER BY gross DESC`
    )
    .all();

  const recent = db
    .prepare(
      `SELECT o.*, u.name AS buyer, COUNT(oi.id) AS items
       FROM orders o JOIN users u ON u.id = o.buyer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id ORDER BY o.id DESC LIMIT 8`
    )
    .all();

  const pending = db.prepare(`SELECT * FROM vendors WHERE status = 'pending' ORDER BY id`).all();

  res.render('admin/dashboard', { title: 'Admin', kpi, byVendor, recent, pending });
});

router.get('/vendors', (req, res) => {
  const vendors = db
    .prepare(
      `SELECT v.*, u.name AS owner, u.email,
              (SELECT COUNT(*) FROM products WHERE vendor_id = v.id) AS products,
              (SELECT COALESCE(SUM(unit_price_cents*qty),0) FROM order_items WHERE vendor_id = v.id) AS gross
       FROM vendors v JOIN users u ON u.id = v.user_id
       ORDER BY CASE v.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, v.shop_name`
    )
    .all();
  res.render('admin/vendors', { title: 'Shops', vendors });
});

router.post('/vendors/:id/status', (req, res) => {
  const status = ['approved', 'pending', 'suspended'].includes(req.body.status) ? req.body.status : null;
  if (status) {
    db.prepare('UPDATE vendors SET status = ? WHERE id = ?').run(status, parseInt(req.params.id, 10));
    flash(req, 'ok', `Shop marked ${status}.`);
  }
  res.redirect(req.get('Referer') || '/admin/vendors');
});

router.post('/vendors/:id/commission', (req, res) => {
  const pct = Number(req.body.commission_pct);
  if (isFinite(pct) && pct >= 0 && pct <= 50) {
    db.prepare('UPDATE vendors SET commission_rate = ? WHERE id = ?').run(pct / 100, parseInt(req.params.id, 10));
    flash(req, 'ok', `Commission set to ${pct}% for new orders.`);
  } else {
    flash(req, 'warn', 'Commission must be between 0 and 50 percent.');
  }
  res.redirect(req.get('Referer') || '/admin/vendors');
});

router.get('/products', (req, res) => {
  const products = db
    .prepare(
      `SELECT p.*, v.shop_name, v.slug AS shop_slug, v.status AS shop_status, c.name AS category
       FROM products p JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.id DESC`
    )
    .all();
  res.render('admin/products', { title: 'All products', products });
});

router.post('/products/:id/status', (req, res) => {
  const status = req.body.status === 'draft' ? 'draft' : 'active';
  db.prepare('UPDATE products SET status = ? WHERE id = ?').run(status, parseInt(req.params.id, 10));
  flash(req, 'ok', status === 'draft' ? 'Product unlisted.' : 'Product listed.');
  res.redirect(req.get('Referer') || '/admin/products');
});

router.get('/orders', (req, res) => {
  const orders = db
    .prepare(
      `SELECT o.*, u.name AS buyer, u.email,
              COUNT(oi.id) AS items,
              COALESCE(SUM(oi.commission_cents),0) AS commission
       FROM orders o JOIN users u ON u.id = o.buyer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY o.id ORDER BY o.id DESC`
    )
    .all();
  res.render('admin/orders', { title: 'Orders', orders });
});

router.post('/orders/:id/status', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id, 10));
  const status = ['shipped', 'delivered', 'cancelled'].includes(req.body.status) ? req.body.status : null;

  // Only the payment provider may mark an order paid. An admin can cancel an
  // unpaid order, but cannot declare that money arrived.
  if (!order) {
    flash(req, 'warn', 'That order no longer exists.');
  } else if (!status) {
    flash(req, 'warn', 'An order cannot be marked paid by hand - that comes from the payment provider.');
  } else if (order.status === 'awaiting_payment' && status !== 'cancelled') {
    flash(req, 'warn', `Order #${order.id} has not been paid yet, so it can only be cancelled.`);
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    flash(req, 'ok', `Order marked ${status}.`);
  }
  res.redirect(req.get('Referer') || '/admin/orders');
});

router.get('/categories', (req, res) => {
  const cats = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) AS products
       FROM categories c ORDER BY c.name`
    )
    .all();
  res.render('admin/categories', { title: 'Categories', cats });
});

router.post('/categories', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2) {
    flash(req, 'warn', 'Category name is too short.');
  } else if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slugify(name))) {
    flash(req, 'warn', 'That category already exists.');
  } else {
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slugify(name));
    flash(req, 'ok', `Added "${name}".`);
  }
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const used = db.prepare('SELECT COUNT(*) n FROM products WHERE category_id = ?').get(id).n;
  if (used) flash(req, 'warn', `That category still has ${used} product(s). Move them first.`);
  else {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    flash(req, 'ok', 'Category deleted.');
  }
  res.redirect('/admin/categories');
});

module.exports = router;
