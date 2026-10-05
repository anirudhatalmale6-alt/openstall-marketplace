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

Checkout currently records the order without charging a card — it is clearly labelled as demo
mode in the UI. The commission split is already calculated and stored per order line, so moving
to Stripe Connect (each seller onboarded, paid directly, marketplace keeps its fee) is a
configuration and webhook step rather than a rewrite.

## Layout

```
server.js            app wiring, session, request context
src/db.js            SQLite schema
src/seed.js          demo data
src/helpers.js       money/slug/price/cover-art helpers
src/guards.js        requireUser / requireSeller / requireAdmin
src/routes/          shop, auth, cart, seller, admin
views/               EJS templates (partials/, seller/, admin/)
public/css/app.css   hand-written stylesheet, no CDN
screenshots/         current state of every screen
```

SQLite keeps the prototype dependency-free. The queries are plain SQL, so moving to
MySQL or Postgres when traffic justifies it is a contained change.
