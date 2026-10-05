const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { slugify, parsePrice } = require('../helpers');
const { flash, requireSeller } = require('../guards');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads'),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

router.use(requireSeller);

router.get('/', (req, res) => {
  const v = req.vendor;
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(oi.unit_price_cents * oi.qty), 0) AS gross,
              COALESCE(SUM(oi.commission_cents), 0)          AS commission,
              COALESCE(SUM(oi.qty), 0)                       AS units,
              COUNT(DISTINCT oi.order_id)                    AS orders
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.vendor_id = ? AND o.status IN ('paid', 'shipped', 'delivered')`
    )
    .get(v.id);
  const open = db
    .prepare(
      `SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.vendor_id = ? AND oi.fulfil_status <> 'delivered'
         AND o.status IN ('paid', 'shipped', 'delivered')`
    )
    .get(v.id).n;
  const productCount = db.prepare('SELECT COUNT(*) n FROM products WHERE vendor_id = ?').get(v.id).n;
  const lowStock = db
    .prepare(`SELECT * FROM products WHERE vendor_id = ? AND stock <= 5 ORDER BY stock ASC LIMIT 6`)
    .all(v.id);
  const recent = db
    .prepare(
      `SELECT oi.*, o.placed_at, o.ship_name, o.id AS order_id
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.vendor_id = ? AND o.status IN ('paid', 'shipped', 'delivered')
       ORDER BY o.id DESC LIMIT 6`
    )
    .all(v.id);

  res.render('seller/dashboard', {
    title: 'Seller dashboard',
    totals: { ...totals, net: totals.gross - totals.commission },
    open,
    productCount,
    lowStock,
    recent,
  });
});

router.get('/products', (req, res) => {
  const products = db
    .prepare(
      `SELECT p.*, c.name AS category,
              (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE product_id = p.id) AS sold
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.vendor_id = ? ORDER BY p.id DESC`
    )
    .all(req.vendor.id);
  res.render('seller/products', { title: 'Your products', products });
});

router.get('/products/new', (req, res) => {
  res.render('seller/product-form', { title: 'Add a product', product: null, form: {}, errors: [] });
});

router.post('/products/new', upload.single('photo'), (req, res) => {
  const { form, errors } = readProductForm(req);
  if (errors.length) {
    return res.status(400).render('seller/product-form', { title: 'Add a product', product: null, form, errors });
  }
  const id = db
    .prepare(
      `INSERT INTO products (vendor_id, category_id, title, slug, description, price_cents, stock, image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.vendor.id, form.category_id, form.title, slugify(form.title), form.description,
      form.price_cents, form.stock, req.file ? req.file.filename : null, form.status
    ).lastInsertRowid;
  flash(req, 'ok', `"${form.title}" saved.`);
  res.redirect(`/seller/products/${id}/edit`);
});

router.get('/products/:id/edit', (req, res, next) => {
  const product = ownProduct(req);
  if (!product) return next();
  res.render('seller/product-form', {
    title: `Edit ${product.title}`,
    product,
    form: {
      title: product.title,
      description: product.description,
      price: (product.price_cents / 100).toFixed(2),
      stock: product.stock,
      category_id: product.category_id,
      status: product.status,
    },
    errors: [],
  });
});

router.post('/products/:id/edit', upload.single('photo'), (req, res, next) => {
  const product = ownProduct(req);
  if (!product) return next();
  const { form, errors } = readProductForm(req);
  if (errors.length) {
    return res
      .status(400)
      .render('seller/product-form', { title: `Edit ${product.title}`, product, form, errors });
  }
  db.prepare(
    `UPDATE products SET category_id = ?, title = ?, slug = ?, description = ?,
            price_cents = ?, stock = ?, status = ?, image = COALESCE(?, image)
     WHERE id = ? AND vendor_id = ?`
  ).run(
    form.category_id, form.title, slugify(form.title), form.description, form.price_cents,
    form.stock, form.status, req.file ? req.file.filename : null, product.id, req.vendor.id
  );
  flash(req, 'ok', 'Changes saved.');
  res.redirect('/seller/products');
});

router.post('/products/:id/delete', (req, res, next) => {
  const product = ownProduct(req);
  if (!product) return next();
  // Keep sold history intact: hide instead of deleting once it has been ordered.
  const sold = db.prepare('SELECT COUNT(*) n FROM order_items WHERE product_id = ?').get(product.id).n;
  if (sold) {
    db.prepare(`UPDATE products SET status = 'draft' WHERE id = ?`).run(product.id);
    flash(req, 'info', 'That product has past orders, so it was unlisted rather than deleted.');
  } else {
    db.prepare('DELETE FROM products WHERE id = ? AND vendor_id = ?').run(product.id, req.vendor.id);
    flash(req, 'ok', 'Product deleted.');
  }
  res.redirect('/seller/products');
});

router.get('/orders', (req, res) => {
  const items = db
    .prepare(
      `SELECT oi.*, o.placed_at, o.status AS order_status, o.ship_name, o.ship_address,
              o.ship_city, o.ship_zip, o.ship_country, o.id AS order_id, u.email AS buyer_email
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = o.buyer_id
       WHERE oi.vendor_id = ? AND o.status IN ('paid', 'shipped', 'delivered')
       ORDER BY o.id DESC`
    )
    .all(req.vendor.id);
  res.render('seller/orders', { title: 'Orders to fulfil', items });
});

router.post('/orders/item/:id/status', (req, res) => {
  const next = ['processing', 'shipped', 'delivered'].includes(req.body.status) ? req.body.status : null;
  if (next) {
    db.prepare('UPDATE order_items SET fulfil_status = ? WHERE id = ? AND vendor_id = ?')
      .run(next, parseInt(req.params.id, 10), req.vendor.id);
    syncOrderStatus(parseInt(req.body.order_id, 10));
    flash(req, 'ok', `Marked as ${next}.`);
  }
  res.redirect('/seller/orders');
});

router.get('/shop', (req, res) => {
  res.render('seller/shop-form', { title: 'Shop profile', form: req.vendor, errors: [] });
});

router.post('/shop', (req, res) => {
  const form = {
    ...req.vendor,
    shop_name: String(req.body.shop_name || '').trim(),
    tagline: String(req.body.tagline || '').trim(),
    description: String(req.body.description || '').trim(),
    accent: /^#[0-9a-fA-F]{6}$/.test(req.body.accent || '') ? req.body.accent : req.vendor.accent,
  };
  const errors = [];
  if (form.shop_name.length < 3) errors.push('Shop name needs at least 3 characters.');
  if (errors.length) return res.status(400).render('seller/shop-form', { title: 'Shop profile', form, errors });

  db.prepare('UPDATE vendors SET shop_name = ?, tagline = ?, description = ?, accent = ? WHERE id = ?')
    .run(form.shop_name, form.tagline, form.description, form.accent, req.vendor.id);
  flash(req, 'ok', 'Shop profile updated.');
  res.redirect('/seller/shop');
});

// ---- helpers -------------------------------------------------------------
function ownProduct(req) {
  return db
    .prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?')
    .get(parseInt(req.params.id, 10), req.vendor.id);
}

function readProductForm(req) {
  const form = {
    title: String(req.body.title || '').trim(),
    description: String(req.body.description || '').trim(),
    price: String(req.body.price || '').trim(),
    stock: String(req.body.stock || '').trim(),
    category_id: parseInt(req.body.category_id, 10) || null,
    status: req.body.status === 'draft' ? 'draft' : 'active',
  };
  const errors = [];
  if (form.title.length < 3) errors.push('Title needs at least 3 characters.');
  form.price_cents = parsePrice(form.price);
  if (form.price_cents === null) errors.push('Enter a price greater than zero.');
  form.stock = Math.max(0, parseInt(form.stock, 10) || 0);
  if (!form.category_id) errors.push('Pick a category.');
  return { form, errors };
}

/** An order is only "shipped"/"delivered" when every line from every shop is. */
function syncOrderStatus(orderId) {
  if (!orderId) return;
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  // Never drag an unpaid or cancelled order into a fulfilment state.
  if (!order || order.status === 'awaiting_payment' || order.status === 'cancelled') return;

  const rows = db.prepare('SELECT fulfil_status FROM order_items WHERE order_id = ?').all(orderId);
  if (!rows.length) return;
  const all = (s) => rows.every((r) => r.fulfil_status === s);
  const some = (s) => rows.some((r) => r.fulfil_status === s);
  const status = all('delivered') ? 'delivered' : some('shipped') || some('delivered') ? 'shipped' : 'paid';
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
}

module.exports = router;
