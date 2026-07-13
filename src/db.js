// Simple dependency-free JSON file database.
// Good enough for a single-location bar/restaurant admin tool.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DATA = {
  tables: [
    { id: 1, name: 'Table 1', seats: 2, area: 'Main Floor' },
    { id: 2, name: 'Table 2', seats: 2, area: 'Main Floor' },
    { id: 3, name: 'Table 3', seats: 4, area: 'Main Floor' },
    { id: 4, name: 'Table 4', seats: 4, area: 'Main Floor' },
    { id: 5, name: 'Table 5', seats: 6, area: 'Main Floor' },
    { id: 6, name: 'Bar 1', seats: 2, area: 'Bar' },
    { id: 7, name: 'Bar 2', seats: 2, area: 'Bar' },
    { id: 8, name: 'Patio 1', seats: 4, area: 'Patio' }
  ],
  bookings: [],
  menu: {
    intro: 'Fresh, seasonal plates and a hand-picked drinks list.',
    sections: [
      {
        title: 'Small Plates',
        items: [
          { name: 'Crispy Calamari', price: '11', desc: 'Lemon aioli, chili flake' },
          { name: 'Burrata', price: '13', desc: 'Heirloom tomato, basil oil, sourdough' }
        ]
      },
      {
        title: 'Mains',
        items: [
          { name: 'Char-grilled Ribeye', price: '32', desc: '8oz, herb butter, fries' },
          { name: 'Wild Mushroom Risotto', price: '19', desc: 'Parmesan, truffle oil' }
        ]
      },
      {
        title: 'Cocktails',
        items: [
          { name: 'Old Fashioned', price: '14', desc: 'Bourbon, bitters, orange' },
          { name: 'Espresso Martini', price: '14', desc: 'Vodka, coffee liqueur' }
        ]
      }
    ]
  },
  events: [],
  notifications: [],
  settings: {
    slotDurationMinutes: 90,
    reminderHoursBefore: 24,
    openHour: 11,
    closeHour: 23
  },
  meta: {
    nextBookingId: 1,
    nextTableId: 9,
    nextEventId: 1,
    nextNotificationId: 1
  }
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeDb(data) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = { readDb, writeDb, ensureDb, DATA_DIR, DB_FILE };
