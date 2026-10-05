function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireUser(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    flash(req, 'info', 'Please sign in to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireSeller(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (!req.vendor) return res.redirect('/sell');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res
      .status(403)
      .render('error', { title: 'Admins only', code: 403, message: 'You need an admin account to open this page.' });
  }
  next();
}

module.exports = { flash, requireUser, requireSeller, requireAdmin };
