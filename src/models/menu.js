// Menu & Events: the public-facing food/drinks menu content and the
// events list shown on the Menu & Events page.
const { readDb, writeDb } = require('../db');

function getMenu() {
  return readDb().menu;
}
function saveMenu(menu) {
  const db = readDb();
  db.menu = menu;
  writeDb(db);
}
function listEvents() {
  return readDb().events.sort((a, b) => a.date.localeCompare(b.date));
}
function createEvent({ title, date, description }) {
  const db = readDb();
  const event = { id: db.meta.nextEventId++, title, date, description: description || '' };
  db.events.push(event);
  writeDb(db);
  return event;
}
function deleteEvent(id) {
  const db = readDb();
  db.events = db.events.filter(e => e.id !== Number(id));
  writeDb(db);
}

module.exports = { getMenu, saveMenu, listEvents, createEvent, deleteEvent };
