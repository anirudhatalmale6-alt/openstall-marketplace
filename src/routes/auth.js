const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { slugify } = require('../helpers');
const { flash, requireUser } = require('../guards');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', email: '' });
});

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { title: 'Sign in', email, error: 'That email and password do not match.' });
  }
  req.session.uid = user.id;
  const to = req.session.returnTo || (user.role === 'admin' ? '/admin' : '/');
  delete req.session.returnTo;
  flash(req, 'ok', `Welcome back, ${user.name.split(' ')[0]}.`);
  res.redirect(to);
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Create an account', form: {} });
});

router.post('/register', (req, res) => {
  const form = {
    name: String(req.body.name || '').trim(),
    email: String(req.body.email || '').trim().toLowerCase(),
  };
  const password = String(req.body.password || '');
  const errors = [];
  if (form.name.length < 2) errors.push('Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errors.push('Please enter a valid email address.');
  if (password.length < 8) errors.push('Password needs at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(form.email)) {
    errors.push('An account with that email already exists.');
  }
  if (errors.length) return res.status(400).render('register', { title: 'Create an account', form, errors });

  const id = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(form.name, form.email, bcrypt.hashSync(password, 10), 'buyer').lastInsertRowid;
  req.session.uid = id;
  flash(req, 'ok', 'Account created. Happy browsing.');
  res.redirect(req.session.returnTo || '/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---- becoming a seller ---------------------------------------------------
router.get('/sell', (req, res) => {
  if (req.vendor) return res.redirect('/seller');
  res.render('sell', { title: 'Open a shop', form: {} });
});

router.post('/sell', requireUser, (req, res) => {
  if (req.vendor) return res.redirect('/seller');

  const form = {
    shop_name: String(req.body.shop_name || '').trim(),
    tagline: String(req.body.tagline || '').trim(),
    description: String(req.body.description || '').trim(),
  };
  const errors = [];
  if (form.shop_name.length < 3) errors.push('Shop name needs at least 3 characters.');
  let slug = slugify(form.shop_name);
  if (db.prepare('SELECT 1 FROM vendors WHERE slug = ?').get(slug)) {
    slug = `${slug}-${Math.floor(Date.now() / 1000) % 10000}`;
  }
  if (errors.length) return res.status(400).render('sell', { title: 'Open a shop', form, errors });

  db.prepare(
    `INSERT INTO vendors (user_id, shop_name, slug, tagline, description, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(req.user.id, form.shop_name, slug, form.tagline, form.description);
  db.prepare(`UPDATE users SET role = 'seller' WHERE id = ? AND role = 'buyer'`).run(req.user.id);

  flash(req, 'ok', 'Application received. You can add products now - they go live once an admin approves the shop.');
  res.redirect('/seller');
});

module.exports = router;
