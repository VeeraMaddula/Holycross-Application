const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const pinLockout = require('../pinLockout');
const { kioskPinLimiter, forgotLimiter } = require('../rateLimiters');

// Shares the same folder as the profile-page avatar upload (src/routes/profile.js)
// since a kiosk clock-in photo becomes that person's profile picture — same
// thing, just captured on the shared tablet instead of uploaded by hand.
const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// A permanent archive of every clock-in/break photo, separate from
// AVATAR_DIR above — the avatars/ copy becomes the person's "live" tile
// picture and gets deleted the moment their NEXT clock action happens (see
// dropLiveShiftFile below), so it can't be relied on to still exist by the
// time anyone looks at historical clock entries (e.g. the Logs page).
// Nothing ever deletes from here.
const CLOCK_SELFIE_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'clock-selfies');
fs.mkdirSync(CLOCK_SELFIE_DIR, { recursive: true });

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    // Doesn't depend on req.body (userId arrives as a separate multipart
    // field and isn't reliably parsed yet when this callback fires) — a
    // timestamp + random suffix is enough to keep filenames unique.
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
      cb(null, `kiosk-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error('Please capture a photo to continue.'));
    cb(null, true);
  }
});

// Separate folder for the After Breakfast / After Carvery Duties "who's
// submitting + live photo" step (src/persist.js also needs to know about
// this directory so it survives redeploys on a hosted instance).
const DUTY_PHOTO_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'duty-photos');
fs.mkdirSync(DUTY_PHOTO_DIR, { recursive: true });

const dutyPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DUTY_PHOTO_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
      cb(null, `duty-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error('Please capture a photo to continue.'));
    cb(null, true);
  }
});

// These two sections specifically ask "who's submitting?" and take a live
// photo as part of Submit — Opening and Closing don't, since they close out
// from whoever's already at the PIN-gated clock pad rather than the
// ambient duties panel.
const PHOTO_REQUIRED_SECTIONS = ['after_breakfast', 'after_carvery'];

router.get('/', (req, res) => {
  res.render('kiosk', { staff: models.getKioskRoster() });
});

// Lightweight status refresh for the tile grid — same polling pattern used
// on the Tables page, so a tile flips from "Clocked out" to "Present"
// automatically if someone clocks in on another device.
router.get('/status', (req, res) => {
  const roster = models.getKioskRoster().map(s => ({ id: s.id, status: s.status, avatarPath: s.avatarPath, since: s.since }));
  res.json(roster);
});

// Step 1: tap a tile, enter the PIN. Returns current status + which actions
// are valid next, so the client can render the right buttons.
router.post('/verify', kioskPinLimiter, (req, res) => {
  const { userId, pin } = req.body;
  const user = models.getUserById(userId);
  if (!user || !user.active || user.role === 'kiosk') {
    return res.status(400).json({ error: 'Staff member not found.' });
  }
  if (!user.pinHash) {
    return res.status(400).json({ error: 'No PIN set for this account yet — ask a manager to set one on the Users page.' });
  }
  // Per-account lockout — closes the brute-force gap a 4-digit PIN (only
  // 10,000 combinations) would otherwise leave open, regardless of where
  // the requests are coming from. See pinLockout.js.
  if (pinLockout.isLocked(user.id)) {
    return res.status(429).json({ error: `Too many wrong PIN attempts. Try again in ${pinLockout.minutesRemaining(user.id)} minute(s), or ask a manager to reset your PIN.` });
  }
  if (!models.verifyUserPin(user.id, pin)) {
    pinLockout.recordFailure(user.id);
    return res.status(400).json({ error: 'Wrong PIN. Try again.' });
  }
  pinLockout.recordSuccess(user.id);
  const status = models.getStaffStatus(user.id);
  res.json({ ok: true, status: status.status });
});

// There's no self-service PIN reset from the tablet — that would defeat the
// point of a PIN gate on clock-in — so "Forgot PIN?" just alerts whoever can
// set a new one from the Users page (Manager/Floor Manager/Senior
// Manager/General Manager/Admin).
router.post('/forgot-pin', forgotLimiter, async (req, res) => {
  const { userId } = req.body;
  const user = models.getUserById(userId);
  if (!user || !user.active || user.role === 'kiosk') {
    return res.status(400).json({ error: 'Staff member not found.' });
  }
  await notify.notifyManagersPinResetRequest(user);
  res.json({ ok: true });
});

// clock_in / break_start / break_end all capture a fresh photo — it becomes
// the person's "live" picture for the rest of their shift (liveShiftAvatarPath),
// shown everywhere in place of their saved profile picture without ever
// touching that saved picture. clock_out needs no photo and clears the live
// photo, so their normal profile picture reappears everywhere.
const PHOTO_ACTIONS = ['clock_in', 'break_start', 'break_end'];

// Step 2: tap Clock In / Clock Out / Start Break / End Break. The PIN is
// re-checked server-side rather than trusting the client's earlier /verify
// call, so a tampered request can't skip straight to logging an action.
// Always sent as multipart/form-data from the client (simplest to have one
// shape); only the PHOTO_ACTIONS above actually include a "photo" field.
router.post('/action', kioskPinLimiter, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });

    const { userId, pin, action } = req.body;
    const user = models.getUserById(userId);
    if (!user || !user.active || user.role === 'kiosk') {
      return res.status(400).json({ error: 'Staff member not found.' });
    }
    if (pinLockout.isLocked(user.id)) {
      return res.status(429).json({ error: `Too many wrong PIN attempts. Try again in ${pinLockout.minutesRemaining(user.id)} minute(s), or ask a manager to reset your PIN.` });
    }
    if (!models.verifyUserPin(user.id, pin)) {
      pinLockout.recordFailure(user.id);
      return res.status(400).json({ error: 'Wrong PIN.' });
    }
    pinLockout.recordSuccess(user.id);
    const status = models.getStaffStatus(user.id);
    const allowed = models.nextValidAction(status.status);
    const allowedList = Array.isArray(allowed) ? allowed : [allowed].filter(Boolean);
    if (!allowedList.includes(action)) {
      return res.status(400).json({ error: 'That action is no longer available — please try again.' });
    }

    // Only ever deletes the temporary live-shift photo file — never the
    // person's actual saved profile picture (public/img/avatars/user-*).
    function dropLiveShiftFile() {
      if (user.liveShiftAvatarPath) {
        fs.unlink(path.join(AVATAR_DIR, path.basename(user.liveShiftAvatarPath)), () => {});
      }
    }

    let effectiveAvatarPath;
    let archivedSelfiePath = '';
    if (PHOTO_ACTIONS.includes(action)) {
      if (!req.file) return res.status(400).json({ error: 'A photo is required for this step.' });
      dropLiveShiftFile();
      effectiveAvatarPath = `/img/avatars/${req.file.filename}`;
      models.setUserLiveShiftAvatar(user.id, effectiveAvatarPath);
      // Permanent copy for the clock-entry log — see CLOCK_SELFIE_DIR above.
      const archiveFilename = `selfie-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(req.file.filename)}`;
      try {
        fs.copyFileSync(req.file.path, path.join(CLOCK_SELFIE_DIR, archiveFilename));
        archivedSelfiePath = `/img/clock-selfies/${archiveFilename}`;
      } catch (err) {
        console.error('Failed to archive clock-in selfie:', err.message);
      }
    } else {
      // clock_out — revert to their saved profile picture (may be '').
      dropLiveShiftFile();
      models.setUserLiveShiftAvatar(user.id, '');
      effectiveAvatarPath = user.avatarPath || '';
    }

    models.addClockEntry({
      userId: user.id,
      userName: user.name,
      action,
      selfiePath: archivedSelfiePath
    });

    // If a Bar Staff member just clocked out and that leaves nobody from
    // Bar Staff still on shift, and we're inside a Closing window, this was
    // "the last person out" — the moment the closing checklist should have
    // been checked. Fire-and-forget so the tablet's response isn't held up
    // waiting on an email send.
    if (action === 'clock_out' && user.role === 'bar_staff') {
      notify.checkClosingDutiesOnClockOut().catch(err => console.error('Closing duties check failed:', err.message));
    }

    res.json({ ok: true, avatarPath: effectiveAvatarPath });
  });
});

// ---- Bar Staff Duties panel (the corner tab/side panel on the kiosk
// screen) — ambient and shared, not gated behind a PIN like clock actions
// are, since it's a team checklist rather than an individual time record. ----

// Polled every ~30s by the kiosk page to know whether a duties section is
// currently in its scheduled window and, if so, its live checklist state.
router.get('/duties-status', (req, res) => {
  res.json(models.getDutyPanelState(new Date()));
});

router.post('/duties/toggle', (req, res) => {
  const { date, taskId } = req.body;
  if (!date || !taskId) return res.status(400).json({ error: 'Missing date/taskId.' });
  models.toggleDutyTask({ date, taskId, userId: null, userName: 'Bar Staff (kiosk)' });
  res.json({ ok: true });
});

// If everything's ticked, this just closes out the section for the day. If
// something's still unticked and no reason was sent yet, it responds
// asking for one instead of submitting — the kiosk then shows the "why not
// done?" prompt and calls this again with the reason filled in.
//
// After Breakfast Duties and After Carvery Duties are always sent as
// multipart/form-data with a "who submitted this" user id and a live photo
// (dutyPhotoUpload.single('photo') only actually parses the request if the
// content type is multipart — a plain urlencoded Opening/Closing submit
// passes straight through untouched, same trick /action uses above).
router.post('/duties/submit', (req, res) => {
  dutyPhotoUpload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });

    const { date, section, reason, submittedByUserId, submittedByName } = req.body;
    if (!date || !section) return res.status(400).json({ error: 'Missing date/section.' });
    const checklist = models.getDutiesChecklist(date);
    const sectionData = checklist.sections.find(s => s.key === section);
    if (!sectionData) return res.status(400).json({ error: 'Unknown duties section.' });

    let submitter = null;
    let photoPath = '';
    if (PHOTO_REQUIRED_SECTIONS.includes(section)) {
      submitter = models.getUserById(submittedByUserId);
      if (!submitter) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Please select who is submitting this.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'A photo is required to submit this.' });
      }
      photoPath = `/img/duty-photos/${req.file.filename}`;
    }

    const missing = sectionData.tasks.filter(t => !t.done);
    if (missing.length && !(reason && reason.trim())) {
      return res.json({ ok: true, needsReason: true, missing: missing.map(t => t.text) });
    }
    const { report, isNewIncomplete } = models.recordDutyReport({
      date,
      section,
      sectionTitle: sectionData.title,
      complete: missing.length === 0,
      reason: missing.length ? reason.trim() : '',
      missingTaskTexts: missing.map(t => t.text),
      staffOnShiftNames: models.getBarStaffOnShiftNames(),
      trigger: 'manual',
      submittedByUserId: submitter ? submitter.id : null,
      submittedByName: submitter ? submitter.name : (submittedByName || ''),
      photoPath
    });
    if (isNewIncomplete) {
      await notify.notifyManagersDutyReport(report);
    }
    res.json({ ok: true, submitted: true });
  });
});

module.exports = router;
