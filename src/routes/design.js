const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const router = express.Router();
const models = require('../models');
const openArt = require('../openArt');

// Reference image (optional) — a staff member's own photo/screenshot to
// restyle, edit, or animate into a video, per the OpenArt CLI's own
// `--image ./fox.png` example. Uploaded via memoryStorage, then written to a
// temp file just long enough for the CLI call (it needs a real file path,
// not a buffer) — never persisted anywhere; deleted right after use.
const ALLOWED_REF_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_REF_TYPES[file.mimetype]) return cb(new Error('Reference image must be a JPG, PNG, or WEBP.'));
    cb(null, true);
  }
});

router.get('/', async (req, res) => {
  res.render('design', {
    generations: await models.listGenerations(),
    connected: openArt.isConnected(),
    imageModels: openArt.IMAGE_MODELS,
    videoModels: openArt.VIDEO_MODELS,
    error: null
  });
});

router.post('/generate', (req, res) => {
  upload.single('referenceImage')(req, res, async (uploadErr) => {
    const u = res.locals.currentUser;

    async function renderError(message) {
      res.status(400).render('design', {
        generations: await models.listGenerations(),
        connected: openArt.isConnected(),
        imageModels: openArt.IMAGE_MODELS,
        videoModels: openArt.VIDEO_MODELS,
        error: message
      });
    }

    if (uploadErr) return renderError(uploadErr.message || 'Reference image upload failed.');

    const { kind, prompt, model } = req.body;
    if (!openArt.isConnected()) {
      return renderError('OpenArt isn\'t connected yet — see the setup note below.');
    }
    if (kind !== 'image' && kind !== 'video') {
      return renderError('Choose image or video.');
    }
    if (!prompt || !prompt.trim()) {
      return renderError('Enter a prompt describing what to generate.');
    }
    const allowedModels = kind === 'image' ? openArt.IMAGE_MODELS : openArt.VIDEO_MODELS;
    if (!allowedModels.includes(model)) {
      return renderError('Choose a valid model for this media type.');
    }

    const record = await models.createGeneration({
      kind, prompt: prompt.trim(), model,
      usedReference: !!req.file,
      requestedByUserId: u && u.id,
      requestedByName: u && u.name
    });

    // Write the uploaded reference image to a scratch temp file — the CLI
    // takes a file path, not a buffer — and always clean it up afterward,
    // success or failure.
    let tempImagePath = null;
    if (req.file) {
      const ext = ALLOWED_REF_TYPES[req.file.mimetype] || '.jpg';
      tempImagePath = path.join(os.tmpdir(), `design-ref-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      await fsp.writeFile(tempImagePath, req.file.buffer);
    }

    try {
      const result = kind === 'image'
        ? await openArt.generateImage({ prompt: prompt.trim(), model, imagePath: tempImagePath })
        : await openArt.generateVideo({ prompt: prompt.trim(), model, imagePath: tempImagePath });
      await models.markGenerationComplete(record.id, { resultUrl: result.resultUrl, openartCreationId: result.creationId });
    } catch (err) {
      await models.markGenerationFailed(record.id, err.message);
      return renderError(`Generation failed: ${err.message}`);
    } finally {
      if (tempImagePath) {
        fs.unlink(tempImagePath, () => {}); // best-effort — a leftover temp file isn't worth failing the request over
      }
    }

    res.redirect('/design');
  });
});

module.exports = router;
