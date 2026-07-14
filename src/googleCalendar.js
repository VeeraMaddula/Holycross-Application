// Google Calendar sync using a service account (no user OAuth login flow needed).
// Uses Node's built-in crypto + fetch only — no extra npm dependency.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Dublin';

let cachedToken = null; // { accessToken, expiresAt }
let serviceAccount = null;
let loadAttempted = false;

function loadServiceAccount() {
  if (loadAttempted) return serviceAccount;
  loadAttempted = true;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) return null;
  const resolved = path.isAbsolute(keyPath) ? keyPath : path.join(__dirname, '..', keyPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`Google Calendar: service account key file not found at ${resolved}`);
    return null;
  }
  try {
    serviceAccount = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    return serviceAccount;
  } catch (err) {
    console.warn('Google Calendar: failed to read/parse service account key file:', err.message);
    return null;
  }
}

function isConfigured() {
  return !!loadServiceAccount() && !!process.env.GOOGLE_CALENDAR_ID;
}

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const account = loadServiceAccount();
  if (!account) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(account.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google auth failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function apiRequest(method, urlPath, body) {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`https://www.googleapis.com/calendar/v3${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google Calendar API error: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function toMinutesLocal(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function bookingToEvent(booking, table) {
  const startDateTime = `${booking.date}T${booking.time}:00`;
  const endMinutes = toMinutesLocal(booking.time) + (booking.durationMinutes || 90);
  const endHour = String(Math.floor(endMinutes / 60) % 24).padStart(2, '0');
  const endMin = String(endMinutes % 60).padStart(2, '0');
  const endDateTime = `${booking.date}T${endHour}:${endMin}:00`;

  const descLines = [
    `Party size: ${booking.partySize}`,
    booking.phone ? `Phone: ${booking.phone}` : null,
    booking.email ? `Email: ${booking.email}` : null,
    booking.occasion ? `Occasion: ${booking.occasion}` : null,
    booking.notes ? `Notes: ${booking.notes}` : null,
    `Status: ${booking.status}`
  ].filter(Boolean);

  return {
    summary: `${booking.customerName} (${booking.partySize}) - ${table ? table.name : 'Table TBC'}`,
    description: descLines.join('\n'),
    start: { dateTime: startDateTime, timeZone: TIMEZONE },
    end: { dateTime: endDateTime, timeZone: TIMEZONE },
    extendedProperties: { private: { holycrossBookingId: String(booking.id) } }
  };
}

async function createEvent(booking, table) {
  if (!isConfigured()) return null;
  const event = bookingToEvent(booking, table);
  const created = await apiRequest('POST', `/calendars/${encodeURIComponent(calendarId())}/events`, event);
  return created ? created.id : null;
}

async function updateEvent(booking, table) {
  if (!isConfigured() || !booking.googleEventId) return null;
  const event = bookingToEvent(booking, table);
  try {
    await apiRequest('PUT', `/calendars/${encodeURIComponent(calendarId())}/events/${booking.googleEventId}`, event);
    return booking.googleEventId;
  } catch (err) {
    console.warn('Google Calendar: update failed, recreating event instead:', err.message);
    return createEvent(booking, table);
  }
}

async function deleteEvent(googleEventId) {
  if (!isConfigured() || !googleEventId) return;
  try {
    await apiRequest('DELETE', `/calendars/${encodeURIComponent(calendarId())}/events/${googleEventId}`);
  } catch (err) {
    console.warn('Google Calendar: delete failed (event may already be gone):', err.message);
  }
}

// Fetches events from the shared Google Calendar that were NOT created by this app,
// so manually-added Google Calendar events (e.g. "Closed for private function") show
// up inside the booking app's own calendar view.
async function listExternalEvents() {
  if (!isConfigured()) return [];
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // next 60 days
  const params = new URLSearchParams({
    timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
  });
  const data = await apiRequest('GET', `/calendars/${encodeURIComponent(calendarId())}/events?${params.toString()}`);
  if (!data || !data.items) return [];
  return data.items
    .filter(ev => !(ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.holycrossBookingId))
    .filter(ev => ev.status !== 'cancelled')
    .map(ev => ({
      id: ev.id,
      title: ev.summary || '(untitled)',
      start: ev.start ? (ev.start.dateTime || ev.start.date) : null,
      end: ev.end ? (ev.end.dateTime || ev.end.date) : null,
      description: ev.description || ''
    }))
    .filter(ev => ev.start);
}

function startSync(models) {
  if (!isConfigured()) {
    console.log('Google Calendar sync not configured (set GOOGLE_SERVICE_ACCOUNT_KEY_PATH and GOOGLE_CALENDAR_ID in .env to enable).');
    return;
  }
  const cron = require('node-cron');
  const run = async () => {
    try {
      const events = await listExternalEvents();
      models.replaceExternalCalendarEvents(events);
      console.log(`Google Calendar: synced ${events.length} external event(s).`);
    } catch (err) {
      console.warn('Google Calendar sync failed:', err.message);
    }
  };
  run();
  cron.schedule('*/10 * * * *', run);
  console.log('Google Calendar sync scheduler started (every 10 minutes).');
}

module.exports = { isConfigured, calendarId, createEvent, updateEvent, deleteEvent, listExternalEvents, startSync };
