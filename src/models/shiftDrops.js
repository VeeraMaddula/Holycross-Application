// Shift Marketplace: any staff member can drop one of their own upcoming
// roster shifts, and any other active staff member can either pick it up
// outright (taking it over completely) or offer an exchange (swap it for
// one of their own upcoming shifts). Both resolutions apply to the actual
// roster immediately — there's no manager-approval gate — the manager just
// gets an email once it's done (see notifyManagersShiftChange in notify.js).
// That was a deliberate call made when this was built, not an oversight.
//
// The shiftDrops collection itself is still JSON (data/db.json) — its own
// SQL conversion is task #208, not this one. But the roster shifts it
// references moved to SQL in task #207 (src/models/roster.js), so every
// lookup/mutation of an actual shift goes through roster.js's exported
// helpers now rather than reaching into db.rosterShifts directly — that
// array is permanently empty once roster.js stopped writing to it.
const { readDb, writeDb } = require('../db');
const { getUserById } = require('./users');
const { getRosterShiftById, setRosterShiftOwner } = require('./roster');

function snapshotShift(shift) {
  return { id: shift.id, date: shift.date, startTime: shift.startTime, endTime: shift.endTime };
}

// Every currently-open drop, newest first — anyone can browse this (see
// routes/requests.js); the view decides whether to show "Cancel" (their
// own) or "Pick up"/"Offer exchange" (someone else's).
function listOpenDrops() {
  const db = readDb();
  return (db.shiftDrops || [])
    .filter(d => d.status === 'open')
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getDrop(id) {
  const db = readDb();
  return (db.shiftDrops || []).find(d => d.id === Number(id)) || null;
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
  const db = readDb();
  if (!db.shiftDrops) db.shiftDrops = [];
  const existing = db.shiftDrops.find(d => String(d.rosterShiftId) === String(shift.id) && d.status === 'open');
  if (existing) return { drop: existing };
  const dropper = await getUserById(userId);
  if (!db.meta.nextShiftDropId) db.meta.nextShiftDropId = 1;
  const drop = {
    id: db.meta.nextShiftDropId++,
    rosterShiftId: shift.id,
    shift: snapshotShift(shift),
    droppedByUserId: shift.userId,
    droppedByName: dropper ? dropper.name : 'Unknown',
    status: 'open',
    claimedByUserId: null,
    claimedByName: null,
    exchangeRosterShiftId: null,
    exchangeShift: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null
  };
  db.shiftDrops.push(drop);
  writeDb(db);
  return { drop };
}

function cancelDrop(dropId, userId) {
  const db = readDb();
  const drop = (db.shiftDrops || []).find(d => d.id === Number(dropId));
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available to cancel.' };
  if (String(drop.droppedByUserId) !== String(userId)) return { error: 'Only the person who dropped it can cancel.' };
  drop.status = 'cancelled';
  drop.resolvedAt = new Date().toISOString();
  writeDb(db);
  return { drop };
}

// Straight handover: the claimant takes over the dropped shift, nothing
// offered in return. Updates the real roster shift's owner right away.
async function pickUpDrop(dropId, claimantUserId) {
  const db = readDb();
  const drop = (db.shiftDrops || []).find(d => d.id === Number(dropId));
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available.' };
  if (String(drop.droppedByUserId) === String(claimantUserId)) return { error: "You can't pick up your own dropped shift." };
  const claimant = await getUserById(claimantUserId);
  if (!claimant || !claimant.active) return { error: 'Staff member not found.' };
  const shift = await getRosterShiftById(drop.rosterShiftId);
  if (!shift) return { error: 'The original shift no longer exists — ask a manager to check the roster.' };

  const dropper = await getUserById(drop.droppedByUserId);
  const updatedShift = await setRosterShiftOwner(shift.id, claimant.id);

  drop.status = 'picked_up';
  drop.claimedByUserId = claimant.id;
  drop.claimedByName = claimant.name;
  drop.resolvedAt = new Date().toISOString();
  writeDb(db);

  return { drop, shift: { ...updatedShift, user: claimant }, dropper, claimant };
}

// Swap: the claimant offers one of their OWN upcoming shifts in return —
// the dropped shift's owner becomes the claimant, and the claimant's
// offered shift's owner becomes the original dropper. Both roster rows
// keep their own ids, just change hands, so anything else keyed to a
// shift id (Google Calendar sync, etc.) still points at the right row.
async function exchangeDrop(dropId, claimantUserId, offerShiftId) {
  const db = readDb();
  const drop = (db.shiftDrops || []).find(d => d.id === Number(dropId));
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

  drop.status = 'exchanged';
  drop.claimedByUserId = claimant.id;
  drop.claimedByName = claimant.name;
  drop.exchangeRosterShiftId = offerShift.id;
  drop.exchangeShift = snapshotShift(updatedOfferShift);
  drop.resolvedAt = new Date().toISOString();
  writeDb(db);

  return {
    drop,
    droppedShift: { ...updatedDroppedShift, user: claimant },
    offerShift: { ...updatedOfferShift, user: dropper },
    dropper, claimant
  };
}

module.exports = { listOpenDrops, getDrop, dropShift, cancelDrop, pickUpDrop, exchangeDrop };
