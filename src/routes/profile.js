const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const { isValidPassword, PASSWORD_RULES } = require('../password');
const { toDateStr, todayStr } = require('../dateUtils');
const { forgotLimiter } = require('../rateLimiters');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return 'Off';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// This week's Mon-Sun worked-hours mini calendar for the profile page —
// zero minutes on a day just reads as "Off" (see formatDuration above).
function buildWeekSummary(userId) {
  const weekStart = mondayOf(todayStr());
  const weekEnd = addDays(weekStart, 6);
  const days = models.getWeeklyHoursForUser(userId, weekStart, weekEnd);
  return days.map((d, i) => ({
    date: d.date,
    dayName: DAY_NAMES[i],
    shortDate: new Date(d.date + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }),
    minutes: d.minutes,
    label: formatDuration(d.minutes),
    isToday: d.date === todayStr()
  }));
}

const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype] || '.jpg';
    cb(null, `user-${req.session.userId}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new Error('Please upload a JPG, PNG, or WEBP image.'));
    }
    cb(null, true);
  }
});

router.get('/', async (req, res) => {
  const user = await models.getUserById(req.session.userId);
  res.render('profile', { profileUser: user, error: null, success: null, weekDays: buildWeekSummary(user.id) });
});

router.post('/avatar', (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    // The cropper UI submits via fetch() and asks for JSON; a plain <form>
    // submit (JS-disabled fallback / "upload without cropping") gets an
    // HTML re-render of the profile page instead.
    const wantsJson = (req.headers.accept || '').includes('application/json');
    const user = await models.getUserById(req.session.userId);

    if (err) {
      const message = err.message || 'Upload failed.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('profile', { profileUser: user, error: message, success: null, weekDays: buildWeekSummary(user.id) });
    }
    if (!req.file) {
      const message = 'Please choose an image file.';
      if (wantsJson) return res.status(400).json({ error: message });
      return res.status(400).render('profile', { profileUser: user, error: message, success: null, weekDays: buildWeekSummary(user.id) });
    }

    // Remove the old avatar file (if any) so we don't accumulate old uploads.
    if (user.avatarPath) {
      const oldFile = path.join(AVATAR_DIR, path.basename(user.avatarPath));
      fs.unlink(oldFile, () => {});
    }

    const newAvatarPath = `/img/avatars/${req.file.filename}`;
    await models.setUserAvatar(req.session.userId, newAvatarPath);
    req.session.avatarPath = newAvatarPath;

    if (wantsJson) return res.json({ ok: true, avatarPath: newAvatarPath });

    const updatedUser = await models.getUserById(req.session.userId);
    res.render('profile', { profileUser: updatedUser, error: null, success: 'Profile picture updated.', weekDays: buildWeekSummary(updatedUser.id) });
  });
});

router.post('/avatar/remove', async (req, res) => {
  const user = await models.getUserById(req.session.userId);
  if (user.avatarPath) {
    const oldFile = path.join(AVATAR_DIR, path.basename(user.avatarPath));
    fs.unlink(oldFile, () => {});
  }
  await models.setUserAvatar(req.session.userId, '');
  req.session.avatarPath = '';
  res.redirect('/profile');
});

// ---- Self-service change password / kiosk PIN, gated by an emailed code ----
// Both are small JSON APIs called via fetch() from profile.ejs — see that
// file's script block. Rate-limited with the same forgotLimiter used for
// forgot-password/forgot-PIN, since these also send an email on every call
// and a code is guessable in ~1M tries without a cap.

router.post('/password/send-code', forgotLimiter, async (req, res) => {
  const result = await models.requestVerificationCode(req.session.userId, 'password');
  if (result.error) return res.status(400).json({ error: result.error });
  const { subject, text } = notify.selfVerificationCodeEmail(result.user, result.code, 'password');
  await notify.sendEmail({ to: result.user.email, subject, text, type: 'self-verify-password' });
  res.json({ ok: true, maskedEmail: maskEmail(result.user.email) });
});

router.post('/password/confirm', forgotLimiter, async (req, res) => {
  const { code, password, confirmPassword } = req.body;
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (!isValidPassword(password || '')) {
    return res.status(400).json({ error: PASSWORD_RULES });
  }
  const result = await models.confirmPasswordChange(req.session.userId, code, password);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.post('/pin/send-code', forgotLimiter, async (req, res) => {
  const result = await models.requestVerificationCode(req.session.userId, 'pin');
  if (result.error) return res.status(400).json({ error: result.error });
  const { subject, text } = notify.selfVerificationCodeEmail(result.user, result.code, 'pin');
  await notify.sendEmail({ to: result.user.email, subject, text, type: 'self-verify-pin' });
  res.json({ ok: true, maskedEmail: maskEmail(result.user.email) });
});

router.post('/pin/confirm', forgotLimiter, async (req, res) => {
  const { code, pin, confirmPin } = req.body;
  if (pin !== confirmPin) {
    return res.status(400).json({ error: 'PINs do not match.' });
  }
  if (!/^\d{4}$/.test(String(pin || ''))) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
  }
  const result = await models.confirmPinChange(req.session.userId, code, pin);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// Doesn't need to be secret, just reassuring — "we sent it to j***n@..." so
// the person knows the email went somewhere plausible without printing it
// in full on screen.
function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return email || '';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

module.exports = router;
