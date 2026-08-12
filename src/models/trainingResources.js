// Training & Resources library: cocktail / spirit / beer recipe cards that
// Managers curate (photos, an uploaded how-to video, and/or a linked
// YouTube tutorial) for Bar/Kitchen Staff to browse and learn from. Read
// access is broad (any real staff account); editing is manager-tier only
// (or individually granted via canEditTraining — see requireTrainingAccess
// / requireTrainingEditAccess in src/middleware.js).
const { readDb, writeDb } = require('../db');
const { MANAGER_ROLES } = require('../roles');

// Every category belongs to one audience ('bar' or 'kitchen') — this is
// what routes/training.js uses to decide which columns a Bar Staff vs
// Kitchen Staff account actually sees on the /training page (see
// visibleSections below). Managers and anyone individually granted
// canEditTraining see every section regardless of audience.
const CATEGORIES = [
  { value: 'cocktail', label: 'Cocktails', labelSingular: 'Cocktail', audience: 'bar' },
  { value: 'spirit', label: 'Spirits', labelSingular: 'Spirit', audience: 'bar' },
  { value: 'beer', label: 'Beers', labelSingular: 'Beer', audience: 'bar' },
  { value: 'recipe', label: 'Recipes', labelSingular: 'Recipe', audience: 'kitchen' },
  { value: 'prep', label: 'Prepping Process', labelSingular: 'Prep process', audience: 'kitchen' },
  { value: 'cleaning', label: 'Cleaning Techniques', labelSingular: 'Cleaning technique', audience: 'kitchen' }
];
const CATEGORY_VALUES = CATEGORIES.map(c => c.value);
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

// Groups the categories above into the two page sections shown on
// /training. Kept as an ordered list (not derived inline in the view) so
// the route and the view agree on exactly the same grouping.
const SECTIONS = [
  {
    key: 'bar',
    label: 'Behind the Bar',
    blurb: 'Every recipe, spirit, and pour The Holy Cross serves — how it\'s built, what\'s in it, and a tutorial to watch when you want a refresher.',
    categories: CATEGORIES.filter(c => c.audience === 'bar').map(c => c.value)
  },
  {
    key: 'kitchen',
    label: 'In the Kitchen',
    blurb: 'Dish recipes, prepping process, and cleaning technique guides for the kitchen — photos, step-by-step method, and a tutorial video where there is one.',
    categories: CATEGORIES.filter(c => c.audience === 'kitchen').map(c => c.value)
  }
];

// Field labels differ by category even though the underlying record shape
// is the same — a cocktail's "ingredients" is a spirit's "composition" is a
// beer's "what's in it," a prep process's "ingredients" is really its
// equipment/mise-en-place list. Kept as one flexible schema so the
// model/routes don't need six near-identical code paths; only the view's
// labels change.
const FIELD_LABELS = {
  cocktail: { subtitle: 'Style / glass', ingredients: 'Ingredients', method: 'Mixing method' },
  spirit: { subtitle: 'Spirit type', ingredients: 'Composition', method: 'How it\'s made' },
  beer: { subtitle: 'Beer style', ingredients: 'What\'s in it', method: 'How it\'s served' },
  recipe: { subtitle: 'Dish type', ingredients: 'Ingredients', method: 'Preparation method' },
  prep: { subtitle: 'Prep station / dish', ingredients: 'Equipment & ingredients needed', method: 'Step-by-step process' },
  cleaning: { subtitle: 'Area / equipment', ingredients: 'Cleaning supplies needed', method: 'Cleaning steps' }
};

// Which sections (from SECTIONS above) a given user should see on the
// /training page. Anyone who can edit training content (manager-tier roles,
// or a staff account individually granted canEditTraining) sees everything,
// since they may curate either department's material. Everyone else sees
// only their own department's section — a Bar Staff account never sees
// kitchen prep/cleaning content and vice versa.
function visibleSections(user) {
  const canEditAll = !!(user && (MANAGER_ROLES.includes(user.role) || user.canEditTraining));
  if (!user || canEditAll) return SECTIONS;
  if (user.role === 'bar_staff') return SECTIONS.filter(s => s.key === 'bar');
  if (user.role === 'kitchen_staff') return SECTIONS.filter(s => s.key === 'kitchen');
  return SECTIONS;
}

// Only ever trust a YouTube link enough to embed it if we can extract a
// clean 11-character video ID ourselves — never hand a user-supplied URL
// straight to an <iframe src>. Covers youtube.com/watch?v=, youtu.be/,
// youtube.com/embed/, and www./m. subdomains; rejects everything else
// (including javascript:, data:, or any non-YouTube host).
function extractYoutubeId(url) {
  const str = String(url || '').trim();
  if (!str) return null;
  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = parsed.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/embed/')) {
      id = parsed.pathname.split('/embed/')[1];
    } else if (parsed.pathname.startsWith('/shorts/')) {
      id = parsed.pathname.split('/shorts/')[1];
    }
  }
  if (!id) return null;
  id = id.split('?')[0].split('&')[0];
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function listItems({ category } = {}) {
  const db = readDb();
  let items = db.trainingItems || [];
  if (category) items = items.filter(i => i.category === category);
  return items.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function listItemsByCategory() {
  const all = listItems();
  const grouped = {};
  CATEGORY_VALUES.forEach(c => { grouped[c] = []; });
  all.forEach(i => { (grouped[i.category] || (grouped[i.category] = [])).push(i); });
  return grouped;
}

function getItem(id) {
  const db = readDb();
  return (db.trainingItems || []).find(i => i.id === Number(id));
}

function validateInput({ category, name, subtitle, ingredients, method, servingNotes, youtubeUrl }) {
  if (!CATEGORY_VALUES.includes(category)) return 'Choose a valid category.';
  if (!name || !String(name).trim()) return 'Name is required.';
  if (!ingredients || !String(ingredients).trim()) return `${FIELD_LABELS[category].ingredients} is required.`;
  if (!method || !String(method).trim()) return `${FIELD_LABELS[category].method} is required.`;
  if (youtubeUrl && String(youtubeUrl).trim() && !extractYoutubeId(youtubeUrl)) {
    return 'That doesn\'t look like a valid YouTube link.';
  }
  return null;
}

// Explicit-field create — never spreads a raw request body into the DB
// record, so extra/unexpected fields in the input are silently dropped
// rather than stored (matches every other create*/update* function in
// this codebase).
function createItem(input, createdByUserId) {
  const error = validateInput(input);
  if (error) return { error };
  const db = readDb();
  if (!db.trainingItems) db.trainingItems = [];
  if (!db.meta.nextTrainingItemId) db.meta.nextTrainingItemId = 1;
  const item = {
    id: db.meta.nextTrainingItemId++,
    category: input.category,
    name: String(input.name).trim(),
    subtitle: (input.subtitle || '').trim(),
    ingredients: String(input.ingredients).trim(),
    method: String(input.method).trim(),
    servingNotes: (input.servingNotes || '').trim(),
    photoPath: '',
    videoPath: '',
    youtubeUrl: (input.youtubeUrl || '').trim(),
    youtubeId: extractYoutubeId(input.youtubeUrl) || '',
    createdByUserId: createdByUserId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.trainingItems.push(item);
  writeDb(db);
  return { item };
}

function updateItem(id, input) {
  const error = validateInput(input);
  if (error) return { error };
  const db = readDb();
  const item = (db.trainingItems || []).find(i => i.id === Number(id));
  if (!item) return { error: 'Training item not found.' };
  item.category = input.category;
  item.name = String(input.name).trim();
  item.subtitle = (input.subtitle || '').trim();
  item.ingredients = String(input.ingredients).trim();
  item.method = String(input.method).trim();
  item.servingNotes = (input.servingNotes || '').trim();
  item.youtubeUrl = (input.youtubeUrl || '').trim();
  item.youtubeId = extractYoutubeId(input.youtubeUrl) || '';
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  return { item };
}

// Photo/video paths are set separately from the text fields above since
// they come from a multer upload step in the route, not plain form fields.
function setItemMedia(id, { photoPath, videoPath }) {
  const db = readDb();
  const item = (db.trainingItems || []).find(i => i.id === Number(id));
  if (!item) return { error: 'Training item not found.' };
  if (photoPath !== undefined) item.photoPath = photoPath;
  if (videoPath !== undefined) item.videoPath = videoPath;
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  return { item };
}

function deleteItem(id) {
  const db = readDb();
  const item = (db.trainingItems || []).find(i => i.id === Number(id));
  if (!item) return { error: 'Training item not found.' };
  db.trainingItems = (db.trainingItems || []).filter(i => i.id !== Number(id));
  writeDb(db);
  return { item };
}

// A handful of real starter entries for the new kitchen categories, so the
// page isn't empty the first time Kitchen Staff open it. Managers can edit
// or delete any of these like any other entry — nothing about them is
// special once created.
const KITCHEN_STARTER_ITEMS = [
  {
    category: 'recipe',
    name: 'Wild Mushroom Risotto',
    subtitle: 'Vegetarian main',
    ingredients: 'Arborio rice, mixed wild mushrooms, vegetable stock, dry white wine, grated parmesan, butter, shallot, garlic, fresh thyme, olive oil, salt & pepper — replace with your exact quantities and any allergens to flag.',
    method: '1. Sauté shallot and garlic in olive oil until soft.\n2. Add mushrooms, cook until browned, season, set aside.\n3. Toast the rice for 1-2 minutes, then add wine and reduce.\n4. Add warm stock a ladle at a time, stirring continuously, until the rice is creamy and al dente (about 18-20 minutes).\n5. Fold the mushrooms back through, finish with butter and parmesan off the heat.\n6. Taste and adjust seasoning before plating.',
    servingNotes: 'Finish with a shaving of parmesan, a drizzle of truffle oil if available, and fresh thyme. Serve immediately in a warmed bowl — risotto doesn\'t hold well.'
  },
  {
    category: 'recipe',
    name: 'Char-grilled Ribeye',
    subtitle: '8oz main, herb butter & fries',
    ingredients: '8oz ribeye steak, sea salt, cracked black pepper, herb butter (butter, parsley, garlic, lemon zest), beef dripping or oil for the grill, fries to serve.',
    method: '1. Bring the steak to room temperature and pat dry.\n2. Season generously with salt just before cooking.\n3. Char-grill on high heat, turning once, to the guest\'s requested doneness (use a probe thermometer if unsure).\n4. Rest for at least 5 minutes before slicing or serving whole.\n5. Top with a disc of herb butter while still hot so it melts over the steak.',
    servingNotes: 'Confirm doneness with the guest before firing. Rest time matters more than exact grill time — don\'t skip it.'
  },
  {
    category: 'prep',
    name: 'Mise en Place – Daily Prep Station Setup',
    subtitle: 'Every station, every shift',
    ingredients: 'Labelled/dated storage containers, cling film, colour-coded chopping boards, sharp knives, digital probe thermometer, today\'s prep list.',
    method: '1. Check the prep list against today\'s covers/bookings and the specials board.\n2. Pull stock from the walk-in using FIFO — oldest dated stock to the front.\n3. Prep each item to spec (see individual recipes), tasting and adjusting seasoning as you go.\n4. Store prepped items in labelled containers with today\'s date and a use-by date.\n5. Wipe down and sanitise the station before moving to the next task.\n6. Flag any low stock to the Head Chef/Kitchen Manager before service starts.',
    servingNotes: ''
  },
  {
    category: 'prep',
    name: 'FIFO Stock Rotation',
    subtitle: 'Walk-in & dry store',
    ingredients: 'Date labels, marker pen, stock rotation log (if used).',
    method: '1. When new stock arrives, label it with the delivery/prep date.\n2. Move existing stock to the front of the shelf/fridge; place new stock behind it.\n3. Always use the oldest dated stock first — never take from the back if there\'s older stock at the front.\n4. Check use-by dates daily during opening prep; flag anything expiring within 24 hours to a Manager.\n5. Discard anything past its use-by date — log it if your Manager asks you to track waste.',
    servingNotes: ''
  },
  {
    category: 'cleaning',
    name: 'End-of-Shift Deep Clean',
    subtitle: 'Kitchen, all sections',
    ingredients: 'Food-safe sanitiser spray, degreaser, colour-coded cloths, mop and food-safe floor cleaner, bin liners.',
    method: '1. Clear and wipe down all work surfaces and chopping boards; sanitise after cleaning.\n2. Clean the fryer/grill/oven surfaces per manufacturer guidance once cooled.\n3. Wash and put away all pans, utensils, and equipment used during service.\n4. Sweep and mop the floor, including under equipment where safe to do so.\n5. Empty all bins, replace liners, and take waste to the designated external bin area.\n6. Do a final check of the walk-in and dry store for anything left out overnight.',
    servingNotes: ''
  },
  {
    category: 'cleaning',
    name: 'HACCP Daily Cleaning Schedule',
    subtitle: 'Food safety compliance',
    ingredients: 'Cleaning schedule sheet/log (paper or digital), approved sanitiser, thermometer for fridge/freezer checks.',
    method: '1. Record fridge and freezer temperatures at the start and end of shift.\n2. Sanitise all food-contact surfaces before and after use, and between raw/cooked tasks.\n3. Check and log that hand-wash stations are stocked (soap, paper towels, sanitiser).\n4. Complete the daily cleaning schedule sign-off — initial each completed task.\n5. Report any equipment faults (fridge running warm, etc.) to a Manager immediately, don\'t wait for the next shift.',
    servingNotes: ''
  }
];

// Idempotent — only seeds if there is currently zero content in ANY
// kitchen category, so it never re-adds content a Manager has since edited
// or deleted, and never duplicates on every server restart. Called once
// from server.js at boot, same pattern as bootstrapAdmin() there.
function seedKitchenStarterContent() {
  const db = readDb();
  const items = db.trainingItems || [];
  const kitchenCategoryValues = CATEGORIES.filter(c => c.audience === 'kitchen').map(c => c.value);
  const hasAnyKitchenContent = items.some(i => kitchenCategoryValues.includes(i.category));
  if (hasAnyKitchenContent) return;
  KITCHEN_STARTER_ITEMS.forEach(starter => createItem(starter, null));
}

module.exports = {
  CATEGORIES, CATEGORY_VALUES, CATEGORY_LABELS, FIELD_LABELS, SECTIONS,
  extractYoutubeId, listItems, listItemsByCategory, getItem, visibleSections,
  createItem, updateItem, setItemMedia, deleteItem, seedKitchenStarterContent
};
