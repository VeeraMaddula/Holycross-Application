const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const { requireTrainingEditAccess } = require('../middleware');
const { MANAGER_ROLES } = require('../roles');

function canUserEdit(res) {
  const u = res.locals.currentUser;
  return !!(u && (MANAGER_ROLES.includes(u.role) || u.canEditTraining));
}

// Recipe photos and how-to videos are learning material, not confidential
// data (unlike cash-safe/report evidence) — they live under public/ and are
// served directly, same pattern as staff avatars.
const PHOTO_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'training');
const VIDEO_DIR = path.join(__dirname, '..', '..', 'public', 'video', 'training');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, file.fieldname === 'video' ? VIDEO_DIR : PHOTO_DIR);
    },
    filename: (req, file, cb) => {
      const table = file.fieldname === 'video' ? VIDEO_TYPES : PHOTO_TYPES;
      const ext = table[file.mimetype] || '';
      cb(null, `training-${file.fieldname}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'photo' && !PHOTO_TYPES[file.mimetype]) {
      return cb(new Error('Photo must be a JPG, PNG, or WEBP image.'));
    }
    if (file.fieldname === 'video' && !VIDEO_TYPES[file.mimetype]) {
      return cb(new Error('Video must be an MP4, WEBM, or MOV file.'));
    }
    cb(null, true);
  }
});

function removeFileIfLocal(publicPath, dir) {
  if (!publicPath) return;
  const filename = path.basename(publicPath);
  fs.unlink(path.join(dir, filename), () => {});
}

router.get('/', (req, res) => {
  res.render('training/index', {
    grouped: models.listTrainingItemsByCategory(),
    categories: models.TRAINING_CATEGORIES,
    canEdit: canUserEdit(res)
  });
});

router.get('/new', requireTrainingEditAccess, (req, res) => {
  res.render('training/form', {
    item: null,
    category: models.TRAINING_CATEGORIES.some(c => c.value === req.query.category) ? req.query.category : 'cocktail',
    categories: models.TRAINING_CATEGORIES,
    fieldLabels: models.TRAINING_FIELD_LABELS,
    error: null
  });
});

router.get('/:id/edit', requireTrainingEditAccess, (req, res) => {
  const item = models.getTrainingItem(req.params.id);
  if (!item) return res.status(404).render('404');
  res.render('training/form', {
    item,
    category: item.category,
    categories: models.TRAINING_CATEGORIES,
    fieldLabels: models.TRAINING_FIELD_LABELS,
    error: null
  });
});

router.get('/:id', (req, res) => {
  const item = models.getTrainingItem(req.params.id);
  if (!item) return res.status(404).render('404');
  res.render('training/detail', {
    item,
    fieldLabels: models.TRAINING_FIELD_LABELS[item.category],
    categoryLabel: models.TRAINING_CATEGORY_LABELS[item.category],
    canEdit: canUserEdit(res)
  });
});

// Both create and edit are small JSON APIs called via fetch() from
// training/form.ejs's submit interceptor (multipart bodies can't carry the
// CSRF token in a hidden field — see the same pattern already used by
// reports.ejs/cash-safe.ejs/profile.ejs's avatar upload).
router.post('/', requireTrainingEditAccess, (req, res) => {
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    const cleanup = () => {
      (req.files && req.files.photo || []).forEach(f => fs.unlink(f.path, () => {}));
      (req.files && req.files.video || []).forEach(f => fs.unlink(f.path, () => {}));
    };
    const { category, name, subtitle, ingredients, method, servingNotes, youtubeUrl } = req.body;
    const result = models.createTrainingItem(
      { category, name, subtitle, ingredients, method, servingNotes, youtubeUrl },
      req.session.userId
    );
    if (result.error) {
      cleanup();
      return res.status(400).json({ error: result.error });
    }
    const photoFile = req.files && req.files.photo && req.files.photo[0];
    const videoFile = req.files && req.files.video && req.files.video[0];
    if (photoFile || videoFile) {
      models.setTrainingItemMedia(result.item.id, {
        photoPath: photoFile ? `/img/training/${photoFile.filename}` : undefined,
        videoPath: videoFile ? `/video/training/${videoFile.filename}` : undefined
      });
    }
    res.json({ ok: true, redirect: `/training/${result.item.id}` });
  });
});

router.post('/:id', requireTrainingEditAccess, (req, res) => {
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    const existing = models.getTrainingItem(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipe not found.' });

    const cleanup = () => {
      (req.files && req.files.photo || []).forEach(f => fs.unlink(f.path, () => {}));
      (req.files && req.files.video || []).forEach(f => fs.unlink(f.path, () => {}));
    };
    const { category, name, subtitle, ingredients, method, servingNotes, youtubeUrl } = req.body;
    const result = models.updateTrainingItem(req.params.id, { category, name, subtitle, ingredients, method, servingNotes, youtubeUrl });
    if (result.error) {
      cleanup();
      return res.status(400).json({ error: result.error });
    }
    const photoFile = req.files && req.files.photo && req.files.photo[0];
    const videoFile = req.files && req.files.video && req.files.video[0];
    if (photoFile || videoFile) {
      if (photoFile) removeFileIfLocal(existing.photoPath, PHOTO_DIR);
      if (videoFile) removeFileIfLocal(existing.videoPath, VIDEO_DIR);
      models.setTrainingItemMedia(existing.id, {
        photoPath: photoFile ? `/img/training/${photoFile.filename}` : undefined,
        videoPath: videoFile ? `/video/training/${videoFile.filename}` : undefined
      });
    }
    res.json({ ok: true, redirect: `/training/${existing.id}` });
  });
});

router.post('/:id/delete', requireTrainingEditAccess, (req, res) => {
  const item = models.getTrainingItem(req.params.id);
  if (!item) return res.status(404).render('404');
  removeFileIfLocal(item.photoPath, PHOTO_DIR);
  removeFileIfLocal(item.videoPath, VIDEO_DIR);
  models.deleteTrainingItem(req.params.id);
  res.redirect('/training');
});

module.exports = router;
