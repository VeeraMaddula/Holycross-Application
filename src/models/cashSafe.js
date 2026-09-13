// Cash Safe Log: each shift's coins/notes in-and-out reconciliation against
// an expected "lodgement target" that Senior Managers can adjust over time.
// cash_logs/cash_lodgement_history moved to SQL in task #208 — see
// db/011_redesign_cash_safe_requests_reports_shiftdrops.sql. Every exported
// function is now ASYNC.
//
// The lodgement TARGET itself stays in the JSON settings blob for now
// (db.settings.cashSafeLodgementTarget) — settings.js's own SQL conversion
// is task #209, not this one. Same transitional-read pattern used elsewhere
// in this migration (e.g. roster.js still reading db.settings.slotDurationMinutes).
const { readDb, writeDb } = require('../db');
const { query } = require('../sqlPool');
const { todayStr } = require('../dateUtils');

// Factory-default expected float — only used the very first time the app
// runs, before a Senior Manager (or Admin) has ever set a lodgement target
// via setCashSafeLodgementTarget. From that point on, the live value lives
// in db.settings.cashSafeLodgementTarget and this constant is never read.
const SAFE_STARTING_BALANCE = 1000;

function mapLogRow(r) {
  return {
    id: r.id,
    date: r.date,
    loggedByUserId: r.logged_by_user_id,
    loggedByName: r.logged_by_name,
    reason: r.reason,
    coinsIn: Number(r.coins_in),
    coinsOut: Number(r.coins_out),
    notesIn: Number(r.notes_in),
    notesOut: Number(r.notes_out),
    total: Number(r.total),
    photoPath: r.photo_path,
    createdAt: r.created_at
  };
}

function mapHistoryRow(r) {
  return {
    id: r.id,
    previous: Number(r.previous),
    newAmount: Number(r.new_amount),
    reason: r.reason,
    changedByUserId: r.changed_by_user_id,
    changedByName: r.changed_by_name,
    changedAt: r.changed_at
  };
}

async function listCashLogs() {
  const { rows } = await query(`SELECT * FROM cash_logs ORDER BY created_at DESC`);
  return rows.map(mapLogRow);
}

// The "expected lodgement" — what the safe should hold — is a business
// decision that can change over time (e.g. more float needed over a busy
// trading period). Stored centrally in settings so every user's Cash Safe
// page reads the same current value; there's nothing to sync per-user.
function getCashSafeLodgementTarget() {
  const db = readDb();
  return typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
}

async function setCashSafeLodgementTarget(amount, changedByUserId, changedByName, reason) {
  const db = readDb();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) return { error: 'Enter a valid lodgement amount.' };
  const previous = typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
  const newAmount = Math.round(amt * 100) / 100;
  db.settings.cashSafeLodgementTarget = newAmount;
  writeDb(db);

  const { rows } = await query(
    `INSERT INTO cash_lodgement_history (previous, new_amount, reason, changed_by_user_id, changed_by_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [previous, newAmount, (reason || '').trim(), changedByUserId || null, changedByName || 'Unknown']
  );
  return { target: newAmount, historyEntry: mapHistoryRow(rows[0]) };
}

async function getCashLodgementHistory() {
  const { rows } = await query(`SELECT * FROM cash_lodgement_history ORDER BY changed_at DESC`);
  return rows.map(mapHistoryRow);
}

async function getCurrentSafeBalance() {
  const db = readDb();
  const target = typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
  const { rows } = await query(`SELECT total FROM cash_logs ORDER BY created_at DESC LIMIT 1`);
  return rows.length ? Number(rows[0].total) : target;
}

async function addCashLog({ reason, coinsIn, coinsOut, notesIn, notesOut, loggedByUserId, loggedByName, photoPath }) {
  const db = readDb();
  const cIn = Number(coinsIn) || 0;
  const cOut = Number(coinsOut) || 0;
  const nIn = Number(notesIn) || 0;
  const nOut = Number(notesOut) || 0;
  const target = typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
  const { rows: latestRows } = await query(`SELECT total FROM cash_logs ORDER BY created_at DESC LIMIT 1`);
  const previousTotal = latestRows.length ? Number(latestRows[0].total) : target;
  const total = Math.round((previousTotal + cIn + nIn - cOut - nOut) * 100) / 100;

  const { rows } = await query(
    `INSERT INTO cash_logs (date, logged_by_user_id, logged_by_name, reason, coins_in, coins_out, notes_in, notes_out, total, photo_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [todayStr(), loggedByUserId || null, loggedByName || 'Unknown', (reason || '').trim(), cIn, cOut, nIn, nOut, total, photoPath || null]
  );
  return mapLogRow(rows[0]);
}

module.exports = {
  SAFE_STARTING_BALANCE, listCashLogs, getCashSafeLodgementTarget, setCashSafeLodgementTarget,
  getCashLodgementHistory, getCurrentSafeBalance, addCashLog
};
