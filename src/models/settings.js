// App-wide settings (opening hours, slot duration, reminder timing, etc.)
// — a single small object, so no need for its own data file.
const { readDb, writeDb } = require('../db');

function getSettings() {
  return readDb().settings;
}
function saveSettings(settings) {
  const db = readDb();
  db.settings = { ...db.settings, ...settings };
  writeDb(db);
  return db.settings;
}

module.exports = { getSettings, saveSettings };
