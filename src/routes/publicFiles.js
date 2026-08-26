// Serves the photo categories that were previously plain public/ static
// files (no login required to view, same as before) — profile/kiosk
// avatars, kiosk clock-in/break selfies, duty photos, and Training recipe
// photos. Deliberately does NOT serve cash_safe_photo or report_photo —
// those stay behind their own routers' access control (requireCashSafeAccess
// / the authenticated /reports/file route) so this public route can never
// be used to pull a sensitive photo by guessing its id.
const express = require('express');
const router = express.Router();
const { sendStoredFile, getFile } = require('../fileStore');

const PUBLIC_CATEGORIES = new Set(['avatar', 'clock_selfie', 'duty_photo', 'training_photo']);

router.get('/:id', async (req, res) => {
  const file = await getFile(req.params.id);
  if (!file || !PUBLIC_CATEGORIES.has(file.category)) return res.status(404).render('404');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(file.data);
});

module.exports = router;
