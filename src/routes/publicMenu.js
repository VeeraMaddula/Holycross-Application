const express = require('express');
const router = express.Router();
const models = require('../models');

// Read-only, public "virtual menu" — linked from booking confirmation
// emails/texts so a customer can see what's on before they arrive. No
// login required; this never lets a visitor change anything, unlike the
// staff-only /menu admin page.
//
// Allergens are free-text (admin types whatever they like, comma
// separated — see routes/menu.js), so there's no fixed vocabulary to map
// against a standard allergen list. Instead of guessing synonyms, we build
// the numbered key straight from whatever's actually on the live menu
// right now: collect every distinct allergen string used anywhere on the
// menu, normalized so "Gluten" / "gluten" / "GLUTEN " count as the same
// thing, sort it alphabetically, and number it 1..N. Recomputed on every
// request, so the key always covers 100% of what's entered — nothing can
// ever go unnumbered or get silently dropped from a dish's badges.
function normalizeAllergen(a) {
  return (a || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function titleCase(key) {
  return key.replace(/\b\w/g, c => c.toUpperCase());
}

// The public "Check the Menu" button on the Wix site links here. Instead of
// one long scrolling page of every section, this is a hub of 4 category
// cards (Breakfast / Carvery / Bar / Beverages) — the 4 the restaurant
// actually wants customers choosing between — each opening its own page.
// Sections are matched to a category by keyword rather than an exact title
// match, so whatever the admin happens to call a section (e.g. "Breakfasts"
// vs "Breakfast Menu") still lands in the right card without needing the
// admin-entered title to match some fixed string exactly.
const MENU_CATEGORIES = [
  { slug: 'breakfast', label: 'Breakfast', match: /breakfast/i },
  { slug: 'carvery', label: 'Carvery', match: /carvery/i },
  { slug: 'bar', label: 'Bar Menu', match: /\bbar\b/i },
  { slug: 'beverages', label: 'Beverages', match: /beverage|drinks?\b/i }
];

function sectionsForCategory(menu, category) {
  return (menu.sections || []).filter(s => category.match.test(s.title || ''));
}

function withAllergenBadges(menu) {
  const nameByKey = new Map();
  (menu.sections || []).forEach(section => {
    (section.items || []).forEach(item => {
      (item.allergens || []).forEach(a => {
        const key = normalizeAllergen(a);
        if (key && !nameByKey.has(key)) nameByKey.set(key, titleCase(key));
      });
    });
  });

  const sortedKeys = Array.from(nameByKey.keys())
    .sort((x, y) => nameByKey.get(x).localeCompare(nameByKey.get(y), undefined, { sensitivity: 'base' }));
  const numberByKey = {};
  sortedKeys.forEach((key, i) => { numberByKey[key] = i + 1; });
  const allergenLegend = sortedKeys.map(key => ({ number: numberByKey[key], name: nameByKey.get(key) }));

  const sections = (menu.sections || []).map(section => ({
    ...section,
    items: (section.items || []).map(item => ({
      ...item,
      allergenBadges: (item.allergens || [])
        .map(a => numberByKey[normalizeAllergen(a)])
        .filter(n => n)
        .sort((a, b) => a - b)
    }))
  }));

  return { menu: { ...menu, sections }, allergenLegend };
}

router.get('/', async (req, res) => {
  const rawMenu = await models.getMenu();
  const cards = MENU_CATEGORIES.map(category => {
    const sections = sectionsForCategory(rawMenu, category);
    const items = sections.flatMap(s => s.items || []);
    const thumbnail = items.find(i => i.photoUrl);
    return {
      slug: category.slug,
      label: category.label,
      itemCount: items.length,
      thumbnailUrl: thumbnail ? thumbnail.photoUrl : null
    };
  });
  res.render('public/menu-hub', { cards });
});

router.get('/:slug', async (req, res) => {
  const category = MENU_CATEGORIES.find(c => c.slug === req.params.slug);
  if (!category) return res.redirect('/our-menu');

  const rawMenu = await models.getMenu();
  const sections = sectionsForCategory(rawMenu, category);
  const { menu, allergenLegend } = withAllergenBadges({ sections });
  res.render('public/menu-category', { category, sections: menu.sections, allergenLegend });
});

module.exports = router;
