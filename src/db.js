const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'marketplace.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'buyer',   -- buyer | seller | admin
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_name       TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  tagline         TEXT    NOT NULL DEFAULT '',
  description     TEXT    NOT NULL DEFAULT '',
  accent          TEXT    NOT NULL DEFAULT '#3f6b5b',
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending | approved | suspended
  commission_rate REAL    NOT NULL DEFAULT 0.10,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  title       TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  stock       INTEGER NOT NULL DEFAULT 0,
  image       TEXT,                                   -- uploaded filename, else generated placeholder
  status      TEXT    NOT NULL DEFAULT 'active',      -- active | draft
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id     INTEGER NOT NULL REFERENCES users(id),
  total_cents  INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'paid',        -- paid | shipped | delivered | cancelled
  ship_name    TEXT    NOT NULL DEFAULT '',
  ship_address TEXT    NOT NULL DEFAULT '',
  ship_city    TEXT    NOT NULL DEFAULT '',
  ship_zip     TEXT    NOT NULL DEFAULT '',
  ship_country TEXT    NOT NULL DEFAULT '',
  placed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER REFERENCES products(id),
  vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
  title            TEXT    NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  qty              INTEGER NOT NULL,
  commission_cents INTEGER NOT NULL DEFAULT 0,
  fulfil_status    TEXT    NOT NULL DEFAULT 'processing' -- processing | shipped | delivered
);

CREATE INDEX IF NOT EXISTS idx_products_vendor   ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_items_order       ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_vendor      ON order_items(vendor_id);
`);

module.exports = db;
