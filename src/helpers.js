function money(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function parsePrice(input) {
  const n = Number(String(input).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// Deterministic pastel pair from a string, used for generated product art.
function artColors(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return [`hsl(${h} 42% 78%)`, `hsl(${(h + 38) % 360} 36% 60%)`];
}

function initials(title) {
  return String(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Uploaded photo if the seller added one, otherwise generated cover art.
function imgFor(product) {
  return product && product.image ? `/uploads/${product.image}` : `/img/p/${product.id}.svg`;
}

module.exports = { money, slugify, parsePrice, artColors, initials, imgFor };
