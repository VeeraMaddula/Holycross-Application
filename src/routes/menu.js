const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', async (req, res) => {
  const [menu, events] = await Promise.all([models.getMenu(), models.listEvents()]);
  res.render('menu/edit', { menu, events });
});

router.post('/', async (req, res) => {
  const { title, prices, descs, sectionTitles, intro } = req.body;
  // Rebuild menu structure from form arrays
  const sections = [].concat(sectionTitles || []).map((secTitle, i) => {
    const names = [].concat(title[i] || []);
    const p = [].concat(prices[i] || []);
    const d = [].concat(descs[i] || []);
    const items = names.map((n, j) => ({ name: n, price: p[j] || '', desc: d[j] || '' })).filter(it => it.name);
    return { title: secTitle, items };
  }).filter(s => s.title);

  await models.saveMenu({ intro: intro || '', sections });
  res.redirect('/menu');
});

router.post('/events', async (req, res) => {
  await models.createEvent(req.body);
  res.redirect('/menu');
});

router.post('/events/:id/delete', async (req, res) => {
  await models.deleteEvent(req.params.id);
  res.redirect('/menu');
});

module.exports = router;
