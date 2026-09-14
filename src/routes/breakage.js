const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router();
const models = require('../models');
const notify = require('../notify');
const fileStore = require('../fileStore');

// Reports are created from the kiosk clock-out prompt (see
// src/routes/kiosk.js's POST /kiosk/breakage) — this router is otherwise
// read-only: the report list plus the "who's breaking/losing more stock"
// summary, for senior/general managers, admin, and the accountant role.
//
// Stock Delivery & Recheck (added here as a second tab on this same page)
// IS created from this router — a staff member logs each vendor delivery
// with an invoice photo, one or more physical-stock photos, and a tick
// confirming the delivered stock matches the invoice.
async function renderPage(req, res, status, error) {
  const [reports, byUser, deliveries] = await Promise.all([
    models.listBreakageReports(),
    models.getBreakageCountsByUser(),
    models.listStockDeliveries()
  ]);
  res.status(status || 200).render('breakage', {
    reports,
    byUser,
    deliveries,
    categoryLabels: models.BREAKAGE_CATEGORY_LABELS,
    stockCategories: models.STOCK_CATEGORIES,
    stockCategoryLabels: models.STOCK_CATEGORY_LABELS,
    error: error || null
  });
}

router.get('/', async (req, res) => {
  await renderPage(req, res);
});

// Invoice/stock photos here are always real phone-camera photos (not the
// AI-generated ones the menu photos started as), which are routinely
// 3-8MB straight off a camera — well over fileStore's 900KB CockroachDB
// storage cap. Rather than reject those uploads outright (the way
// cashSafe.js's single-photo capture does, where the photo comes off a
// small in-browser webcam canvas already), every image is re-encoded down
// to fit before it's stored — same approach as add-breakfast-menu.js.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 9 }, // 1 invoice + up to 8 stock photos
  fileFilter: (req, file, cb) => {
    const OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!OK.has(file.mimetype)) return cb(new Error(`"${file.originalname}" isn't a supported image type.`));
    cb(null, true);
  }
});

async function compressUnderLimit(buffer, maxBytes) {
  let width = 1600;
  let quality = 82;
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= maxBytes) return out;
    quality -= 12;
    if (quality < 40) { quality = 60; width = Math.round(width * 0.8); }
  }
  return sharp(buffer).rotate().resize({ width: 800 }).jpeg({ quality: 50, mozjpeg: true }).toBuffer();
}

// Deliberately NOT stored as "/files/<id>" — that path is served by
// src/routes/publicFiles.js's no-login-required route, which only allows a
// fixed allowlist of categories (avatars, menu photos, etc.) that this
// feature's photos are correctly excluded from. Invoice/stock photos are
// internal business records, so they're stored and served through this
// router's own "/breakage/photo/<id>" route instead, which sits behind the
// requireAuth + requireBreakageAccess gate already applied to /breakage in
// server.js.
async function saveDeliveryPhoto(file, category, uploadedByUserId) {
  const jpeg = await compressUnderLimit(file.buffer, fileStore.MAX_IMAGE_BYTES);
  const id = await fileStore.saveFile({
    category,
    filename: file.originalname.replace(/\.[^.]+$/, '.jpg'),
    mimeType: 'image/jpeg',
    buffer: jpeg,
    uploadedByUserId
  });
  return `/breakage/photo/${id}`;
}

router.post('/stock-deliveries', (req, res) => {
  upload.fields([{ name: 'invoicePhoto', maxCount: 1 }, { name: 'stockPhotos', maxCount: 8 }])(req, res, async (err) => {
    if (err) return await renderPage(req, res, 400, err.message || 'Upload failed.');

    const { category, subcategory, itemName, vendorName, deliveryDate, quantity, notes } = req.body;
    const matchesInvoice = req.body.matchesInvoice === 'on' || req.body.matchesInvoice === 'true';
    const invoiceFile = (req.files && req.files.invoicePhoto && req.files.invoicePhoto[0]) || null;
    const stockFiles = (req.files && req.files.stockPhotos) || [];

    if (!invoiceFile || !stockFiles.length) {
      return await renderPage(req, res, 400, 'An invoice/receipt photo and at least one photo of the physical stock are required.');
    }

    const savedIds = [];
    try {
      const invoicePhotoPath = await saveDeliveryPhoto(invoiceFile, 'stock_delivery_invoice', req.session.userId);
      savedIds.push(invoicePhotoPath);

      const stockPhotoPaths = [];
      for (const f of stockFiles) {
        const p = await saveDeliveryPhoto(f, 'stock_delivery_photo', req.session.userId);
        savedIds.push(p);
        stockPhotoPaths.push(p);
      }

      const submittedByName = (res.locals.currentUser && res.locals.currentUser.name) || 'Unknown';
      const result = await models.addStockDelivery({
        category, subcategory, itemName, vendorName, deliveryDate, quantity,
        matchesInvoice, notes,
        submittedByUserId: req.session.userId,
        submittedByName,
        invoicePhotoPath,
        stockPhotoPaths
      });

      if (result.error) {
        for (const p of savedIds) fileStore.deleteFile(p.replace('/breakage/photo/', '')).catch(() => {});
        return await renderPage(req, res, 400, result.error);
      }

      const delivery = result.delivery;
      notify.notifyManagersStockDelivery({
        ...delivery,
        categoryLabel: models.STOCK_CATEGORY_LABELS[delivery.category] || delivery.category
      }).catch(err2 => console.error('Stock delivery notification failed:', err2.message));

      res.redirect('/breakage?tab=deliveries');
    } catch (uploadErr) {
      for (const p of savedIds) fileStore.deleteFile(p.replace('/breakage/photo/', '')).catch(() => {});
      await renderPage(req, res, 400, uploadErr.message || 'Something went wrong saving the delivery.');
    }
  });
});

// Serving is gated the same way as the rest of /breakage — requireAuth +
// requireBreakageAccess is already applied to this whole router in
// server.js — plus an explicit category check so a guessed /files-style id
// from a totally different feature can't be pulled back out through here.
router.get('/photo/:id', async (req, res) => {
  const file = await fileStore.getFile(req.params.id);
  if (!file || !['stock_delivery_invoice', 'stock_delivery_photo'].includes(file.category)) {
    return res.status(404).render('404');
  }
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(file.data);
});

module.exports = router;
