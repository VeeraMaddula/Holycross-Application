// Gift vouchers: physical voucher cards sold at the till (voucher number +
// face value written on the card) and redeemed — possibly in several
// partial visits — against that stored value. SQL-backed (see
// db/schema.sql / db/005_add_vouchers_and_breakage.sql) from the start,
// unlike most of the still-JSON collections, so every function here is
// ASYNC — every caller must await it.
const { query } = require('../sqlPool');

function mapVoucher(r) {
  if (!r) return null;
  return {
    id: r.id,
    voucherNumber: r.voucher_number,
    faceValue: Number(r.face_value),
    remainingBalance: Number(r.remaining_balance),
    customerName: r.customer_name || '',
    soldByUserId: r.sold_by_user_id,
    soldByName: r.sold_by_name || 'Unknown',
    soldAt: r.sold_at ? new Date(r.sold_at).toISOString() : null,
    status: r.status
  };
}

function mapRedemption(r) {
  if (!r) return null;
  return {
    id: r.id,
    voucherId: r.voucher_id,
    amount: Number(r.amount),
    redeemedByUserId: r.redeemed_by_user_id,
    redeemedByName: r.redeemed_by_name || 'Unknown',
    redeemedAt: r.redeemed_at ? new Date(r.redeemed_at).toISOString() : null,
    note: r.note || ''
  };
}

async function listVouchers() {
  const { rows } = await query(`SELECT * FROM vouchers ORDER BY sold_at DESC`);
  return rows.map(mapVoucher);
}

async function getVoucherById(id) {
  const { rows } = await query(`SELECT * FROM vouchers WHERE id = $1`, [Number(id)]);
  return mapVoucher(rows[0]);
}

async function getVoucherByNumber(voucherNumber) {
  const target = String(voucherNumber || '').trim();
  if (!target) return null;
  const { rows } = await query(`SELECT * FROM vouchers WHERE voucher_number = $1`, [target]);
  return mapVoucher(rows[0]);
}

// Records a voucher sold at the till. The physical card already has the
// voucher number printed on it — staff are just keying in what's on the
// card plus the amount paid.
async function sellVoucher({ voucherNumber, faceValue, customerName, soldByUserId, soldByName }) {
  const number = String(voucherNumber || '').trim();
  if (!number) return { error: 'Enter the voucher number printed on the card.' };
  const value = Number(faceValue);
  if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a valid voucher amount.' };
  const existing = await getVoucherByNumber(number);
  if (existing) return { error: `Voucher number ${number} is already in use.` };
  const { rows } = await query(
    `INSERT INTO vouchers (voucher_number, face_value, remaining_balance, customer_name, sold_by_user_id, sold_by_name, status)
     VALUES ($1,$2,$2,$3,$4,$5,'active') RETURNING id`,
    [number, Math.round(value * 100) / 100, (customerName || '').trim(), soldByUserId || null, soldByName || 'Unknown']
  );
  return { voucher: await getVoucherById(rows[0].id) };
}

async function listRedemptionsForVoucher(voucherId) {
  const { rows } = await query(
    `SELECT * FROM voucher_redemptions WHERE voucher_id = $1 ORDER BY redeemed_at DESC`,
    [Number(voucherId)]
  );
  return rows.map(mapRedemption);
}

// Redeems some or all of a voucher's remaining balance. Supports partial
// redemption across multiple visits — the voucher stays 'active' with a
// smaller remaining_balance until it hits zero, at which point it flips to
// 'redeemed' so staff can see at a glance it's used up.
async function redeemVoucher({ voucherNumber, amount, redeemedByUserId, redeemedByName, note }) {
  const voucher = await getVoucherByNumber(voucherNumber);
  if (!voucher) return { error: `No voucher found with number ${voucherNumber}.` };
  if (voucher.status === 'void') return { error: 'This voucher has been voided.' };
  if (voucher.status === 'redeemed' || voucher.remainingBalance <= 0) {
    return { error: 'This voucher has already been fully redeemed.' };
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'Enter a valid redemption amount.' };
  if (amt > voucher.remainingBalance) {
    return { error: `Only €${voucher.remainingBalance.toFixed(2)} remaining on this voucher.` };
  }
  const newBalance = Math.round((voucher.remainingBalance - amt) * 100) / 100;
  const newStatus = newBalance <= 0 ? 'redeemed' : 'active';
  await query(`UPDATE vouchers SET remaining_balance = $1, status = $2 WHERE id = $3`, [newBalance, newStatus, voucher.id]);
  const { rows } = await query(
    `INSERT INTO voucher_redemptions (voucher_id, amount, redeemed_by_user_id, redeemed_by_name, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [voucher.id, Math.round(amt * 100) / 100, redeemedByUserId || null, redeemedByName || 'Unknown', (note || '').trim()]
  );
  const redemptions = await listRedemptionsForVoucher(voucher.id);
  return { voucher: await getVoucherById(voucher.id), redemption: redemptions.find(r => r.id === rows[0].id) };
}

async function voidVoucher(id) {
  const v = await getVoucherById(id);
  if (!v) return { error: 'Voucher not found.' };
  await query(`UPDATE vouchers SET status = 'void' WHERE id = $1`, [v.id]);
  return { voucher: await getVoucherById(v.id) };
}

// For the weekly accountant summary email — every voucher sold and every
// redemption made in the given window, for reconciling against the
// physical voucher book.
async function listVouchersSoldBetween(startIso, endIso) {
  const { rows } = await query(
    `SELECT * FROM vouchers WHERE sold_at >= $1 AND sold_at < $2 ORDER BY sold_at ASC`,
    [startIso, endIso]
  );
  return rows.map(mapVoucher);
}

async function listRedemptionsBetween(startIso, endIso) {
  const { rows } = await query(
    `SELECT r.*, v.voucher_number FROM voucher_redemptions r
     JOIN vouchers v ON v.id = r.voucher_id
     WHERE r.redeemed_at >= $1 AND r.redeemed_at < $2 ORDER BY r.redeemed_at ASC`,
    [startIso, endIso]
  );
  return rows.map(r => ({ ...mapRedemption(r), voucherNumber: r.voucher_number }));
}

module.exports = {
  listVouchers, getVoucherById, getVoucherByNumber, sellVoucher, listRedemptionsForVoucher,
  redeemVoucher, voidVoucher, listVouchersSoldBetween, listRedemptionsBetween
};
