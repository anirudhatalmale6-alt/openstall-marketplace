const express = require('express');
const db = require('../db');
const payments = require('../payments');
const { flash, requireUser } = require('../guards');

const router = express.Router();

// Signature checks need the bytes as they arrived, not the parsed object.
const jsonWithRaw = express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
});

/**
 * Settle an order from a verified provider event. Idempotent: providers retry,
 * and a retry must not pay twice or restock twice.
 */
const applyEvent = db.transaction((order, provider, event) => {
  if (order.status !== 'awaiting_payment') return 'ignored';

  if (event.status === 'paid') {
    db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(order.id);
    payments.markSettled({
      orderId: order.id, provider: provider.name, reference: event.reference, status: 'paid',
    });
    return 'paid';
  }

  // Payment failed or was abandoned: release the stock we reserved at checkout.
  const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
  for (const it of items) {
    if (it.product_id) {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
    }
  }
  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(order.id);
  payments.markSettled({
    orderId: order.id, provider: provider.name, reference: event.reference, status: 'failed',
  });
  return 'failed';
});

router.post('/webhook/:provider', jsonWithRaw, async (req, res) => {
  const provider = payments.byName(req.params.provider);
  if (!provider) return res.status(404).json({ error: 'unknown provider' });

  let event = null;
  try {
    event = await provider.parseWebhook({
      headers: req.headers,
      rawBody: req.rawBody,
      body: req.body || {},
    });
  } catch (err) {
    console.error('webhook parse failed', err);
  }
  if (!event) return res.status(400).json({ error: 'rejected' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(event.orderId);
  if (!order) return res.status(404).json({ error: 'unknown order' });

  const result = applyEvent(order, provider, event);
  res.json({ ok: true, result });
});

/** Where a hosted provider sends the buyer back to. Never treat this as proof of payment. */
router.get('/return/:orderId', requireUser, (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.orderId, 10));
  if (!order || (order.buyer_id !== req.user.id && req.user.role !== 'admin')) return next();

  if (order.status === 'awaiting_payment') {
    flash(req, 'info', 'Thanks. We are waiting for your payment provider to confirm - this page updates once it does.');
  }
  res.redirect(`/order/${order.id}`);
});

// ---- sandbox provider's stand-in for a hosted payment page ----------------
router.get('/sandbox/:reference', requireUser, (req, res) => {
  res.render('sandbox-pay', {
    title: 'Sandbox checkout',
    reference: req.params.reference,
    returnUrl: req.query.return || '/',
  });
});

router.post('/sandbox/:reference/complete', requireUser, (req, res, next) => {
  const provider = payments.byName('sandbox-redirect');
  const row = db
    .prepare(`SELECT * FROM payments WHERE reference = ? AND provider = 'sandbox-redirect'`)
    .get(req.params.reference);
  if (!row) return next();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id);
  if (!order || order.buyer_id !== req.user.id) return next();

  // Same settlement path a verified webhook takes; the signature check itself
  // is exercised through POST /payments/webhook/sandbox-redirect.
  const result = applyEvent(order, provider, {
    orderId: order.id,
    reference: row.reference,
    status: req.body.outcome === 'pay' ? 'paid' : 'failed',
  });

  flash(req, result === 'paid' ? 'ok' : 'warn',
    result === 'paid' ? 'Payment accepted. Your order is on its way.'
                      : 'Payment was cancelled, so the order was not placed. Your items are back in stock.');
  res.redirect(`/order/${order.id}`);
});

module.exports = router;
