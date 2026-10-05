/**
 * Demo provider: records the order as paid without charging anything.
 * Stands in until the real provider is chosen. Deliberately has no credentials,
 * no network calls, and no way of moving money.
 */
module.exports = {
  name: 'demo',
  label: 'Demo mode (no money moves)',
  simulated: true,

  async begin({ order }) {
    return { status: 'paid', reference: `demo_${order.id}_${order.total_cents}` };
  },

  async parseWebhook() {
    return null; // nothing legitimate can arrive for a provider that takes no payments
  },
};
