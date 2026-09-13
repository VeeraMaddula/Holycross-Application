// One-off — adds the Breakfast menu (from Veera's holycross_breakfast_menu_a4.pdf)
// to the live Menu & Events page: a "Breakfasts" section with a generated
// photo + decoded allergens for each of the 13 hot dishes, plus "Beverages"
// and "Extra Items" sections (no photos needed there — they're drinks/add-ons,
// not plated dishes).
//
// Existing sections (Small Plates / Mains / Cocktails etc.) are left
// completely untouched — Veera said he'll update lunch/bar himself later.
// If this script is re-run, it replaces only the "Breakfasts" / "Beverages" /
// "Extra Items" sections by title match (case-insensitive) rather than
// duplicating them, and re-downloading images is safe (each run creates new
// `files` rows and just re-points photoUrl — the old rows are simply orphaned,
// not deleted, which is fine for a one-off migration).
//
// Photos: 13 dish photos were generated via OpenArt (byte-plus-seedream-4-5,
// 2304x1728 JPEGs) in this session and are downloaded here from their CDN
// URLs. CockroachDB's `files` table caps stored images at 900KB
// (fileStore.MAX_IMAGE_BYTES) to stay well under Cockroach's recommended
// per-value BYTES limit, so each image is re-encoded with sharp (resized +
// JPEG-compressed, backing off quality/width until it fits) before storing.
//
// NOTE ON ALLERGEN CODE 2 IN "EXTRA ITEMS": the PDF marks Bacon, Sausages and
// Pudding with allergen (2), and the PDF's own legend maps 2 = Crustaceans.
// That looks like a printing mistake in the source menu (crustaceans in
// bacon/sausages/pudding would be unusual) but this script decodes exactly
// what the PDF states rather than silently "fixing" it — worth Veera
// double-checking with the kitchen before this goes live.
//
// Usage (Render Shell): node add-breakfast-menu.js
require('dotenv').config();
const http = require('http');
const https = require('https');
const sharp = require('sharp');
const models = require('./src/models');
const fileStore = require('./src/fileStore');
const { getPool } = require('./src/sqlPool');

// Allergen legend from the PDF.
const ALLERGENS = {
  1: 'Cereals', 2: 'Crustaceans', 3: 'Eggs', 4: 'Fish', 5: 'Peanuts',
  6: 'Soybean', 7: 'Milk', 8: 'Nuts', 9: 'Celery', 10: 'Mustard',
  11: 'Sesame Seeds', 12: 'Sulphur Dioxide and Sulphates', 13: 'Lupin', 14: 'Molluscs',
};
function decode(codes) {
  return codes.map(c => ALLERGENS[c]).filter(Boolean);
}

// The 13 breakfast dishes, in PDF order, each with its OpenArt CDN image URL
// (generated + confirmed COMPLETED earlier this session).
const BREAKFASTS = [
  {
    name: 'The Full Irish', price: '12.95', allergens: decode([1, 3, 6, 7, 8, 12]),
    desc: '2 bacon, 2 sausages, fried egg, black & white pudding, beans, mushrooms and sautéed potatoes, served with toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/02178929618096770c18af9f89e89788c62dbe222232361a1d495_0_1789296189844_2861b7ae.jpeg',
  },
  {
    name: 'The Mini', price: '9.95', allergens: decode([1, 3, 6, 7, 8, 12]),
    desc: '1 bacon, 1 sausage, black & white pudding and a fried egg, served with toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789296183245fdccfc102ca12157f94275e78054dc3ba70299_0_1789296198852_fb521442.jpeg',
  },
  {
    name: 'The Vegetarian', price: '10.95', allergens: decode([1, 3, 6, 7, 8, 11]),
    desc: '2 vegan sausages, 2 vegan puddings, beans, mushrooms, fried egg and sautéed potatoes, served with toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/02178929618532945c07e4ff35b1f55227084b3d76e9a80b898b0_0_1789296192734_622bd0fc.jpeg',
  },
  {
    name: 'The Vegan', price: '10.95', allergens: decode([1, 6, 8, 11]),
    desc: '2 vegan sausages, 2 vegan white pudding, beans, mushrooms, sautéed potatoes and a grilled tomato, served with toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892961871015d6d8f07cf2a752c74db4b42ef6a643eafcabe_0_1789296195661_836577c9.jpeg',
  },
  {
    name: 'Scrambled Egg', price: '8.95', allergens: decode([1, 3, 7]),
    desc: '3 eggs scrambled, served with toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789296189098d4c69f90bdf814940b1abafd46c62ec6bfa888_0_1789296195548_bded6822.jpeg',
  },
  {
    name: 'Poached Eggs', price: '7.95', allergens: decode([1, 3, 7]),
    desc: '2 poached eggs, served with toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789296190632c305af2c12e62e554ff5b6f08b2a8ff7da09c9_0_1789296197247_648ff0d6.jpeg',
  },
  {
    name: 'Spicy Vegetarian Omelette', price: '11.95', allergens: decode([1, 3, 7]),
    desc: 'Served with grilled tomato, toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789296192253e9db803be2da2d1fb0370cddd09ba5d6ae8e30_0_1789296199635_671c733b.jpeg',
  },
  {
    name: 'Ham & Cheese Omelette', price: '12.95', allergens: decode([1, 3, 7]),
    desc: 'Served with grilled tomato, toast and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892961949210c64a0471125ddcff16fb53685966178df5e5e_0_1789296207932_9d04a2e2.jpeg',
  },
  {
    name: 'The Lighter Option', price: '12.95', allergens: decode([1, 3, 4, 6, 7]),
    desc: '2 poached eggs, grilled tomato, beans, mashed avocado and smoked salmon, served with brown bread and tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892961971398823a6d9d4020aa2a4c8e545461b44d5b3931d_0_1789296205244_03a09eaf.jpeg',
  },
  {
    name: 'Eggs Benedict', price: '12.95', allergens: decode([1, 3, 10, 12]),
    desc: '2 poached eggs and bacon on grilled garlic sourdough, smothered in hollandaise, served with tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892962413199e96f8c80ac47960a454270e9930f9544eaad4_0_1789296260342_1554b179.jpeg',
  },
  {
    name: 'Eggs Royale', price: '12.95', allergens: decode([1, 3, 4, 10]),
    desc: '2 poached eggs and smoked salmon on grilled garlic sourdough, smothered in hollandaise, served with tea/filter coffee',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892962438396438f8a7da3edc67692fae0fdfd3f961b5ec6d_0_1789296251302_da7d9d8d.jpeg',
  },
  {
    name: 'American Style Pancakes', price: '7.95', allergens: decode([1, 3, 7]),
    desc: '4 pancakes served with Nutella and sprinkled with icing sugar',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789296244946e06db01f38fbb905edbc4e87c2816c5ecac623_0_1789296251764_e2b8f524.jpeg',
  },
  {
    name: 'Fresh Scone', price: '3.50', allergens: decode([1, 3, 7]),
    desc: 'Served with jam and butter',
    imageUrl: 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/02178929620513247fde1ce057a4e39ca4c3f804f8e42e0df3b78_0_1789296212097_3c15fca4.jpeg',
  },
];

const BEVERAGES = [
  { name: 'Americano', price: '2.95', desc: '' },
  { name: 'Latte', price: '3.50', desc: '', allergens: decode([7]) },
  { name: 'Cappuccino', price: '3.50', desc: '', allergens: decode([7]) },
  { name: 'Large Cappuccino', price: '3.75', desc: '', allergens: decode([7]) },
  { name: 'Tea', price: '2.75', desc: '' },
  { name: 'Herbal Tea', price: '3.50', desc: '' },
  { name: 'Orange Juice', price: '1.50 / 3.00', desc: '' },
  { name: 'Apple Juice', price: '1.50 / 3.00', desc: '' },
  { name: 'Hot Chocolate', price: '3.50', desc: '', allergens: decode([7]) },
  { name: 'White Americano', price: '3.50', desc: '', allergens: decode([7]) },
  { name: 'Ristretto', price: '3.50', desc: '', allergens: decode([7]) },
  { name: 'Milk Coffee', price: '3.50', desc: '', allergens: decode([7]) },
];

const EXTRA_ITEMS = [
  { name: 'Bacon (2)', price: '2.00', desc: '', allergens: decode([2]) },
  { name: 'Sausages (2)', price: '2.00', desc: '', allergens: decode([2]) },
  { name: 'Pudding (2)', price: '2.00', desc: '', allergens: decode([2]) },
  { name: 'Beans', price: '1.50', desc: '' },
  { name: 'Fried Egg', price: '1.50', desc: '' },
  { name: 'Mushrooms', price: '1.50', desc: '' },
  { name: 'Sauté Potatoes', price: '2.50', desc: '' },
  { name: 'Toast / Homemade Soda Bread', price: '2.00', desc: '' },
  { name: 'Homemade Soda Bread (Jam & Butter)', price: '3.50', desc: '' },
];

function fetchBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http://') ? http : https;
    lib.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Re-encodes an image to fit under fileStore.MAX_IMAGE_BYTES, backing off
// width/quality until it fits (tested against a worst-case noisy 2304x1728
// source in dev — first-pass settings below comfortably clear the cap for
// real photos, this loop is just a safety net).
async function compressUnderLimit(buffer, maxBytes) {
  let width = 1600;
  let quality = 82;
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= maxBytes) return out;
    quality -= 12;
    if (quality < 40) { quality = 60; width = Math.round(width * 0.8); }
  }
  return sharp(buffer).rotate().resize({ width: 800 }).jpeg({ quality: 50, mozjpeg: true }).toBuffer();
}

async function storeDishPhoto(dish) {
  const raw = await fetchBuffer(dish.imageUrl);
  const jpeg = await compressUnderLimit(raw, fileStore.MAX_IMAGE_BYTES);
  const id = await fileStore.saveFile({
    category: 'menu_photo',
    filename: `${dish.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`,
    mimeType: 'image/jpeg',
    buffer: jpeg,
    uploadedByUserId: null,
  });
  return `/files/${id}`;
}

async function main() {
  console.log('Downloading + storing 13 breakfast dish photos...');
  const breakfastItems = [];
  for (const dish of BREAKFASTS) {
    process.stdout.write(`  ${dish.name}... `);
    const photoUrl = await storeDishPhoto(dish);
    console.log(`stored as ${photoUrl}`);
    breakfastItems.push({ name: dish.name, price: dish.price, desc: dish.desc, allergens: dish.allergens, photoUrl });
  }

  const newSections = [
    { title: 'Breakfasts', items: breakfastItems },
    { title: 'Beverages', items: BEVERAGES },
    { title: 'Extra Items', items: EXTRA_ITEMS },
  ];
  const newTitlesLower = new Set(newSections.map(s => s.title.toLowerCase()));

  const current = await models.getMenu();
  const keptSections = (current.sections || []).filter(s => !newTitlesLower.has(String(s.title).trim().toLowerCase()));

  const sections = [...newSections, ...keptSections];
  await models.saveMenu({ intro: current.intro || '', sections });

  console.log(`\nDone. Menu now has ${sections.length} section(s): ${sections.map(s => s.title).join(', ')}.`);
  console.log('Kept untouched from before:', keptSections.length ? keptSections.map(s => s.title).join(', ') : '(none existed yet)');

  await getPool().end();
}

module.exports = { main, fetchBuffer, compressUnderLimit, BREAKFASTS, BEVERAGES, EXTRA_ITEMS };

if (require.main === module) {
  main().catch((err) => {
    console.error('FAILED:', err.message, '\n', err.stack);
    process.exit(1);
  });
}
