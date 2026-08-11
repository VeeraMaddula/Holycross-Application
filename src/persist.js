// Optional persistent-storage wiring for hosts with an ephemeral filesystem
// (e.g. Render's free/starter web services wipe local disk on every deploy
// and every restart). If PERSIST_DIR is set — point it at a mounted
// persistent disk — this redirects the app's writable directories there via
// symlinks, so a single disk covers everything that needs to survive a
// redeploy: the JSON database, staff avatars, kiosk clock-in/break selfies,
// and "Report an Issue" attachments. These are normally scattered across
// data/, public/img/avatars/, public/img/clock-selfies/, and
// uploads/reports/ — this ties them all under one persisted root without
// changing any of the app's own read/write code, since a symlink is
// transparent to fs.readFile/writeFile/etc.
//
// Safe to leave PERSIST_DIR unset (e.g. local dev) — setupPersistence()
// becomes a no-op and everything writes to the normal local paths.
const fs = require('fs');
const path = require('path');

// Plain fs.renameSync only works within a single filesystem/device. Some
// hosts (confirmed on Render) mount the persistent disk as a genuinely
// separate device from the app's own checkout, so the first-boot migration
// below throws EXDEV there even though the exact same code works fine
// locally (where everything's on one disk). Fall back to copy-then-delete
// when that happens — slower, but works everywhere.
function moveSync(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function ensureLink(realPath, persistTarget) {
  fs.mkdirSync(persistTarget, { recursive: true });
  fs.mkdirSync(path.dirname(realPath), { recursive: true });

  const exists = fs.existsSync(realPath);
  const isSymlink = exists && fs.lstatSync(realPath).isSymbolicLink();
  if (isSymlink) return; // already wired up from a previous boot

  if (exists) {
    // A real directory already exists at this path (first boot after
    // adding PERSIST_DIR, or migrating from a non-persistent setup) — move
    // whatever's already there into the persistent target once, then swap
    // the local path for a symlink so it stays that way going forward.
    for (const entry of fs.readdirSync(realPath)) {
      const from = path.join(realPath, entry);
      const to = path.join(persistTarget, entry);
      if (!fs.existsSync(to)) moveSync(from, to);
    }
    fs.rmSync(realPath, { recursive: true, force: true });
  }
  fs.symlinkSync(persistTarget, realPath, 'dir');
}

function setupPersistence() {
  const base = process.env.PERSIST_DIR;
  if (!base) return;
  const root = path.join(__dirname, '..');
  ensureLink(path.join(root, 'data'), path.join(base, 'data'));
  ensureLink(path.join(root, 'public', 'img', 'avatars'), path.join(base, 'avatars'));
  ensureLink(path.join(root, 'public', 'img', 'clock-selfies'), path.join(base, 'clock-selfies'));
  ensureLink(path.join(root, 'public', 'img', 'duty-photos'), path.join(base, 'duty-photos'));
  ensureLink(path.join(root, 'uploads', 'reports'), path.join(base, 'reports'));
}

module.exports = { setupPersistence };
