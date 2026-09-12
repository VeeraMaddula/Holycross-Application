const express = require('express');
const router = express.Router();
const models = require('../models');
const openArt = require('../openArt');

router.get('/', async (req, res) => {
  res.render('design', {
    generations: await models.listGenerations(),
    connected: openArt.isConnected(),
    imageModels: openArt.IMAGE_MODELS,
    videoModels: openArt.VIDEO_MODELS,
    error: null
  });
});

router.post('/generate', async (req, res) => {
  const u = res.locals.currentUser;
  const { kind, prompt, model } = req.body;

  async function renderError(message) {
    res.status(400).render('design', {
      generations: await models.listGenerations(),
      connected: openArt.isConnected(),
      imageModels: openArt.IMAGE_MODELS,
      videoModels: openArt.VIDEO_MODELS,
      error: message
    });
  }

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
    requestedByUserId: u && u.id,
    requestedByName: u && u.name
  });

  try {
    const result = kind === 'image'
      ? await openArt.generateImage({ prompt: prompt.trim(), model })
      : await openArt.generateVideo({ prompt: prompt.trim(), model });
    await models.markGenerationComplete(record.id, { resultUrl: result.resultUrl, openartCreationId: result.creationId });
  } catch (err) {
    await models.markGenerationFailed(record.id, err.message);
    return renderError(`Generation failed: ${err.message}`);
  }

  res.redirect('/design');
});

module.exports = router;
