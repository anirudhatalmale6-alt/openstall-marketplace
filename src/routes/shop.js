const express = require('express');
const db = require('../db');
const { artColors, initials } = require('../helpers');

const router = express.Router();
const PER_PAGE = 12;

const LIVE = `p.status = 'active' AND v.status = 'approved'`;

const SELECT_CARD = `
  SELECT p.*, v.shop_name, v.slug AS shop_slug, v.accent, c.name AS category
  FROM products p
  JOIN vendors v ON v.id = p.vendor_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

router.get('/', (req, res) => {
  const featured = db.prepare(`${SELECT_CARD} WHERE ${LIVE} ORDER BY p.id DESC LIMIT 8`).all();
  const popular = db
    .prepare(
      `SELECT p.*, v.shop_name, v.slug AS shop_slug, v.accent, c.name AS category,
              COALESCE(SUM(oi.qty), 0) AS sold
       FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN order_items oi ON oi.product_id = p.id
       WHERE ${LIVE}
       GROUP BY p.id ORDER BY sold DESC, p.id DESC LIMIT 4`
    )
    .all();
  const shops = db
    .prepare(
      `SELECT v.*, COUNT(p.id) AS product_count
       FROM vendors v LEFT JOIN products p ON p.vendor_id = v.id AND p.status = 'active'
       WHERE v.status = 'approved' GROUP BY v.id ORDER BY product_count DESC LIMIT 6`
    )
    .all();
  const counts = db
    .prepare(
      `SELECT c.name, c.slug, COUNT(p.id) AS n
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
       LEFT JOIN vendors v ON v.id = p.vendor_id AND v.status = 'approved'
       GROUP BY c.id ORDER BY c.name`
    )
    .all();
  const stats = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM vendors WHERE status='approved') AS shops,
              (SELECT COUNT(*) FROM products p JOIN vendors v ON v.id=p.vendor_id WHERE ${LIVE}) AS products,
              (SELECT COUNT(*) FROM orders) AS orders`
    )
    .get();

  res.render('home', { title: 'OpenStall - a marketplace for independent shops', featured, popular, shops, counts, stats });
});

router.get('/browse', (req, res) => {
  const q = (req.query.q || '').trim();
  const cat = (req.query.cat || '').trim();
  const sort = ['new', 'price-asc', 'price-desc'].includes(req.query.sort) ? req.query.sort : 'new';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const where = [LIVE];
  const params = {};
  if (q) {
    where.push('(p.title LIKE :q OR p.description LIKE :q OR v.shop_name LIKE :q)');
    params.q = `%${q}%`;
  }
  if (cat) {
    where.push('c.slug = :cat');
    params.cat = cat;
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = { new: 'p.id DESC', 'price-asc': 'p.price_cents ASC', 'price-desc': 'p.price_cents DESC' }[sort];

  const total = db
    .prepare(
      `SELECT COUNT(*) n FROM products p JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`
    )
    .get(params).n;

  const products = db
    .prepare(`${SELECT_CARD} ${whereSql} ORDER BY ${orderSql} LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`)
    .all(params);

  const activeCat = cat ? db.prepare('SELECT * FROM categories WHERE slug = ?').get(cat) : null;

  res.render('browse', {
    title: q ? `"${q}" - search` : activeCat ? activeCat.name : 'Browse everything',
    products,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PER_PAGE)),
    q,
    cat,
    sort,
    activeCat,
  });
});

router.get('/product/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const product = db
    .prepare(
      `SELECT p.*, v.shop_name, v.slug AS shop_slug, v.accent, v.tagline, c.name AS category, c.slug AS cat_slug
       FROM products p JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? AND ${LIVE}`
    )
    .get(id);
  if (!product) return next();

  const more = db
    .prepare(`${SELECT_CARD} WHERE ${LIVE} AND p.vendor_id = ? AND p.id <> ? ORDER BY p.id DESC LIMIT 4`)
    .all(product.vendor_id, product.id);
  const sold = db
    .prepare('SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE product_id = ?')
    .get(product.id).n;

  res.render('product', { title: product.title, product, more, sold });
});

router.get('/shop/:slug', (req, res, next) => {
  const vendor = db.prepare(`SELECT * FROM vendors WHERE slug = ? AND status = 'approved'`).get(req.params.slug);
  if (!vendor) return next();
  const products = db.prepare(`${SELECT_CARD} WHERE ${LIVE} AND v.id = ? ORDER BY p.id DESC`).all(vendor.id);
  const sold = db
    .prepare('SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE vendor_id = ?')
    .get(vendor.id).n;
  res.render('shop', { title: vendor.shop_name, vendor, products, sold });
});

router.get('/shops', (req, res) => {
  const shops = db
    .prepare(
      `SELECT v.*, COUNT(p.id) AS product_count
       FROM vendors v LEFT JOIN products p ON p.vendor_id = v.id AND p.status = 'active'
       WHERE v.status = 'approved' GROUP BY v.id ORDER BY v.shop_name`
    )
    .all();
  res.render('shops', { title: 'All shops', shops });
});

// Generated cover art, so a product without a photo still looks deliberate.
router.get('/img/p/:id', (req, res) => {
  const p = db
    .prepare('SELECT p.id, p.title, v.accent FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = ?')
    .get(parseInt(req.params.id, 10));
  const title = p ? p.title : 'Item';
  const [c1, c2] = artColors(title);
  const accent = p ? p.accent : '#3f6b5b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <circle cx="470" cy="140" r="150" fill="${accent}" opacity="0.16"/>
  <circle cx="150" cy="470" r="190" fill="#ffffff" opacity="0.14"/>
  <text x="300" y="330" text-anchor="middle" font-family="Georgia,serif" font-size="180"
        fill="${accent}" opacity="0.72">${escapeXml(initials(title))}</text>
</svg>`;
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

module.exports = router;
