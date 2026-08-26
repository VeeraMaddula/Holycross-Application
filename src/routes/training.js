const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const models = require('../models');
const { requireTrainingEditAccess } = require('../middleware');
const { MANAGER_ROLES } = require('../roles');
const fileStore = require('../fileStore');

function canUserEdit(res) {
  const u = res.locals.currentUser;
  return !!(u && (MANAGER_ROLES.includes(u.role) || u.canEditTraining));
}

// Recipe photos go into CockroachDB now (category 'training_photo', same
// public access level as before — see src/routes/publicFiles.js). How-to
// videos stay on disk under public/video/training — CockroachDB recommends
// keeping stored BYTES values under ~1MB, and these are allowed up to 60MB,
// so they're not a fit for the files table at all.
const PHOTO_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'training'); // fallback for pre-migration photos only
const VIDEO_DIR = path.join(__dirname, '..', '..', 'public', 'video', 'training');
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

// Custom storage engine: video files stream straight to disk (as before,
// since they're too big for the DB); photo files buffer into memory
// (file.buffer) so the route handlers can hand them to fileStore.saveFile
// instead. multer only supports one storage engine per instance, hence the
// branch on file.fieldname here rather than two separate multer() configs.
const mixedStorage = {
  _handleFile(req, file, cb) {
    if (file.fieldname === 'video') {
      const ext = VIDEO_TYPES[file.mimetype] || '';
      const filename = `training-video-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      const outPath = path.join(VIDEO_DIR, filename);
      const outStream = fs.createWriteStream(outPath);
      file.stream.pipe(outStream);
      outStream.on('error', cb);
      outStream.on('finish', () => cb(null, { path: outPath, filename, size: outStream.bytesWritten }));
    } else {
      const chunks = [];
      file.stream.on('data', (chunk) => chunks.push(chunk));
      file.stream.on('error', cb);
      file.stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        cb(null, { buffer, size: buffer.length });
      });
    }
  },
  _removeFile(req, file, cb) {
    if (file.path) return fs.unlink(file.path, () => cb(null));
    cb(null);
  }
};

const upload = multer({
  storage: mixedStorage,
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

function removeVideoIfLocal(publicPath) {
  if (!publicPath) return;
  const filename = path.basename(publicPath);
  fs.unlink(path.join(VIDEO_DIR, filename), () => {});
}

router.get('/', (req, res) => {
  const sections = models.visibleTrainingSections(res.locals.currentUser);
  res.render('training/index', {
    grouped: models.listTrainingItemsByCategory(),
    categories: models.TRAINING_CATEGORIES,
    sections,
    canEdit: canUserEdit(res)
  });
});

router.get('/new', requireTrainingEditAccess, (req, res) => {
  const sections = models.visibleTrainingSections(res.locals.currentUser);
  const defaultCategory = (sections[0] && sections[0].categories[0]) || models.TRAINING_CATEGORIES[0].value;
  res.render('training/form', {
    item: null,
    category: models.TRAINING_CATEGORIES.some(c => c.value === req.query.category) ? req.query.category : defaultCategory,
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
  const category = models.TRAINING_CATEGORIES.find(c => c.value === item.category);
  res.render('training/detail', {
    item,
    fieldLabels: models.TRAINING_FIELD_LABELS[item.category],
    categoryLabel: models.TRAINING_CATEGORY_LABELS[item.category],
    categoryLabelSingular: category ? category.labelSingular : 'item',
    canEdit: canUserEdit(res)
  });
});

// Both create and edit are small JSON APIs called via fetch() from
// training/form.ejs's submit interceptor (multipart bodies can't carry the
// CSRF token in a hidden field — see the same pattern already used by
// reports.ejs/cash-safe.ejs/profile.ejs's avatar upload).
// Buffers the uploaded photo into CockroachDB and returns its /files/<id>
// path, or null if no photo was included in this submit.
async function savePhotoIfPresent(req, uploadedByUserId) {
  const photoFile = req.files && req.files.photo && req.files.photo[0];
  if (!photoFile) return undefined;
  const fileId = await fileStore.saveFile({
    category: 'training_photo',
    filename: photoFile.originalname,
    mimeType: photoFile.mimetype,
    buffer: photoFile.buffer,
    uploadedByUserId
  });
  return `/files/${fileId}`;
}

router.post('/', requireTrainingEditAccess, (req, res) => {
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    const cleanup = () => {
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
    const videoFile = req.files && req.files.video && req.files.video[0];
    let photoPath;
    try {
      photoPath = await savePhotoIfPresent(req, req.session.userId);
    } catch (fileErr) {
      cleanup();
      return res.status(400).json({ error: fileErr.message || 'Photo upload failed.' });
    }
    if (photoPath !== undefined || videoFile) {
      models.setTrainingItemMedia(result.item.id, {
        photoPath,
        videoPath: videoFile ? `/video/training/${videoFile.filename}` : undefined
      });
    }
    res.json({ ok: true, redirect: `/training/${result.item.id}` });
  });
});

router.post('/:id', requireTrainingEditAccess, (req, res) => {
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    const existing = models.getTrainingItem(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Training item not found.' });

    const cleanup = () => {
      (req.files && req.files.video || []).forEach(f => fs.unlink(f.path, () => {}));
    };
    const { category, name, subtitle, ingredients, method, servingNotes, youtubeUrl } = req.body;
    const result = models.updateTrainingItem(req.params.id, { category, name, subtitle, ingredients, method, servingNotes, youtubeUrl });
    if (result.error) {
      cleanup();
      return res.status(400).json({ error: result.error });
    }
    const videoFile = req.files && req.files.video && req.files.video[0];
    let photoPath;
    try {
      photoPath = await savePhotoIfPresent(req, req.session.userId);
    } catch (fileErr) {
      cleanup();
      return res.status(400).json({ error: fileErr.message || 'Photo upload failed.' });
    }
    if (photoPath !== undefined || videoFile) {
      if (photoPath !== undefined) fileStore.deleteStoredImageRef(existing.photoPath, PHOTO_DIR);
      if (videoFile) removeVideoIfLocal(existing.videoPath);
      models.setTrainingItemMedia(existing.id, {
        photoPath,
        videoPath: videoFile ? `/video/training/${videoFile.filename}` : undefined
      });
    }
    res.json({ ok: true, redirect: `/training/${existing.id}` });
  });
});

router.post('/:id/delete', requireTrainingEditAccess, (req, res) => {
  const item = models.getTrainingItem(req.params.id);
  if (!item) return res.status(404).render('404');
  fileStore.deleteStoredImageRef(item.photoPath, PHOTO_DIR);
  removeVideoIfLocal(item.videoPath);
  models.deleteTrainingItem(req.params.id);
  res.redirect('/training');
});

module.exports = router;
