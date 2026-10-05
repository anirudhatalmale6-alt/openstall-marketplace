const db = require('../db');

const providers = new Map();

function register(provider) {
  providers.set(provider.name, provider);
  return provider;
}

register(require('./demo'));
register(require('./sandbox-redirect'));

/** The provider this deployment is configured to use. */
function active() {
  const name = process.env.PAYMENT_PROVIDER || 'demo';
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(
      `Unknown PAYMENT_PROVIDER "${name}". Registered: ${[...providers.keys()].join(', ')}`
    );
  }
  return provider;
}

function byName(name) {
  return providers.get(name) || null;
}

/** One row per attempt, so a failed or abandoned payment leaves a trace. */
function record({ orderId, provider, reference, status, amountCents }) {
  db.prepare(
    `INSERT INTO payments (order_id, provider, reference, status, amount_cents)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, provider, reference, status, amountCents);
}

function markSettled({ orderId, provider, reference, status }) {
  db.prepare(
    `UPDATE payments SET status = ?, settled_at = datetime('now')
     WHERE order_id = ? AND provider = ? AND reference = ?`
  ).run(status, orderId, provider, reference);
}

module.exports = { register, active, byName, providers, record, markSettled };
