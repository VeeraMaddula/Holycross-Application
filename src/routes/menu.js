const express = require('express');
const router = express.Router();
const models = require('../models');

router.get('/', async (req, res) => {
  const [menu, events] = await Promise.all([models.getMenu(), models.listEvents()]);
  res.render('menu/edit', { menu, events });
});

router.post('/', async (req, res) => {
  const { title, prices, descs, allergensField, sectionTitles, intro } = req.body;

  // Photos aren't editable from this plain form (no upload control here —
  // see menu/edit.ejs's comment), so a saved photoUrl would otherwise be
  // silently dropped every time this form is submitted, even for an
  // unrelated edit like fixing a price. Look up each existing item by
  // name (case-insensitive) across every current section and carry its
  // photoUrl forward if the resubmitted item still has the same name.
  const current = await models.getMenu();
  const photoByName = {};
  (current.sections || []).forEach(sec => (sec.items || []).forEach(it => {
    if (it.photoUrl) photoByName[String(it.name).trim().toLowerCase()] = it.photoUrl;
  }));

  // Rebuild menu structure from form arrays
  const sections = [].concat(sectionTitles || []).map((secTitle, i) => {
    const names = [].concat(title[i] || []);
    const p = [].concat(prices[i] || []);
    const d = [].concat(descs[i] || []);
    const a = [].concat((allergensField && allergensField[i]) || []);
    const items = names.map((n, j) => {
      const item = { name: n, price: p[j] || '', desc: d[j] || '' };
      const allergenList = String(a[j] || '').split(',').map(s => s.trim()).filter(Boolean);
      if (allergenList.length) item.allergens = allergenList;
      const photoUrl = photoByName[String(n).trim().toLowerCase()];
      if (photoUrl) item.photoUrl = photoUrl;
      return item;
    }).filter(it => it.name);
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
