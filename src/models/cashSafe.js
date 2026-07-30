// Cash Safe Log: each shift's coins/notes in-and-out reconciliation against
// an expected "lodgement target" that Senior Managers can adjust over time.
const { readDb, writeDb } = require('../db');
const { todayStr } = require('../dateUtils');

// Factory-default expected float — only used the very first time the app
// runs, before a Senior Manager (or Admin) has ever set a lodgement target
// via setCashSafeLodgementTarget. From that point on, the live value lives
// in db.settings.cashSafeLodgementTarget and this constant is never read.
const SAFE_STARTING_BALANCE = 1000;

function listCashLogs() {
  const db = readDb();
  return (db.cashLogs || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// The "expected lodgement" — what the safe should hold — is a business
// decision that can change over time (e.g. more float needed over a busy
// trading period). Stored centrally in settings so every user's Cash Safe
// page reads the same current value; there's nothing to sync per-user.
function getCashSafeLodgementTarget() {
  const db = readDb();
  return typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
}

function setCashSafeLodgementTarget(amount, changedByUserId, changedByName, reason) {
  const db = readDb();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) return { error: 'Enter a valid lodgement amount.' };
  const previous = typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
  const newAmount = Math.round(amt * 100) / 100;
  db.settings.cashSafeLodgementTarget = newAmount;
  if (!db.cashLodgementHistory) db.cashLodgementHistory = [];
  const historyEntry = {
    id: db.cashLodgementHistory.length ? Math.max(...db.cashLodgementHistory.map(h => h.id)) + 1 : 1,
    previous,
    newAmount,
    reason: (reason || '').trim(),
    changedByUserId: changedByUserId || null,
    changedByName: changedByName || 'Unknown',
    changedAt: new Date().toISOString()
  };
  db.cashLodgementHistory.push(historyEntry);
  writeDb(db);
  return { target: newAmount, historyEntry };
}

function getCashLodgementHistory() {
  const db = readDb();
  return (db.cashLodgementHistory || []).slice().sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
}

function getCurrentSafeBalance() {
  const db = readDb();
  const logs = db.cashLogs || [];
  const target = typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
  if (!logs.length) return target;
  // Logs are appended in chronological order; the latest entry holds the running total.
  const latest = logs.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
  return latest.total;
}

function addCashLog({ reason, coinsIn, coinsOut, notesIn, notesOut, loggedByUserId, loggedByName, photoPath }) {
  const db = readDb();
  if (!db.cashLogs) db.cashLogs = [];
  const cIn = Number(coinsIn) || 0;
  const cOut = Number(coinsOut) || 0;
  const nIn = Number(notesIn) || 0;
  const nOut = Number(notesOut) || 0;
  const target = typeof db.settings.cashSafeLodgementTarget === 'number' ? db.settings.cashSafeLodgementTarget : SAFE_STARTING_BALANCE;
  const previousTotal = db.cashLogs.length
    ? db.cashLogs.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b)).total
    : target;
  const total = Math.round((previousTotal + cIn + nIn - cOut - nOut) * 100) / 100;
  const entry = {
    id: db.cashLogs.length ? Math.max(...db.cashLogs.map(l => l.id)) + 1 : 1,
    date: todayStr(),
    createdAt: new Date().toISOString(),
    loggedByUserId: loggedByUserId || null,
    loggedByName: loggedByName || 'Unknown',
    reason: (reason || '').trim(),
    coinsIn: cIn,
    coinsOut: cOut,
    notesIn: nIn,
    notesOut: nOut,
    total,
    photoPath: photoPath || null
  };
  db.cashLogs.push(entry);
  writeDb(db);
  return entry;
}

module.exports = {
  SAFE_STARTING_BALANCE, listCashLogs, getCashSafeLodgementTarget, setCashSafeLodgementTarget,
  getCashLodgementHistory, getCurrentSafeBalance, addCashLog
};
