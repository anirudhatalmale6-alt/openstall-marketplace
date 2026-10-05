# OpenStall — multi-vendor marketplace (prototype)

A working online marketplace: a public storefront, a dashboard for each seller, and an admin
panel for the marketplace owner. Built as a starting point so we can agree on the real
requirements by clicking a real thing rather than by writing a spec.

"OpenStall" is a placeholder name — branding, colours and copy are all easy to change.

## Run it

```bash
npm install
npm run seed      # creates data/marketplace.db with demo shops, products and orders
npm start         # http://localhost:4310
```

Node 18+ required. No external services, no API keys, no build step.

### Demo logins — password `demo1234` for all of them

| Role   | Email                       | Lands on             |
|--------|-----------------------------|----------------------|
| Admin  | `admin@demo.test`           | `/admin`             |
| Seller | `meera@kilnandclay.test`    | `/seller`            |
| Buyer  | `dana@example.test`         | storefront           |

Other sellers: `tom@northbound.test`, `ana@pixelforge.test`, `priya@stillroom.test`,
`sam@fermentco.test`, `hana@loomstreet.test`.

## What works today

**Storefront** — home page with categories and featured products, browse with search,
category filter, price sorting and pagination, product pages, per-shop pages, a shops
directory.

**Buying** — session basket that survives sign-in, quantity changes, free delivery over $75,
checkout with address validation, order confirmation, order history, per-item delivery status.
One basket can hold items from several shops; the order is split per seller behind the scenes.

**Selling** — apply to open a shop, add/edit/delete products with photo upload (or auto-generated
cover art), stock counts that decrement on each sale, low-stock warnings, a fulfilment queue
showing only that shop's lines plus the buyer's address, earnings after commission, shop profile
editing.

**Admin** — GMV, commission earned, live shops and listing counts; an approval queue for new
shops; per-shop commission rates; listing/unlisting any product; order status overrides;
category management.

**Rules the code enforces** — pending shops and their products are invisible to buyers; a seller
can only see and edit their own products and their own order lines; one buyer cannot open
another buyer's order; non-admins get a 403 on `/admin`; stock is re-checked inside the
checkout transaction so two buyers cannot oversell the last unit; a product with order history
is unlisted rather than deleted.

## Payments

Checkout does not talk to a payment company directly. It creates the order, reserves stock,
then hands the order to whichever provider `PAYMENT_PROVIDER` names. Two shapes are supported:
charged inline, and hosted redirect where the provider's webhook is what confirms payment.
See `src/payments/README.md` for the interface and how to add a provider.

Orders are created as `awaiting_payment` and only the provider can move them to `paid`. An
admin can cancel an unpaid order but cannot declare that money arrived, sellers never see an
unpaid order in their fulfilment queue, and unpaid orders are excluded from GMV and commission.
A failed or cancelled payment puts the reserved stock back.

Two providers ship with the prototype, both simulated and neither able to move money:
`demo` (default, instant success) and `sandbox-redirect` (hosted-redirect shape, used to
exercise the webhook path end to end). The real provider is not chosen yet.

## Tests

Both suites drive a real browser against a running server and need a freshly seeded database,
because they register accounts and approve shops:

```bash
npm run seed && PORT=4310 node server.js &
python3 test/e2e-journeys.py                 # 40 checks: buyer, seller, admin journeys

npm run seed
PORT=4311 PAYMENT_PROVIDER=sandbox-redirect node server.js &
BASE=http://localhost:4311 python3 test/e2e-payments.py   # 23 checks: the payment layer
```

## Layout

```
server.js            app wiring, session, request context
src/db.js            SQLite schema
src/seed.js          demo data
src/helpers.js       money/slug/price/cover-art helpers
src/guards.js        requireUser / requireSeller / requireAdmin
src/payments/        provider interface + demo and sandbox-redirect adapters
src/routes/          shop, auth, cart, payments, seller, admin
views/               EJS templates (partials/, seller/, admin/)
public/css/app.css   hand-written stylesheet, no CDN
test/                end-to-end Playwright suites
screenshots/         current state of every screen
```

SQLite keeps the prototype dependency-free. The queries are plain SQL, so moving to
MySQL or Postgres when traffic justifies it is a contained change.
