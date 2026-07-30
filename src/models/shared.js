// Small, pure helper functions used across more than one models/ submodule
// (booking time-window math, the default staff colour palette, role
// normalization, and the booking form's music/food sub-object builders).
// Nothing in here touches the database directly — that keeps it safe to
// import from anywhere without worrying about circular requires.
const { ROLE_VALUES } = require('../roles');

function normalizeRole(role) {
  return ROLE_VALUES.includes(role) ? role : 'bar_staff';
}

// Default colour a new staff member gets on the roster grid (admin can change
// it any time from the Users page). Cycles through a curated palette so
// people are visually distinguishable even before anyone picks manually.
const COLOR_PALETTE = [
  '#c9a24b', '#7a8f6b', '#5b6b8c', '#b5543a', '#8a5fb3',
  '#3a8a8a', '#c96b96', '#4a7a3a', '#a67c52', '#5f5fa6'
];
function defaultColorForId(id) {
  return COLOR_PALETTE[(Number(id) - 1) % COLOR_PALETTE.length];
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function bookingRange(booking, slotDuration) {
  const start = toMinutes(booking.time);
  const duration = booking.durationMinutes || slotDuration;
  return { start, end: start + duration };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function minutesToHHMM(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440; // clip overnight overflow back onto a 24h clock for display
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildMusic(input) {
  const providedBy = input.musicProvidedBy || '';
  return {
    providedBy,
    providedByOther: providedBy === 'other' ? (input.musicProvidedByOther || '') : '',
    startTime: input.musicStart || '',
    endTime: input.musicEnd || '',
    types: [].concat(input.musicTypes || []).filter(Boolean),
    typesOther: input.musicTypesOther || '',
    artistName: input.musicArtistName || '',
    price: input.musicPrice ? Number(input.musicPrice) : 0
  };
}

const FOOD_COURSE_COUNTS = { two_course: 2, three_course: 3, four_course: 4 };

function buildFood(input) {
  const pkg = input.foodPackage || '';
  const courseCount = FOOD_COURSE_COUNTS[pkg] || 0;
  const courses = [];
  for (let i = 1; i <= 4; i++) {
    const name = input['foodCourse' + i + 'Name'];
    const price = input['foodCourse' + i + 'Price'];
    if (i <= courseCount && name && name.trim()) {
      courses.push({ name: name.trim(), price: price ? Number(price) : 0 });
    }
  }
  return {
    package: pkg,
    packageOther: pkg === 'other' ? (input.foodPackageOther || '') : '',
    price: input.foodPrice ? Number(input.foodPrice) : 0,
    courses
  };
}

module.exports = {
  normalizeRole, defaultColorForId, toMinutes, bookingRange, overlaps, minutesToHHMM, buildMusic, buildFood
};
