// Simple dependency-free JSON file database.
// Good enough for a single-location bar/restaurant admin tool.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_DB_FILE = path.join(DATA_DIR, 'db.json');
// Tests point this at a throwaway temp file (via DB_FILE_PATH) so they never
// touch the real restaurant data. Resolved on every call (not cached at
// module load) so it works no matter how the test runner shares processes
// between test files.
function getDbFile() {
  return process.env.DB_FILE_PATH || DEFAULT_DB_FILE;
}

const DEFAULT_DATA = {
  tables: [
    { id: 1, name: 'Table 1', seats: 4, area: 'Main Floor' },
    { id: 2, name: 'Table 2', seats: 4, area: 'Main Floor' },
    { id: 3, name: 'Table 3', seats: 4, area: 'Main Floor' },
    { id: 4, name: 'Table 4', seats: 4, area: 'Main Floor' },
    { id: 5, name: 'Table 5', seats: 4, area: 'Main Floor' },
    { id: 6, name: 'Table 6', seats: 4, area: 'Main Floor' },
    { id: 7, name: 'Table 7', seats: 4, area: 'Main Floor' },
    { id: 8, name: 'Table 8', seats: 2, area: 'Main Floor' },
    { id: 9, name: 'Table 9', seats: 2, area: 'Main Floor' },
    { id: 10, name: 'Table 10', seats: 10, area: 'Main Floor' },
    { id: 11, name: 'Table 11', seats: 2, area: 'Main Floor' },
    { id: 12, name: 'Table 12', seats: 4, area: 'Main Floor' },
    { id: 13, name: 'Table 13', seats: 4, area: 'Main Floor' },
    { id: 14, name: 'Table 14', seats: 4, area: 'Main Floor' },
    { id: 15, name: 'Table 15', seats: 4, area: 'Main Floor' },
    { id: 16, name: 'Table 16', seats: 4, area: 'Main Floor' },
    { id: 17, name: 'Table 17', seats: 4, area: 'Main Floor' },
    { id: 18, name: 'Table 18', seats: 4, area: 'Main Floor' },
    { id: 19, name: 'Table 19', seats: 4, area: 'Main Floor' },
    { id: 20, name: 'Table 20', seats: 4, area: 'Main Floor' },
    { id: 21, name: 'Table 21', seats: 4, area: 'Main Floor' },
    { id: 22, name: 'Table 22', seats: 4, area: 'Main Floor' },
    { id: 23, name: 'Table 23', seats: 4, area: 'Main Floor' },
    { id: 24, name: 'Table 24', seats: 4, area: 'Main Floor' },
    { id: 25, name: 'Table 25', seats: 4, area: 'Main Floor' },
    { id: 26, name: 'Table 26', seats: 4, area: 'Main Floor' },
    { id: 27, name: 'Table 27', seats: 4, area: 'Main Floor' },
    { id: 28, name: 'Table 28', seats: 4, area: 'Main Floor' },
    { id: 29, name: 'Table 29', seats: 4, area: 'Main Floor' },
    { id: 30, name: 'Table 30', seats: 4, area: 'Main Floor' },
    { id: 31, name: 'Table 31', seats: 2, area: 'Main Floor' },
    { id: 32, name: 'Table 32', seats: 2, area: 'Main Floor' },
    { id: 33, name: 'Table 33', seats: 4, area: 'Main Floor' },
    { id: 34, name: 'Whitefield Room', seats: 100, area: 'Function Room' },
    { id: 35, name: 'Butlerstone Room', seats: 50, area: 'Function Room' }
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
  users: [],
  externalCalendarEvents: [],
  timeEntries: [],
  rosterShifts: [],
  requests: [],
  dutyCompletions: [],
  dutyReports: [],
  settings: {
    slotDurationMinutes: 90,
    reminderHoursBefore: 24,
    openHour: 11,
    closeHour: 23
  },
  meta: {
    nextBookingId: 1,
    nextTableId: 36,
    nextEventId: 1,
    nextNotificationId: 1,
    nextUserId: 1,
    nextTimeEntryId: 1,
    nextRosterShiftId: 1,
    nextRequestId: 1,
    lastGoogleSyncAt: null
  }
};

function ensureDb() {
  const dbFile = getDbFile();
  const dir = path.dirname(dbFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(getDbFile(), 'utf-8');
  return JSON.parse(raw);
}

function writeDb(data) {
  const dbFile = getDbFile();
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, dbFile);
}

module.exports = { readDb, writeDb, ensureDb, DATA_DIR, DEFAULT_DATA, get DB_FILE() { return getDbFile(); } };
