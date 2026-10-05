const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./src/db');
const { money, imgFor } = require('./src/helpers');

const app = express();
const PORT = process.env.PORT || 4310;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 14 },
  })
);

// ---- request context: current user, vendor, cart count, flash ------------
app.use((req, res, next) => {
  req.user = req.session.uid
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.session.uid)
    : null;
  req.vendor = req.user
    ? db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(req.user.id)
    : null;

  const cart = req.session.cart || {};
  res.locals.user = req.user;
  res.locals.vendor = req.vendor;
  res.locals.cartCount = Object.values(cart).reduce((t, q) => t + q, 0);
  res.locals.categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.locals.money = money;
  res.locals.imgFor = imgFor;
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  res.locals.q = '';
  delete req.session.flash;
  next();
});

app.use('/', require('./src/routes/shop'));
app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/cart'));
app.use('/seller', require('./src/routes/seller'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', code: 404, message: 'That page does not exist.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', code: 500, message: 'Something went wrong on our side.' });
});

app.listen(PORT, () => console.log(`marketplace listening on http://localhost:${PORT}`));
