const express = require('express');
const router = express.Router();
const models = require('../models');

function renderPage(req, res, status, error) {
  models.listVouchers().then(vouchers => {
    res.status(status || 200).render('vouchers', { vouchers, error: error || null });
  }).catch(err => {
    res.status(500).render('vouchers', { vouchers: [], error: err.message });
  });
}

router.get('/', (req, res) => {
  renderPage(req, res, 200, null);
});

// Staff key in what's already written on the physical voucher card (number
// + amount) when they sell one — there's no card-printing here, the card
// itself is a pre-printed physical item handed over at the till.
router.post('/sell', async (req, res) => {
  const u = res.locals.currentUser;
  const { voucherNumber, faceValue, customerName } = req.body;
  const result = await models.sellVoucher({
    voucherNumber, faceValue, customerName,
    soldByUserId: u && u.id,
    soldByName: u && u.name
  });
  if (result.error) return renderPage(req, res, 400, result.error);
  res.redirect('/vouchers');
});

// Redeeming supports partial amounts — a customer can spend some of a
// voucher's value on one visit and come back for the rest; the voucher
// stays 'active' with a smaller remaining_balance until it hits zero.
router.post('/redeem', async (req, res) => {
  const u = res.locals.currentUser;
  const { voucherNumber, amount, note } = req.body;
  const result = await models.redeemVoucher({
    voucherNumber, amount, note,
    redeemedByUserId: u && u.id,
    redeemedByName: u && u.name
  });
  if (result.error) return renderPage(req, res, 400, result.error);
  res.redirect('/vouchers');
});

router.post('/:id/void', async (req, res) => {
  const result = await models.voidVoucher(req.params.id);
  if (result.error) return renderPage(req, res, 400, result.error);
  res.redirect('/vouchers');
});

router.get('/:id/history', async (req, res) => {
  const voucher = await models.getVoucherById(req.params.id);
  if (!voucher) return res.status(404).render('404');
  const redemptions = await models.listRedemptionsForVoucher(voucher.id);
  res.render('voucher-history', { voucher, redemptions });
});

module.exports = router;
