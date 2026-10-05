/**
 * Demo data. Run with: npm run seed  (wipes and refills the tables)
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const { slugify } = require('./helpers');

const PASSWORD = 'demo1234';

const CATEGORIES = [
  'Home & Living',
  'Apparel',
  'Electronics',
  'Beauty & Care',
  'Sports & Outdoors',
  'Food & Drink',
];

const SHOPS = [
  {
    shop: 'Kiln & Clay',
    owner: 'Meera Rao',
    email: 'meera@kilnandclay.test',
    tagline: 'Wheel-thrown stoneware, fired in small batches',
    accent: '#8a5a44',
    status: 'approved',
    commission: 0.1,
    products: [
      ['Speckled Dinner Plate', 'Home & Living', 3200, 24, 'Stoneware plate with a speckled oatmeal glaze. 26cm, dishwasher and microwave safe.'],
      ['Tall Ribbed Vase', 'Home & Living', 6800, 7, 'Hand-ribbed vase in a matte sage glaze. Watertight, 28cm tall.'],
      ['Morning Mug, Set of 2', 'Home & Living', 4500, 15, 'A pair of 350ml mugs with a comfortable wide handle. No two are identical.'],
      ['Olive Serving Bowl', 'Home & Living', 5400, 9, 'Shallow 24cm serving bowl, glazed inside with a soft olive pool.'],
      ['Incense Dish', 'Home & Living', 1800, 40, 'Small round dish with a centre hole for sticks. Catches every bit of ash.'],
    ],
  },
  {
    shop: 'Northbound Supply',
    owner: 'Tom Girard',
    email: 'tom@northbound.test',
    tagline: 'Hard-wearing gear for cold mornings',
    accent: '#2f5d7c',
    status: 'approved',
    commission: 0.12,
    products: [
      ['Waxed Canvas Rucksack', 'Sports & Outdoors', 14900, 12, '28L waxed cotton pack with leather straps and a padded laptop sleeve.'],
      ['Merino Watch Cap', 'Apparel', 3400, 48, 'Fine-gauge merino beanie. Warm without the itch, holds its shape.'],
      ['Enamel Trail Mug', 'Sports & Outdoors', 2200, 60, 'Speckled enamel over steel, 400ml. Campfire safe, chip resistant rim.'],
      ['Packable Rain Shell', 'Apparel', 18900, 6, 'Fully taped 2.5-layer shell that stuffs into its own chest pocket.'],
      ['Leather Belt, Natural', 'Apparel', 6200, 20, 'Single piece of 4mm veg-tan leather with a solid brass buckle.'],
    ],
  },
  {
    shop: 'Pixel Forge',
    owner: 'Ana Costa',
    email: 'ana@pixelforge.test',
    tagline: 'Desk gear for people who type all day',
    accent: '#4b4a8f',
    status: 'approved',
    commission: 0.08,
    products: [
      ['Low-Profile Mechanical Keyboard', 'Electronics', 21900, 18, '65% hot-swappable board, aluminium case, USB-C and Bluetooth 5.2.'],
      ['Walnut Monitor Riser', 'Electronics', 8900, 14, 'Solid walnut riser, 9cm lift, with a slot for a tablet or notebook.'],
      ['Braided USB-C Cable, 2m', 'Electronics', 1900, 120, '100W charging and 10Gbps data in a cable that survives a desk drawer.'],
      ['Ambient Desk Lamp', 'Electronics', 12400, 11, 'Tunable 2700-5000K lamp with a weighted base and a USB-C passthrough.'],
      ['Felt Mouse Pad, XL', 'Electronics', 3600, 55, '90x40cm wool-blend pad with a cork backing that stays put.'],
    ],
  },
  {
    shop: 'Still Room Botanicals',
    owner: 'Priya Nair',
    email: 'priya@stillroom.test',
    tagline: 'Short ingredient lists, nothing you cannot pronounce',
    accent: '#5d7a4a',
    status: 'approved',
    commission: 0.14,
    products: [
      ['Rosemary & Mint Shampoo Bar', 'Beauty & Care', 1400, 90, 'Solid bar, roughly 60 washes. No plastic bottle, no palm oil.'],
      ['Calendula Hand Balm', 'Beauty & Care', 2100, 44, 'Thick unscented balm for hands that get washed twenty times a day.'],
      ['Clay Face Mask, 90g', 'Beauty & Care', 2600, 32, 'Kaolin and rhassoul clay. Mix a teaspoon with water, leave eight minutes.'],
      ['Beard & Brow Oil', 'Beauty & Care', 2900, 27, 'Jojoba, argan and a trace of cedar. Absorbs without leaving a shine.'],
    ],
  },
  {
    shop: 'Ferment & Co',
    owner: 'Sam Aduke',
    email: 'sam@fermentco.test',
    tagline: 'Slow food in small jars',
    accent: '#a2683a',
    status: 'approved',
    commission: 0.15,
    products: [
      ['Chilli Crisp, 200g', 'Food & Drink', 1600, 75, 'Crunchy chilli oil with shallot, garlic and sichuan pepper. Medium heat.'],
      ['Wild Garlic Kraut', 'Food & Drink', 1100, 52, 'Three-week ferment, unpasteurised. Keep it cold and eat it cold.'],
      ['Single Origin Filter Coffee, 250g', 'Food & Drink', 2400, 38, 'Washed Kenyan AA, roasted light for filter. Blackcurrant and brown sugar.'],
      ['Preserved Lemons', 'Food & Drink', 1300, 29, 'Whole lemons cured in salt for six weeks. Rinse before use.'],
      ['Smoked Chilli Honey', 'Food & Drink', 1900, 41, 'Raw honey infused with lightly smoked chipotle. Good on everything.'],
    ],
  },
  {
    shop: 'Loom Street',
    owner: 'Hana Oyelaran',
    email: 'hana@loomstreet.test',
    tagline: 'Woven at home, finished by hand',
    accent: '#9a4f63',
    status: 'approved',
    commission: 0.11,
    products: [
      ['Waffle Cotton Throw', 'Home & Living', 7900, 13, '130x180cm waffle-weave throw in washed cotton. Softens every wash.'],
      ['Linen Apron', 'Apparel', 5400, 22, 'Heavy linen cross-back apron with two deep front pockets.'],
      ['Striped Tea Towels, Pair', 'Home & Living', 2800, 46, 'Absorbent flax-cotton towels with a hanging loop. They get better used.'],
      ['Wool Floor Cushion', 'Home & Living', 11200, 5, '60cm square cushion in undyed wool with a hidden zip and a carry handle.'],
    ],
  },
  // These two stay pending so the admin approval queue has something in it.
  {
    shop: 'Verdant Plantworks',
    owner: 'Luca Benetti',
    email: 'luca@verdant.test',
    tagline: 'Houseplants that forgive a missed watering',
    accent: '#3f6b5b',
    status: 'pending',
    commission: 0.1,
    products: [
      ['ZZ Plant, 40cm', 'Home & Living', 3900, 18, 'Nearly unkillable. Low light, water once a fortnight.'],
      ['Terracotta Pot, 18cm', 'Home & Living', 1700, 30, 'Unglazed terracotta with a drainage hole and a matching saucer.'],
    ],
  },
  {
    shop: 'Hallow Audio',
    owner: 'Dre Mensah',
    email: 'dre@hallowaudio.test',
    tagline: 'Small speakers, honest sound',
    accent: '#3b3b44',
    status: 'pending',
    commission: 0.1,
    products: [
      ['Bookshelf Speaker Pair', 'Electronics', 32900, 4, 'Two-way 4-inch bookshelf pair in oiled oak. Passive, 6 ohm.'],
    ],
  },
];

const BUYERS = [
  ['Dana Whitfield', 'dana@example.test'],
  ['Josh Okafor', 'josh@example.test'],
];

function run() {
  const hash = bcrypt.hashSync(PASSWORD, 10);

  db.exec(`
    DELETE FROM order_items; DELETE FROM orders; DELETE FROM products;
    DELETE FROM vendors;     DELETE FROM categories; DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `); // reset the id counters too, so demo URLs stay stable between re-seeds

  const insUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  const insVendor = db.prepare(`INSERT INTO vendors
    (user_id, shop_name, slug, tagline, accent, status, commission_rate, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insCat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');
  const insProd = db.prepare(`INSERT INTO products
    (vendor_id, category_id, title, slug, description, price_cents, stock, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`);

  const adminId = insUser.run('Marketplace Admin', 'admin@demo.test', hash, 'admin').lastInsertRowid;

  const catIds = {};
  for (const name of CATEGORIES) catIds[name] = insCat.run(name, slugify(name)).lastInsertRowid;

  for (const s of SHOPS) {
    const uid = insUser.run(s.owner, s.email, hash, 'seller').lastInsertRowid;
    const vid = insVendor.run(
      uid, s.shop, slugify(s.shop), s.tagline, s.accent, s.status, s.commission,
      `${s.shop} is run by ${s.owner}. ${s.tagline}. Orders are packed and posted within two working days.`
    ).lastInsertRowid;

    for (const [title, cat, price, stock, desc] of s.products) {
      insProd.run(vid, catIds[cat], title, slugify(title), desc, price, stock);
    }
  }

  const buyerIds = BUYERS.map(([n, e]) => insUser.run(n, e, hash, 'buyer').lastInsertRowid);

  // A few historic orders so the seller and admin dashboards are not empty.
  const liveProducts = db.prepare(`
    SELECT p.id, p.vendor_id, p.title, p.price_cents, v.commission_rate
    FROM products p JOIN vendors v ON v.id = p.vendor_id
    WHERE v.status = 'approved'
  `).all();

  const insOrder = db.prepare(`INSERT INTO orders
    (buyer_id, total_cents, status, ship_name, ship_address, ship_city, ship_zip, ship_country, placed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
  const insItem = db.prepare(`INSERT INTO order_items
    (order_id, product_id, vendor_id, title, unit_price_cents, qty, commission_cents, fulfil_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const BASKETS = [
    { buyer: 0, days: -18, status: 'delivered', fulfil: 'delivered', picks: [0, 7, 21] },
    { buyer: 1, days: -12, status: 'delivered', fulfil: 'delivered', picks: [11, 12] },
    { buyer: 0, days: -6,  status: 'shipped',   fulfil: 'shipped',   picks: [16, 19, 23] },
    { buyer: 1, days: -3,  status: 'paid',      fulfil: 'processing', picks: [2, 9] },
    { buyer: 0, days: -1,  status: 'paid',      fulfil: 'processing', picks: [13, 25, 5] },
  ];

  for (const b of BASKETS) {
    const items = b.picks
      .map((i) => liveProducts[i % liveProducts.length])
      .filter(Boolean)
      .map((p, i) => ({ ...p, qty: (i % 2) + 1 }));
    const total = items.reduce((t, it) => t + it.price_cents * it.qty, 0);
    const oid = insOrder.run(
      buyerIds[b.buyer], total, b.status,
      BUYERS[b.buyer][0], '14 Hollis Lane', 'Bristol', 'BS1 4TR', 'United Kingdom',
      `${b.days} days`
    ).lastInsertRowid;
    for (const it of items) {
      insItem.run(
        oid, it.id, it.vendor_id, it.title, it.price_cents, it.qty,
        Math.round(it.price_cents * it.qty * it.commission_rate), b.fulfil
      );
    }
  }

  const n = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  console.log(
    `seeded: ${n('users')} users, ${n('vendors')} vendors, ${n('products')} products, ` +
    `${n('orders')} orders, ${n('order_items')} order items (admin id ${adminId})`
  );
  console.log(`every demo login uses the password: ${PASSWORD}`);
}

run();
