# Payment providers

Checkout never talks to a payment company directly. It creates the order, then hands it to
whichever provider is named in `PAYMENT_PROVIDER` (default `demo`). Swapping provider is a new
file in this folder plus one environment variable — checkout, commission and order handling
stay untouched.

## Writing a provider

A provider is an object with a `name`, a `label`, and two methods:

```js
module.exports = {
  name: 'acme',
  label: 'Acme Payments',

  // Called once the order exists and stock is reserved.
  // Return either:
  //   { status: 'paid',    reference }               - charged inline, done
  //   { status: 'pending', reference, redirectUrl }  - send the buyer to the provider
  async begin({ order, items, returnUrl, buyer }) { ... },

  // Called by POST /payments/webhook/acme. Return null if the request is not
  // genuine — the route answers 400 and nothing is marked paid.
  //   { reference, orderId, status: 'paid' | 'failed' }
  async parseWebhook({ headers, rawBody, body }) { ... },
};
```

Register it in `src/payments/index.js`, set `PAYMENT_PROVIDER=acme`, done.

## The two shapes this covers

**Charged inline** (provider API called server-side, result is immediate): return `paid` from
`begin` and the buyer lands on the order page already confirmed.

**Hosted redirect** (buyer leaves to the provider's own page): return `pending` plus a
`redirectUrl`. The order sits at `awaiting_payment`, the buyer comes back to
`/payments/return/:orderId`, and the webhook is what actually marks it paid. Never trust the
return URL for that — the buyer controls it, the webhook is the provider speaking.

## Split payouts vs collect-and-pay-out

If the provider onboards sellers as sub-merchants and splits each payment, record the split
reference per order line and you are done.

If it does not, every payment lands in the marketplace's own account and sellers are owed money.
`order_items.commission_cents` already records the marketplace's cut per line, so the amount
payable to each seller is derivable today. A payout ledger and reconciliation screen would sit
on top of that — not built yet, because it is only needed on the collect-and-pay-out route.
