// Shift Marketplace: any staff member can drop one of their own upcoming
// roster shifts, and any other active staff member can either pick it up
// outright (taking it over completely) or offer an exchange (swap it for
// one of their own upcoming shifts). Both resolutions apply to the actual
// roster immediately — there's no manager-approval gate — the manager just
// gets an email once it's done (see notifyManagersShiftChange in notify.js).
// That was a deliberate call made when this was built, not an oversight.
//
// SQL-backed as of task #208 — see
// db/011_redesign_cash_safe_requests_reports_shiftdrops.sql. Every exported
// function is now ASYNC. The roster shifts a drop references were already
// SQL as of task #207 (src/models/roster.js), so every lookup/mutation of
// an actual shift keeps going through roster.js's exported helpers.
const { query } = require('../sqlPool');
const { getUserById } = require('./users');
const { getRosterShiftById, setRosterShiftOwner } = require('./roster');

function snapshotShift(shift) {
  return { id: shift.id, date: shift.date, startTime: shift.startTime, endTime: shift.endTime };
}

function mapDropRow(r) {
  return {
    id: r.id,
    rosterShiftId: r.roster_shift_id,
    shift: r.shift,
    droppedByUserId: r.dropped_by_user_id,
    droppedByName: r.dropped_by_name,
    status: r.status,
    claimedByUserId: r.claimed_by_user_id,
    claimedByName: r.claimed_by_name,
    exchangeRosterShiftId: r.exchange_roster_shift_id,
    exchangeShift: r.exchange_shift,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at
  };
}

// Every currently-open drop, newest first — anyone can browse this (see
// routes/requests.js); the view decides whether to show "Cancel" (their
// own) or "Pick up"/"Offer exchange" (someone else's).
async function listOpenDrops() {
  const { rows } = await query(`SELECT * FROM shift_drops WHERE status = 'open' ORDER BY created_at DESC`);
  return rows.map(mapDropRow);
}

async function getDrop(id) {
  const { rows } = await query(`SELECT * FROM shift_drops WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapDropRow(rows[0]) : null;
}

// Only the shift's actual owner can drop it. Dropping the same shift twice
// (e.g. a double-click) just hands back the existing open drop instead of
// creating a duplicate listing.
//
// String-compare shift.userId/shift.id, not === : both now come back from
// CockroachDB (via `pg`) as strings for their INT8-backed SERIAL columns —
// same mismatch class fixed in roster.js itself during this migration.
async function dropShift({ rosterShiftId, userId }) {
  const shift = await getRosterShiftById(rosterShiftId);
  if (!shift) return { error: 'Shift not found.' };
  if (String(shift.userId) !== String(userId)) return { error: "That's not your shift." };

  const { rows: existingRows } = await query(
    `SELECT * FROM shift_drops WHERE roster_shift_id = $1 AND status = 'open'`,
    [Number(shift.id)]
  );
  if (existingRows.length) return { drop: mapDropRow(existingRows[0]) };

  const dropper = await getUserById(userId);
  const { rows } = await query(
    `INSERT INTO shift_drops (roster_shift_id, shift, dropped_by_user_id, dropped_by_name, status)
     VALUES ($1, $2, $3, $4, 'open') RETURNING *`,
    [Number(shift.id), JSON.stringify(snapshotShift(shift)), shift.userId, dropper ? dropper.name : 'Unknown']
  );
  return { drop: mapDropRow(rows[0]) };
}

async function cancelDrop(dropId, userId) {
  const drop = await getDrop(dropId);
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available to cancel.' };
  if (String(drop.droppedByUserId) !== String(userId)) return { error: 'Only the person who dropped it can cancel.' };
  const { rows } = await query(
    `UPDATE shift_drops SET status = 'cancelled', resolved_at = now() WHERE id = $1 RETURNING *`,
    [Number(dropId)]
  );
  return { drop: mapDropRow(rows[0]) };
}

// Straight handover: the claimant takes over the dropped shift, nothing
// offered in return. Updates the real roster shift's owner right away.
async function pickUpDrop(dropId, claimantUserId) {
  const drop = await getDrop(dropId);
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available.' };
  if (String(drop.droppedByUserId) === String(claimantUserId)) return { error: "You can't pick up your own dropped shift." };
  const claimant = await getUserById(claimantUserId);
  if (!claimant || !claimant.active) return { error: 'Staff member not found.' };
  const shift = await getRosterShiftById(drop.rosterShiftId);
  if (!shift) return { error: 'The original shift no longer exists — ask a manager to check the roster.' };

  const dropper = await getUserById(drop.droppedByUserId);
  const updatedShift = await setRosterShiftOwner(shift.id, claimant.id);

  const { rows } = await query(
    `UPDATE shift_drops SET status = 'picked_up', claimed_by_user_id = $1, claimed_by_name = $2, resolved_at = now() WHERE id = $3 RETURNING *`,
    [claimant.id, claimant.name, Number(dropId)]
  );

  return { drop: mapDropRow(rows[0]), shift: { ...updatedShift, user: claimant }, dropper, claimant };
}

// Swap: the claimant offers one of their OWN upcoming shifts in return —
// the dropped shift's owner becomes the claimant, and the claimant's
// offered shift's owner becomes the original dropper. Both roster rows
// keep their own ids, just change hands, so anything else keyed to a
// shift id (Google Calendar sync, etc.) still points at the right row.
async function exchangeDrop(dropId, claimantUserId, offerShiftId) {
  const drop = await getDrop(dropId);
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available.' };
  if (String(drop.droppedByUserId) === String(claimantUserId)) return { error: "You can't exchange with your own dropped shift." };
  const claimant = await getUserById(claimantUserId);
  if (!claimant || !claimant.active) return { error: 'Staff member not found.' };
  const droppedShift = await getRosterShiftById(drop.rosterShiftId);
  if (!droppedShift) return { error: 'The original shift no longer exists — ask a manager to check the roster.' };
  const offerShift = await getRosterShiftById(offerShiftId);
  if (!offerShift) return { error: 'Choose one of your own shifts to offer.' };
  if (String(offerShift.userId) !== String(claimantUserId)) return { error: "That's not your shift to offer." };
  if (String(offerShift.id) === String(droppedShift.id)) return { error: "Can't offer the same shift back." };

  const dropper = await getUserById(drop.droppedByUserId);
  const dropperId = drop.droppedByUserId;
  const updatedDroppedShift = await setRosterShiftOwner(droppedShift.id, claimant.id);
  const updatedOfferShift = await setRosterShiftOwner(offerShift.id, dropperId);

  const { rows } = await query(
    `UPDATE shift_drops SET status = 'exchanged', claimed_by_user_id = $1, claimed_by_name = $2,
       exchange_roster_shift_id = $3, exchange_shift = $4, resolved_at = now() WHERE id = $5 RETURNING *`,
    [claimant.id, claimant.name, Number(offerShift.id), JSON.stringify(snapshotShift(updatedOfferShift)), Number(dropId)]
  );

  return {
    drop: mapDropRow(rows[0]),
    droppedShift: { ...updatedDroppedShift, user: claimant },
    offerShift: { ...updatedOfferShift, user: dropper },
    dropper, claimant
  };
}

module.exports = { listOpenDrops, getDrop, dropShift, cancelDrop, pickUpDrop, exchangeDrop };
