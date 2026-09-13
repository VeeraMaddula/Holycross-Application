// One-time data migration — copies the existing JSON cashLogs/
// cashLodgementHistory/requests/reports/shiftDrops (data/db.json, via
// src/db.js's readDb()) into their new SQL tables, now that
// models/cashSafe.js, models/requests.js, models/staffReports.js, and
// models/shiftDrops.js are SQL-backed (task #208).
//
// IMPORTANT — where to run this: same as every other migrate-*.js script
// this session — it only finds real data when data/db.json is the ACTUAL
// production file, which only exists inside the running Render service
// (see src/persist.js). Run this from a Render Shell session for
// holycross-booking, NOT from a local machine.
// Usage (in the Render Shell): node migrate-cash-safe-requests-reports-shiftdrops-data.js
//
// Preserves every original numeric id exactly as it was in JSON. Safe to
// re-run: every insert is ON CONFLICT (id) DO NOTHING. A row whose user
// reference (logged/changed/reported/requested/recipient/dropped/claimed by)
// no longer matches a real user is retried with that one column nulled
// rather than dropped entirely — these are historical records worth
// keeping even if the person behind them left.
require('dotenv').config();
const { readDb } = require('./src/db');
const { query, getPool } = require('./src/sqlPool');

async function insertWithOrphanRetry(sql, params, nullableUserIndexes) {
  try {
    const { rowCount } = await query(sql, params);
    return rowCount ? 'inserted' : 'already-present';
  } catch (err) {
    if (err.code === '23503' && nullableUserIndexes.length) {
      const retryParams = params.slice();
      for (const i of nullableUserIndexes) retryParams[i] = null;
      const { rowCount } = await query(sql, retryParams);
      return rowCount ? 'inserted (orphaned user ref nulled)' : 'already-present';
    }
    throw err;
  }
}

async function migrateCashLogs(db) {
  const logs = db.cashLogs || [];
  const tally = {};
  for (const l of logs) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO cash_logs (id, date, logged_by_user_id, logged_by_name, reason, coins_in, coins_out, notes_in, notes_out, total, photo_path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [l.id, l.date, l.loggedByUserId || null, l.loggedByName || 'Unknown', l.reason || '', l.coinsIn || 0, l.coinsOut || 0, l.notesIn || 0, l.notesOut || 0, l.total, l.photoPath || null, l.createdAt || new Date().toISOString()],
      [2]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Cash logs — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (logs.length) await query(`SELECT setval(pg_get_serial_sequence('cash_logs', 'id'), COALESCE((SELECT MAX(id) FROM cash_logs), 1))`);
}

async function migrateCashLodgementHistory(db) {
  const history = db.cashLodgementHistory || [];
  const tally = {};
  for (const h of history) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO cash_lodgement_history (id, previous, new_amount, reason, changed_by_user_id, changed_by_name, changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [h.id, h.previous, h.newAmount, h.reason || '', h.changedByUserId || null, h.changedByName || 'Unknown', h.changedAt || new Date().toISOString()],
      [4]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Cash lodgement history — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (history.length) await query(`SELECT setval(pg_get_serial_sequence('cash_lodgement_history', 'id'), COALESCE((SELECT MAX(id) FROM cash_lodgement_history), 1))`);
}

async function migrateRequests(db) {
  const requests = db.requests || [];
  const tally = {};
  for (const r of requests) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO requests (id, type, type_label, requested_by, requested_by_name, recipient_user_id, recipient_name, details, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.type, r.typeLabel || '', r.requestedByUserId, r.requestedByName || 'Unknown', r.recipientUserId || null, r.recipientName || '', r.details || '', r.status || 'sent', r.createdAt || new Date().toISOString()],
      [5]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Requests — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (requests.length) await query(`SELECT setval(pg_get_serial_sequence('requests', 'id'), COALESCE((SELECT MAX(id) FROM requests), 1))`);
}

async function migrateReports(db) {
  const reports = db.reports || [];
  const tally = {};
  for (const r of reports) {
    const outcome = await insertWithOrphanRetry(
      `INSERT INTO reports (id, category, category_label, details, files, reported_by_user_id, reported_by_name, recipient_user_id, recipient_name, status, reviewed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.category, r.categoryLabel || '', r.details || '', JSON.stringify(r.files || []), r.reportedByUserId || null, r.reportedByName || 'Unknown', r.recipientUserId || null, r.recipientName || '', r.status || 'sent', r.reviewedAt || null, r.createdAt || new Date().toISOString()],
      [5]
    );
    tally[outcome] = (tally[outcome] || 0) + 1;
  }
  console.log(`Reports — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (reports.length) await query(`SELECT setval(pg_get_serial_sequence('reports', 'id'), COALESCE((SELECT MAX(id) FROM reports), 1))`);
}

async function migrateShiftDrops(db) {
  const drops = db.shiftDrops || [];
  const tally = {};
  for (const d of drops) {
    try {
      const { rowCount } = await query(
        `INSERT INTO shift_drops (id, roster_shift_id, shift, dropped_by_user_id, dropped_by_name, status, claimed_by_user_id, claimed_by_name, exchange_roster_shift_id, exchange_shift, created_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [d.id, d.rosterShiftId || null, JSON.stringify(d.shift || null), d.droppedByUserId || null, d.droppedByName || 'Unknown', d.status || 'open', d.claimedByUserId || null, d.claimedByName || null, d.exchangeRosterShiftId || null, JSON.stringify(d.exchangeShift || null), d.createdAt || new Date().toISOString(), d.resolvedAt || null]
      );
      tally[rowCount ? 'inserted' : 'already-present'] = (tally[rowCount ? 'inserted' : 'already-present'] || 0) + 1;
    } catch (err) {
      if (err.code === '23503') {
        // Either the roster shift itself or one of the user references no
        // longer exists — the drop's own `shift`/`exchangeShift` JSONB
        // snapshots already carry what's needed to display it, so null out
        // every foreign key and keep the historical record.
        const { rowCount } = await query(
          `INSERT INTO shift_drops (id, roster_shift_id, shift, dropped_by_user_id, dropped_by_name, status, claimed_by_user_id, claimed_by_name, exchange_roster_shift_id, exchange_shift, created_at, resolved_at)
           VALUES ($1,NULL,$2,NULL,$3,$4,NULL,$5,NULL,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [d.id, JSON.stringify(d.shift || null), d.droppedByName || 'Unknown', d.status || 'open', d.claimedByName || null, JSON.stringify(d.exchangeShift || null), d.createdAt || new Date().toISOString(), d.resolvedAt || null]
        );
        tally['inserted (orphaned refs nulled)'] = (tally['inserted (orphaned refs nulled)'] || 0) + (rowCount ? 1 : 0);
        if (!rowCount) tally['already-present'] = (tally['already-present'] || 0) + 1;
      } else {
        throw err;
      }
    }
  }
  console.log(`Shift drops — ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none found'}.`);
  if (drops.length) await query(`SELECT setval(pg_get_serial_sequence('shift_drops', 'id'), COALESCE((SELECT MAX(id) FROM shift_drops), 1))`);
}

async function main() {
  const db = readDb();
  const counts = {
    cashLogs: (db.cashLogs || []).length,
    cashLodgementHistory: (db.cashLodgementHistory || []).length,
    requests: (db.requests || []).length,
    reports: (db.reports || []).length,
    shiftDrops: (db.shiftDrops || []).length
  };
  console.log('Found in data/db.json:', counts);
  if (!Object.values(counts).some(Boolean)) {
    console.log('Nothing to migrate. If you expected real data here, double-check you are running this in the Render Shell for holycross-booking, not locally.');
    await getPool().end();
    return;
  }

  await migrateCashLogs(db);
  await migrateCashLodgementHistory(db);
  await migrateRequests(db);
  await migrateReports(db);
  await migrateShiftDrops(db);

  console.log('\nDone. Check the Cash Safe, Requests, Reports, and Shift Marketplace pages show this data correctly.');
  await getPool().end();
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
