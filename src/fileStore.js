// Shared helper for storing actual photo bytes in CockroachDB (the `files`
// table — see db/schema.sql) instead of on disk. Used by every route that
// captures/uploads an image: kiosk clock-in/break/duty selfies, profile +
// admin-set avatars, Cash Safe photos, Training recipe photos, and Report
// image attachments.
//
// Deliberately images only. CockroachDB recommends keeping BYTES values
// under ~1MB for performance (write amplification / OOM risk above that —
// see https://www.cockroachlabs.com/docs/stable/bytes), so MAX_IMAGE_BYTES
// below enforces a cap comfortably under that. Anything that can't fit
// there (Training's how-to videos, Reports' video/audio/PDF/Word
// attachments) stays on the persistent disk (src/persist.js) as before —
// this module is not used for those.
const { query } = require('./sqlPool');

// A phone/webcam JPEG at normal quality is typically well under this; a
// full-resolution photo occasionally isn't, so uploads over this size are
// rejected with a clear message rather than silently written past
// CockroachDB's recommended per-value limit.
const MAX_IMAGE_BYTES = 900 * 1024; // 900KB

const IMAGE_MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

async function saveFile({ category, filename, mimeType, buffer, uploadedByUserId }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('saveFile requires a Buffer.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    const err = new Error(`Photo is too large (${Math.round(buffer.length / 1024)}KB) — please retake it under ${Math.round(MAX_IMAGE_BYTES / 1024)}KB.`);
    err.isImageTooLarge = true;
    throw err;
  }
  const { rows } = await query(
    `INSERT INTO files (category, filename, mime_type, size_bytes, data, uploaded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [category, filename || '', mimeType, buffer.length, buffer, uploadedByUserId || null]
  );
  return rows[0].id;
}

async function getFile(id) {
  if (id === undefined || id === null || id === '') return null;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  const { rows } = await query(
    `SELECT id, category, filename, mime_type, size_bytes, data, created_at FROM files WHERE id = $1`,
    [numId]
  );
  return rows[0] || null;
}

async function deleteFile(id) {
  if (id === undefined || id === null || id === '') return;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return;
  await query(`DELETE FROM files WHERE id = $1`, [numId]);
}

// Express handler shared by every "serve this stored photo" route. Callers
// pass in the resolved file id and an optional expected category (defense
// in depth — makes sure e.g. a cash-safe photo id can't be pulled back out
// through a route meant for a different category).
async function sendStoredFile(res, id, expectedCategory) {
  const file = await getFile(id);
  if (!file) return res.status(404).render('404');
  if (expectedCategory && file.category !== expectedCategory) return res.status(404).render('404');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(file.data);
}

// Deletes whatever an "avatarPath"-style field currently points at —
// either a CockroachDB-stored row (/files/<id>, current format) or, for
// data left over from before this migration, a file on disk under
// legacyDir. Safe to call with an empty/missing value. Used everywhere a
// stored photo gets replaced or removed (kiosk selfies, profile/admin
// avatars, training photos, etc.) so callers don't each reimplement the
// "which format is this" check.
function deleteStoredImageRef(pathValue, legacyDir) {
  if (!pathValue) return;
  const dbMatch = String(pathValue).match(/^\/files\/(\d+)$/);
  if (dbMatch) {
    deleteFile(dbMatch[1]).catch(err => console.error('Failed to delete stored photo:', err.message));
    return;
  }
  if (!legacyDir) return;
  const fs = require('fs');
  const path = require('path');
  fs.unlink(path.join(legacyDir, path.basename(pathValue)), () => {});
}

module.exports = { saveFile, getFile, deleteFile, sendStoredFile, deleteStoredImageRef, MAX_IMAGE_BYTES, IMAGE_MIME_EXT };
