// When each duty-checklist section is "live" on the kiosk tablet, and when
// it counts as over. Pure schedule logic — no reads/writes to the database
// live here, so it's easy to unit-test with fabricated Date objects.
//
// days: 0=Sunday .. 6=Saturday (matches Date#getDay()).
// endMode 'fixed'   -> always closes at `end`, same every matching day.
// endMode 'lastClockout' -> has no fixed end; models.js/notify.js decide
//   when it's actually over by watching for the last Bar Staff to clock out
//   (see notify.checkClosingDutiesOnClockOut). `end` is null for these.
const DUTY_WINDOWS = [
  { section: 'opening', sectionTitle: 'Opening Duties', days: [0, 1, 2, 3, 4, 5, 6], start: '08:30', end: '09:05', endMode: 'fixed' },
  { section: 'after_breakfast', sectionTitle: 'After Breakfast Duties', days: [0, 1, 2, 3, 4, 5, 6], start: '11:35', end: '12:15', endMode: 'fixed' },
  { section: 'after_carvery', sectionTitle: 'After Carvery Duties', days: [5, 6], start: '15:00', end: '15:30', endMode: 'fixed' }, // Fri, Sat only
  { section: 'closing', sectionTitle: 'Closing Duties', days: [1, 2], start: '18:00', end: null, endMode: 'lastClockout' }, // Mon, Tue
  { section: 'closing', sectionTitle: 'Closing Duties', days: [3, 4, 5, 6], start: '20:30', end: null, endMode: 'lastClockout' }, // Wed-Sat
  { section: 'closing', sectionTitle: 'Closing Duties', days: [0], start: '23:00', end: '00:00', endMode: 'fixed' } // Sunday only, fixed
];

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// A plain Date at midnight of `baseDate`, offset by an "HH:MM" time-of-day.
function dateAtTime(baseDate, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), h, m, 0, 0);
}

// A plain calendar-date Date (midnight, no time component) offset by
// `days` (may be negative).
function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Between midnight and 5am, a still-running closing shift (or the tail end
// of Sunday's 23:00-00:00 window) should still count as "last night's"
// business day rather than flipping over to a new, empty day — otherwise
// the closing panel would vanish out from under a Friday night that runs
// past midnight. Anything at 5am or later is unambiguously the new day.
function getBusinessContext(now) {
  const hours = now.getHours();
  const rollBack = hours < 5;
  const businessDate = rollBack ? addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -1) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minutes = now.getHours() * 60 + now.getMinutes() + (rollBack ? 24 * 60 : 0);
  return { businessDate, day: businessDate.getDay(), minutes };
}

// Which section (if any) should be showing right now, given the schedule
// above. Returns the matching window plus its business-day Date, or null.
function getWindowForNow(now = new Date()) {
  const { businessDate, day, minutes } = getBusinessContext(now);
  for (const w of DUTY_WINDOWS) {
    if (!w.days.includes(day)) continue;
    const startMin = toMinutes(w.start);
    if (w.endMode === 'lastClockout') {
      if (minutes >= startMin) return { ...w, businessDate };
    } else {
      let endMin = toMinutes(w.end);
      if (endMin <= startMin) endMin += 24 * 60; // e.g. Sunday 23:00 -> 00:00 wraps past midnight
      if (minutes >= startMin && minutes < endMin) return { ...w, businessDate };
    }
  }
  return null;
}

// Every FIXED-mode window occurrence (checked for today and yesterday, so a
// server restart never permanently misses one) whose end time has already
// passed as of `now`. Used by the periodic sweep to catch anyone who never
// opened/submitted the panel at all.
function getEndedFixedWindows(now = new Date()) {
  const results = [];
  for (const w of DUTY_WINDOWS) {
    if (w.endMode !== 'fixed') continue;
    for (const offset of [0, 1]) {
      const day = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -offset);
      if (!w.days.includes(day.getDay())) continue;
      const startAt = dateAtTime(day, w.start);
      let endAt = dateAtTime(day, w.end);
      if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
      if (now >= endAt) results.push({ section: w.section, sectionTitle: w.sectionTitle, day, startAt, endAt });
    }
  }
  return results;
}

module.exports = { DUTY_WINDOWS, getWindowForNow, getEndedFixedWindows, dateAtTime, addDays, getBusinessContext };
