// Training & Resources library: cocktail / spirit / beer recipe cards that
// Managers curate (photos, an uploaded how-to video, and/or a linked
// YouTube tutorial) for Bar/Kitchen Staff to browse and learn from. Read
// access is broad (any real staff account); editing is manager-tier only
// (or individually granted via canEditTraining — see requireTrainingAccess
// / requireTrainingEditAccess in src/middleware.js).
const { readDb, writeDb } = require('../db');

const CATEGORIES = [
  { value: 'cocktail', label: 'Cocktails', labelSingular: 'Cocktail' },
  { value: 'spirit', label: 'Spirits', labelSingular: 'Spirit' },
  { value: 'beer', label: 'Beers', labelSingular: 'Beer' }
];
const CATEGORY_VALUES = CATEGORIES.map(c => c.value);
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

// Field labels differ by category even though the underlying record shape
// is the same — a cocktail's "ingredients" is a spirit's "composition" is a
// beer's "what's in it." Kept as one flexible schema so the model/routes
// don't need three near-identical code paths; only the view's labels change.
const FIELD_LABELS = {
  cocktail: { subtitle: 'Style / glass', ingredients: 'Ingredients', method: 'Mixing method' },
  spirit: { subtitle: 'Spirit type', ingredients: 'Composition', method: 'How it\'s made' },
  beer: { subtitle: 'Beer style', ingredients: 'What\'s in it', method: 'How it\'s served' }
};

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
  if (!item) return { error: 'Recipe not found.' };
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
  if (!item) return { error: 'Recipe not found.' };
  if (photoPath !== undefined) item.photoPath = photoPath;
  if (videoPath !== undefined) item.videoPath = videoPath;
  item.updatedAt = new Date().toISOString();
  writeDb(db);
  return { item };
}

function deleteItem(id) {
  const db = readDb();
  const item = (db.trainingItems || []).find(i => i.id === Number(id));
  if (!item) return { error: 'Recipe not found.' };
  db.trainingItems = (db.trainingItems || []).filter(i => i.id !== Number(id));
  writeDb(db);
  return { item };
}

module.exports = {
  CATEGORIES, CATEGORY_VALUES, CATEGORY_LABELS, FIELD_LABELS,
  extractYoutubeId, listItems, listItemsByCategory, getItem,
  createItem, updateItem, setItemMedia, deleteItem
};
