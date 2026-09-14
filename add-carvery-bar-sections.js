// One-off — adds two empty menu sections, "Carvery" and "Bar Menu", so they
// show up in the existing admin Menu & Events editor (Veera can type
// straight into them there once the actual dishes are ready, no further
// script needed from us). This supports the new /our-menu 4-card hub
// (Breakfast / Carvery / Bar / Beverages) added in routes/publicMenu.js —
// Breakfast and Beverages already exist with items; Carvery and Bar didn't
// exist at all yet, so the hub would otherwise have nothing to link to for
// those two categories' "coming soon" state to make sense once matched.
//
// Idempotent: checks for an existing section whose title matches the same
// /carvery/i or /\bbar\b/i regex the public route uses before adding, so
// running this more than once (or after Veera has already added his own
// "Bar Menu"/"Carvery" section by hand) never creates a duplicate.
//
// Usage (Render Shell): node add-carvery-bar-sections.js
require('dotenv').config();
const models = require('./src/models');
const { getPool } = require('./src/sqlPool');

const NEW_SECTIONS = [
  { title: 'Carvery', match: /carvery/i },
  { title: 'Bar Menu', match: /\bbar\b/i }
];

async function main() {
  const menu = await models.getMenu();
  const sections = menu.sections || [];
  let added = 0;

  for (const { title, match } of NEW_SECTIONS) {
    const exists = sections.some(s => match.test(s.title || ''));
    if (exists) {
      console.log(`Skipping "${title}" — a matching section already exists.`);
      continue;
    }
    sections.push({ title, items: [] });
    added++;
    console.log(`Added empty section "${title}".`);
  }

  if (added > 0) {
    await models.saveMenu({ intro: menu.intro, sections });
    console.log(`Saved menu with ${added} new section(s).`);
  } else {
    console.log('Nothing to save — no new sections added.');
  }
}

main()
  .catch(err => { console.error('FAILED:', err); process.exitCode = 1; })
  .finally(() => getPool().end());
