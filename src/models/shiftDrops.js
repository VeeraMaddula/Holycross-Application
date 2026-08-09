// Shift Marketplace: any staff member can drop one of their own upcoming
// roster shifts, and any other active staff member can either pick it up
// outright (taking it over completely) or offer an exchange (swap it for
// one of their own upcoming shifts). Both resolutions apply to the actual
// roster immediately — there's no manager-approval gate — the manager just
// gets an email once it's done (see notifyManagersShiftChange in notify.js).
// That was a deliberate call made when this was built, not an oversight.
const { readDb, writeDb } = require('../db');

function findUser(db, id) {
  return (db.users || []).find(u => u.id === Number(id));
}

function findShift(db, id) {
  return (db.rosterShifts || []).find(s => s.id === Number(id));
}

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
function dropShift({ rosterShiftId, userId }) {
  const db = readDb();
  const shift = findShift(db, rosterShiftId);
  if (!shift) return { error: 'Shift not found.' };
  if (shift.userId !== Number(userId)) return { error: "That's not your shift." };
  if (!db.shiftDrops) db.shiftDrops = [];
  const existing = db.shiftDrops.find(d => d.rosterShiftId === shift.id && d.status === 'open');
  if (existing) return { drop: existing };
  const dropper = findUser(db, userId);
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
  if (drop.droppedByUserId !== Number(userId)) return { error: 'Only the person who dropped it can cancel.' };
  drop.status = 'cancelled';
  drop.resolvedAt = new Date().toISOString();
  writeDb(db);
  return { drop };
}

// Straight handover: the claimant takes over the dropped shift, nothing
// offered in return. Updates the real roster shift's owner right away.
function pickUpDrop(dropId, claimantUserId) {
  const db = readDb();
  const drop = (db.shiftDrops || []).find(d => d.id === Number(dropId));
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available.' };
  if (drop.droppedByUserId === Number(claimantUserId)) return { error: "You can't pick up your own dropped shift." };
  const claimant = findUser(db, claimantUserId);
  if (!claimant || !claimant.active) return { error: 'Staff member not found.' };
  const shift = findShift(db, drop.rosterShiftId);
  if (!shift) return { error: 'The original shift no longer exists — ask a manager to check the roster.' };

  const dropper = findUser(db, drop.droppedByUserId);
  shift.userId = claimant.id;

  drop.status = 'picked_up';
  drop.claimedByUserId = claimant.id;
  drop.claimedByName = claimant.name;
  drop.resolvedAt = new Date().toISOString();
  writeDb(db);

  return { drop, shift: { ...shift, user: claimant }, dropper, claimant };
}

// Swap: the claimant offers one of their OWN upcoming shifts in return —
// the dropped shift's owner becomes the claimant, and the claimant's
// offered shift's owner becomes the original dropper. Both roster rows
// keep their own ids, just change hands, so anything else keyed to a
// shift id (Google Calendar sync, etc.) still points at the right row.
function exchangeDrop(dropId, claimantUserId, offerShiftId) {
  const db = readDb();
  const drop = (db.shiftDrops || []).find(d => d.id === Number(dropId));
  if (!drop) return { error: 'Drop not found.' };
  if (drop.status !== 'open') return { error: 'This shift is no longer available.' };
  if (drop.droppedByUserId === Number(claimantUserId)) return { error: "You can't exchange with your own dropped shift." };
  const claimant = findUser(db, claimantUserId);
  if (!claimant || !claimant.active) return { error: 'Staff member not found.' };
  const droppedShift = findShift(db, drop.rosterShiftId);
  if (!droppedShift) return { error: 'The original shift no longer exists — ask a manager to check the roster.' };
  const offerShift = findShift(db, offerShiftId);
  if (!offerShift) return { error: 'Choose one of your own shifts to offer.' };
  if (offerShift.userId !== Number(claimantUserId)) return { error: "That's not your shift to offer." };
  if (offerShift.id === droppedShift.id) return { error: "Can't offer the same shift back." };

  const dropper = findUser(db, drop.droppedByUserId);
  const dropperId = drop.droppedByUserId;
  droppedShift.userId = claimant.id;
  offerShift.userId = dropperId;

  drop.status = 'exchanged';
  drop.claimedByUserId = claimant.id;
  drop.claimedByName = claimant.name;
  drop.exchangeRosterShiftId = offerShift.id;
  drop.exchangeShift = snapshotShift(offerShift);
  drop.resolvedAt = new Date().toISOString();
  writeDb(db);

  return {
    drop,
    droppedShift: { ...droppedShift, user: claimant },
    offerShift: { ...offerShift, user: dropper },
    dropper, claimant
  };
}

module.exports = { listOpenDrops, getDrop, dropShift, cancelDrop, pickUpDrop, exchangeDrop };
