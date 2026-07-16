// Local-calendar-date helpers.
//
// IMPORTANT: never build a "today" or calendar-date string with
// `date.toISOString().slice(0, 10)`. toISOString() always converts to UTC
// first, which silently shifts the date back a day whenever the server's
// local time is ahead of UTC (e.g. Ireland during BST/summer time, UTC+1) —
// at any moment before 1am local time, the UTC date is still "yesterday".
// That bug previously made the roster's "This Week", My Shifts, the
// dashboard's "today" bookings, and the Timesheets default range all
// resolve to the wrong day for part of every single day.
//
// These helpers format using the Date object's local getFullYear/getMonth/
// getDate instead, so "today" always means today in the server's own
// timezone, regardless of UTC offset.
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() {
  return toDateStr(new Date());
}

// "HH:MM" (24hr, how shift/booking times are stored) -> "9 AM" / "5:30 PM" /
// "12 PM" for display. Minutes are only shown when non-zero, so times stay
// compact on the roster's timeline bars and table pills.
function formatTime12(hhmm) {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return hhmm || '';
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return mStr && mStr !== '00' ? `${h}:${mStr} ${period}` : `${h} ${period}`;
}

module.exports = { toDateStr, todayStr, formatTime12 };
