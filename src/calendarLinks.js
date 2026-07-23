// Builds "add this booking to your calendar" links/files for customers —
// deliberately separate from googleCalendar.js, which pushes bookings into
// the *business's* shared Google Calendar via a service account. This
// module needs no API credentials at all: a Google Calendar "render" URL
// and a standard .ics file both work with nothing but plain data, and the
// .ics file is universal (Google, Apple, Outlook all accept it).
const TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Dublin';

// Converts a local wall-clock date+time in `timeZone` to a UTC Date object,
// correctly accounting for DST (Ireland is UTC+0 in winter, UTC+1 in
// summer). Uses the standard Intl-based trick: format a UTC guess in the
// target zone, see how far off it displays, then correct by that amount.
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const utcGuess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = fmt.formatToParts(utcGuess).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const shownAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offset = utcGuess.getTime() - shownAsUtc;
  return new Date(utcGuess.getTime() + offset);
}

function toGoogleDateFormat(date) {
  // YYYYMMDDTHHMMSSZ
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function bookingWindow(booking) {
  const start = zonedTimeToUtc(booking.date, booking.time, TIMEZONE);
  const end = new Date(start.getTime() + (booking.durationMinutes || 90) * 60000);
  return { start, end };
}

// A plain URL — no Google account/API access needed. Opens Google
// Calendar's "quick add" screen pre-filled with the booking; the customer
// just has to hit Save.
function googleCalendarAddLink(booking, table) {
  const { start, end } = bookingWindow(booking);
  const details = [
    `Party size: ${booking.partySize}`,
    table && table.area === 'Function Room' ? `Room: ${table.name}` : null,
    booking.occasion ? `Occasion: ${booking.occasion}` : null,
    `The Holy Cross — ${process.env.RESTAURANT_ADDRESS || 'Waterford'}`,
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `The Holy Cross — Table for ${booking.partySize}`,
    dates: `${toGoogleDateFormat(start)}/${toGoogleDateFormat(end)}`,
    details,
    location: process.env.RESTAURANT_ADDRESS || 'The Holy Cross'
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsEscape(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Standard .ics file — works as an email attachment that Google, Apple,
// and Outlook calendar apps all recognize and offer to add on their own,
// no "Add to Google Calendar" click needed if the customer just opens it.
function bookingIcs(booking, table) {
  const { start, end } = bookingWindow(booking);
  const now = toGoogleDateFormat(new Date());
  const descLines = [
    `Party size: ${booking.partySize}`,
    table && table.area === 'Function Room' ? `Room: ${table.name}` : null,
    booking.occasion ? `Occasion: ${booking.occasion}` : null
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Holy Cross//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@holycrosswaterford.ie`,
    `DTSTAMP:${now}`,
    `DTSTART:${toGoogleDateFormat(start)}`,
    `DTEND:${toGoogleDateFormat(end)}`,
    `SUMMARY:${icsEscape(`The Holy Cross — Table for ${booking.partySize}`)}`,
    `DESCRIPTION:${icsEscape(descLines.join('\\n'))}`,
    `LOCATION:${icsEscape(process.env.RESTAURANT_ADDRESS || 'The Holy Cross')}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.join('\r\n');
}

module.exports = { zonedTimeToUtc, googleCalendarAddLink, bookingIcs };
