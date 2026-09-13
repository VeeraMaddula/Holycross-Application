// One-off — attaches photos to the Beverages and Extra Items sections that
// add-breakfast-menu.js already added to the live menu. All 12 Beverages
// photos and 8 of the 9 Extra Items photos were generated via OpenArt
// (byte-plus-seedream-4-5, 2K, top-down/overhead angle, styled as authentic
// Irish pub food & drink rather than American-style) in this session.
//
// "Homemade Soda Bread (Jam & Butter)" has NO photo here — the OpenArt
// account ran out of credits (8795 -> 0 mid-batch) right before that
// generation. Everything else in this script succeeded. Re-run
// add-beverages-extras-photos-2.js (or extend this file) once the OpenArt
// account is topped up to fill in that last one; this script is safe to
// re-run as-is in the meantime (it only ever sets photoUrl by item name,
// never removes or duplicates items).
//
// Unlike add-breakfast-menu.js (which builds whole new sections),
// this script only ADDS photoUrl to items that already exist in the current
// Beverages / Extra Items sections by exact name match — it does not touch
// price/desc/allergens, and does not touch Breakfasts, Small Plates, Mains,
// or any other section.
//
// Usage (Render Shell): node add-beverages-extras-photos.js
require('dotenv').config();
const http = require('http');
const https = require('https');
const sharp = require('sharp');
const models = require('./src/models');
const fileStore = require('./src/fileStore');
const { getPool } = require('./src/sqlPool');

// name -> OpenArt CDN image URL. Names must exactly match (case-insensitive)
// the item names already saved in the live menu's Beverages / Extra Items
// sections (see add-breakfast-menu.js's BEVERAGES / EXTRA_ITEMS arrays).
const PHOTOS = {
  'Americano': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298261652a139bd89baa39633285680c9471d15efb369c4_0_1789298269948_89b43ed7.jpeg',
  'Latte': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298263561ef9a07adf34cf0fac1320e81624057e03f8c5c_0_1789298270748_fb35bc5f.jpeg',
  'Cappuccino': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298265047681426abb3fc8758bc9af65311c7ae31ca5b17_0_1789298271047_e078bc92.jpeg',
  'Large Cappuccino': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/02178929826769035c9db62ef7a9766eeb1c4efe709aaa9da1ad0_0_1789298274358_80b8e906.jpeg',
  'Tea': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298270801a25d9fd8bbdfc574a90b55d3ae211a62613b8f_0_1789298283294_5ffbca5a.jpeg',
  'Herbal Tea': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298273085b8350bdfd357a856ad43651cfdb51f6e4f6c1f_0_1789298280029_d3b4233b.jpeg',
  'Orange Juice': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298274975b70b2a74477c2b606f823ac231da83298ba415_0_1789298281713_55b0dec5.jpeg',
  'Apple Juice': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298281516d3ceb3d471ce278cd568773b7d71d63955509b_0_1789298289052_9cd7babd.jpeg',
  'Hot Chocolate': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892982856672504cb05148e9a08cc7612c3f2b24e52cbc81b_0_1789298294021_ff57a98f.jpeg',
  'White Americano': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892982882056097278e78ff109d0bf5de77146291ac7d55e5_0_1789298296198_ffde5d22.jpeg',
  'Ristretto': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298290302df1fe1cc6cb558c8468775817e951d5de3e922_0_1789298297850_4922bc41.jpeg',
  'Milk Coffee': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298295762d45041e92366fce25871fcc31e231b4d71d1b9_0_1789298303023_6a1e3106.jpeg',

  'Bacon (2)': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892983012088cdbdac5f420e20fe0e1829640806a22e68792_0_1789298309218_ef01d934.jpeg',
  'Sausages (2)': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/02178929830331396d528c8df2143421f3e331d7739c2b1a720d5_0_1789298310892_e29b797a.jpeg',
  'Pudding (2)': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298305287d4c69f90bdf814940b1abafd46c62ec61c54d2_0_1789298312689_dde2f944.jpeg',
  'Beans': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892983076369e89f26b858b9d25ce524a85522bfdaf95b382_0_1789298314630_581dc892.jpeg',
  'Fried Egg': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892983113855482bcf7e80bfa8bf500513aca3a704d34b0f7_0_1789298319668_09b665e3.jpeg',
  'Mushrooms': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298312824e1f2c28e220bf76d8a56e2a46eaa08e959c549_0_1789298319924_d9c7e4e6.jpeg',
  'Sauté Potatoes': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/021789298319357c41b39946b92a3163d51611244fc4a0d3303d1_0_1789298327014_d1ca633e.jpeg',
  'Toast / Homemade Soda Bread': 'https://cdn.openart.ai/openart-ai/production/2026-09/create-image/user_3Hr8IXgGX35Ct5VTlqjsRb4bPhs/0217892983214589cf4adffd4482a40b9bfd1b5a653f234e32c49_0_1789298329231_75827a2f.jpeg',
  // 'Homemade Soda Bread (Jam & Butter)': NOT generated — OpenArt credits ran out.
};

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

async function storePhoto(name, url) {
  const raw = await fetchBuffer(url);
  const jpeg = await compressUnderLimit(raw, fileStore.MAX_IMAGE_BYTES);
  const id = await fileStore.saveFile({
    category: 'menu_photo',
    filename: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`,
    mimeType: 'image/jpeg',
    buffer: jpeg,
    uploadedByUserId: null,
  });
  return `/files/${id}`;
}

async function main() {
  const current = await models.getMenu();
  const matched = [];
  const unmatched = [];

  for (const sec of current.sections || []) {
    for (const item of sec.items || []) {
      const url = PHOTOS[item.name];
      if (!url) continue;
      matched.push(item.name);
    }
  }
  const namesInMenu = new Set(matched);
  for (const name of Object.keys(PHOTOS)) {
    if (!namesInMenu.has(name)) unmatched.push(name);
  }
  if (unmatched.length) {
    console.log('WARNING: these PHOTOS entries did not match any item name in the live menu (check spelling/section):', unmatched.join(', '));
  }

  console.log(`Downloading + storing ${Object.keys(PHOTOS).length} photos...`);
  const photoUrlByName = {};
  for (const [name, url] of Object.entries(PHOTOS)) {
    process.stdout.write(`  ${name}... `);
    const stored = await storePhoto(name, url);
    console.log(`stored as ${stored}`);
    photoUrlByName[name] = stored;
  }

  let updatedCount = 0;
  const sections = current.sections.map((sec) => ({
    ...sec,
    items: (sec.items || []).map((item) => {
      const photoUrl = photoUrlByName[item.name];
      if (!photoUrl) return item;
      updatedCount++;
      return { ...item, photoUrl };
    }),
  }));

  await models.saveMenu({ intro: current.intro || '', sections });

  console.log(`\nDone. Attached photos to ${updatedCount} item(s) across the live menu.`);
  if (!(namesInMenu.has('Homemade Soda Bread (Jam & Butter)'))) {
    console.log('Note: "Homemade Soda Bread (Jam & Butter)" still has no photo (OpenArt ran out of credits generating it) — top up OpenArt credits and re-run a follow-up script to fill it in.');
  }

  await getPool().end();
}

module.exports = { main, PHOTOS, fetchBuffer, compressUnderLimit };

if (require.main === module) {
  main().catch((err) => {
    console.error('FAILED:', err.message, '\n', err.stack);
    process.exit(1);
  });
}
