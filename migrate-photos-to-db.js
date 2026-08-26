// One-off — moves every existing on-disk photo into CockroachDB (the
// `files` table — see db/schema.sql and src/fileStore.js), and rewrites
// whatever record referenced it (a CockroachDB users row, or one of the
// still-JSON-backed collections in data/db.json) to point at the new
// /files/<id> (or, for cash-safe/report entries, the bare id / "db:<id>"
// marker — matching the conventions those routes already use for new
// uploads since the photo-storage migration).
//
// Deliberately conservative: this does NOT delete the original files from
// disk. If anything here needs to be redone or checked by hand, the
// originals are still sitting exactly where they were (and, on a hosted
// instance, backed by PERSIST_DIR same as always) — this script only adds
// rows to CockroachDB and updates the pointer fields, nothing is
// destructive. Safe to run more than once: anything already migrated
// (value already starting with /files/, db:, or already a bare numeric id)
// is skipped.
//
// Reports attachments are the one exception with a further rule: only
// image files (jpg/png/webp/gif) get moved into the DB — video/audio/PDF/
// Word attachments are deliberately left on disk (see reports.js's comment
// on why: CockroachDB recommends keeping stored BYTES values under ~1MB,
// and those files are allowed up to 20MB).
//
// Usage: node migrate-photos-to-db.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { readDb, writeDb } = require('./src/db');
const fileStore = require('./src/fileStore');
const { getClient, getPool } = require('./src/sqlPool');

const ROOT = __dirname;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
}

let migrated = 0;
let skippedAlready = 0;
let skippedMissing = 0;

// data/db.json is JSON-era data — its userId/loggedByUserId/etc. fields
// were written before (or independent of) the CockroachDB users table, so
// they don't reliably point at a row that still exists there (especially
// after fix-serial-ids.js rebuilt that table from scratch earlier in this
// migration). files.uploaded_by_user_id has a foreign key to users(id), so
// any id that isn't a real current user gets stored as NULL instead of
// failing the whole insert — this is just "who uploaded it" metadata, not
// something the app's behavior depends on.
let validUserIds = new Set();
function safeUserId(id) {
  if (id === null || id === undefined) return null;
  return validUserIds.has(Number(id)) ? Number(id) : null;
}

// Reads a "/img/avatars/xyz.jpg"-style value off disk under public/, saves
// it into the files table, and returns the new "/files/<id>" path — or
// null if there was nothing to migrate (already migrated, or the on-disk
// file no longer exists).
async function migrateUrlPath(value, category, uploadedByUserId) {
  if (!value) return null;
  if (/^\/files\/\d+$/.test(value)) { skippedAlready++; return null; }
  const filePath = path.join(ROOT, 'public', value.replace(/^\//, ''));
  if (!fs.existsSync(filePath)) { skippedMissing++; return null; }
  const buffer = fs.readFileSync(filePath);
  const fileId = await fileStore.saveFile({ category, filename: path.basename(filePath), mimeType: mimeFromExt(filePath), buffer, uploadedByUserId: safeUserId(uploadedByUserId) });
  migrated++;
  return `/files/${fileId}`;
}

async function migrateUsers() {
  const client = await getClient();
  try {
    const { rows } = await client.query(`SELECT id, avatar_path, live_shift_avatar_path FROM users`);
    validUserIds = new Set(rows.map(u => u.id));
    for (const u of rows) {
      const newAvatar = await migrateUrlPath(u.avatar_path, 'avatar', u.id);
      if (newAvatar) await client.query(`UPDATE users SET avatar_path = $1 WHERE id = $2`, [newAvatar, u.id]);
      const newLive = await migrateUrlPath(u.live_shift_avatar_path, 'avatar', u.id);
      if (newLive) await client.query(`UPDATE users SET live_shift_avatar_path = $1 WHERE id = $2`, [newLive, u.id]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  console.log('Migrating users.avatar_path / live_shift_avatar_path (CockroachDB)...');
  await migrateUsers();

  console.log('Migrating data/db.json collections (time entries, duty reports, cash logs, report attachments, training photos)...');
  const db = readDb();

  for (const entry of db.timeEntries || []) {
    const newPath = await migrateUrlPath(entry.selfiePath, 'clock_selfie', entry.userId);
    if (newPath) entry.selfiePath = newPath;
  }

  for (const report of db.dutyReports || []) {
    const newPath = await migrateUrlPath(report.photoPath, 'duty_photo', report.submittedByUserId);
    if (newPath) report.photoPath = newPath;
  }

  for (const log of db.cashLogs || []) {
    if (!log.photoPath || /^\d+$/.test(log.photoPath)) { skippedAlready++; continue; }
    const filePath = path.join(ROOT, 'uploads', 'cash-safe', path.basename(log.photoPath));
    if (!fs.existsSync(filePath)) { skippedMissing++; continue; }
    const buffer = fs.readFileSync(filePath);
    const fileId = await fileStore.saveFile({ category: 'cash_safe_photo', filename: path.basename(filePath), mimeType: mimeFromExt(filePath), buffer, uploadedByUserId: safeUserId(log.loggedByUserId) });
    log.photoPath = String(fileId);
    migrated++;
  }

  for (const report of db.reports || []) {
    for (const file of report.files || []) {
      if (!file.path || file.path.startsWith('db:')) { skippedAlready++; continue; }
      if (!IMAGE_MIME_TYPES.has(file.mimeType)) continue; // video/audio/pdf/docx deliberately stay on disk
      const filePath = path.join(ROOT, 'uploads', 'reports', path.basename(file.path));
      if (!fs.existsSync(filePath)) { skippedMissing++; continue; }
      const buffer = fs.readFileSync(filePath);
      const fileId = await fileStore.saveFile({ category: 'report_photo', filename: file.originalName || path.basename(filePath), mimeType: file.mimeType, buffer, uploadedByUserId: safeUserId(report.reportedByUserId) });
      file.path = `db:${fileId}`;
      migrated++;
    }
  }

  for (const item of db.trainingItems || []) {
    const newPath = await migrateUrlPath(item.photoPath, 'training_photo', null);
    if (newPath) item.photoPath = newPath;
  }

  writeDb(db);

  console.log('');
  console.log(`Done. Migrated: ${migrated}. Already migrated (skipped): ${skippedAlready}. On-disk file missing (skipped): ${skippedMissing}.`);
  console.log('Original files were NOT deleted from disk — safe to remove by hand later once you\'ve confirmed everything looks right.');

  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
