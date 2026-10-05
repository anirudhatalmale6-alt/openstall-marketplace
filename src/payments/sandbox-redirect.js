/**
 * A stand-in for the hosted-redirect shape: the buyer leaves to the provider's
 * own payment page and the order is only confirmed when the provider's webhook
 * arrives. Exists so that path is exercised for real before we know which
 * company we are actually integrating.
 *
 * It mimics a provider, it does not move money.
 */
const crypto = require('crypto');

const SECRET = process.env.SANDBOX_WEBHOOK_SECRET || 'sandbox-shared-secret';

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

module.exports = {
  name: 'sandbox-redirect',
  label: 'Sandbox hosted checkout',
  simulated: true,
  sign, // exported so the test harness can forge a correctly signed callback

  async begin({ order, returnUrl }) {
    const reference = `sbx_${order.id}_${crypto.randomBytes(4).toString('hex')}`;
    return {
      status: 'pending',
      reference,
      redirectUrl: `/payments/sandbox/${encodeURIComponent(reference)}?return=${encodeURIComponent(returnUrl)}`,
    };
  },

  async parseWebhook({ headers, rawBody, body }) {
    const given = headers['x-sandbox-signature'];
    if (!given || !rawBody) return null;

    const expected = sign(rawBody);
    const a = Buffer.from(String(given));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const orderId = parseInt(body.order_id, 10);
    if (!orderId) return null;

    return {
      orderId,
      reference: String(body.reference || ''),
      status: body.status === 'paid' ? 'paid' : 'failed',
    };
  },
};
