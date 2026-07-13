# Bar & Restaurant Booking Admin

A self-hosted admin tool for managing table bookings at a bar/restaurant: create and track
reservations, avoid double-booking tables, see a calendar view, edit your menu/events page,
and automatically email customers a reminder as their booking date approaches.

This is an **admin-only** tool — there's no public booking form. Staff enter bookings taken by
phone, walk-in, or another channel, and the app handles capacity checks, the calendar, and
reminder emails.

## Features

- Password-protected admin dashboard (single shared admin password)
- Booking CRUD with a full details page (customer, party size, table, notes, occasion, status, history)
- Table/capacity management — prevents double-booking a table for an overlapping time slot, and
  warns if a party is too big for the selected table
- Calendar view (month/week/day) of all bookings, color-coded by status
- Menu & events page you can edit from the admin panel
- Automatic email notifications:
  - Confirmation email when a booking is created
  - Reminder email sent once, a configurable number of hours before the booking (checked every 15 min)
  - Cancellation email if a booking is cancelled
  - Optional copy of every new booking sent to your own inbox
  - Notification log so you can see what was sent (or why something was skipped/failed)
- Data is stored in a local JSON file (`data/db.json`) — no database server to install

## Requirements

- [Node.js](https://nodejs.org) version 18 or later

## Setup

1. Open a terminal in this folder and install dependencies:

   ```
   npm install
   ```

2. Copy the example environment file and edit it:

   ```
   cp .env.example .env
   ```

   Open `.env` and set at minimum:
   - `ADMIN_PASSWORD` — the password staff will use to log in
   - `SESSION_SECRET` — any long random string

   Email is optional. If you leave the `SMTP_*` values blank, the app still works — it just
   logs notifications as "skipped" instead of sending them. To turn on real emails:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - For Gmail: create an **App Password** at https://myaccount.google.com/apppasswords
     (your normal Gmail password won't work here). Use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`.
   - Set `ADMIN_NOTIFICATION_EMAIL` if you want an email every time a new booking is created.

3. Start the app:

   ```
   npm start
   ```

4. Open http://localhost:3000 in your browser and log in with your admin password.

## Everyday use

- **Dashboard** — today's bookings and what's coming up next.
- **Bookings** — full list, filterable by date/status; click into any booking for details,
  editing, marking seated/completed, or cancelling.
- **Calendar** — visual view of all bookings.
- **Tables** — add/remove tables and set their seat capacity and area (e.g. Main Floor, Bar, Patio).
- **Menu & Events** — edit what's shown for your menu and list upcoming events.
- **Notifications** — see the log of every confirmation/reminder/cancellation email attempt.
- **Settings** — default booking duration, how many hours before a booking to send the reminder,
  and your opening/closing hours.

## Deploying online (optional)

To make this reachable outside your own computer, deploy it to a host like Render, Railway, or
Fly.io: push this folder to a Git repo, connect it to the host, set the same environment
variables from `.env` in the host's dashboard, and set the start command to `npm start`. The
JSON data file will live on that host's disk — for anything beyond casual use, consider
attaching persistent storage/volume so `data/db.json` survives redeploys.

## Notes on the booking capacity logic

Each table has a seat count. When you create or edit a booking, the app:
1. Rejects it if the party size is larger than the selected table's seats.
2. Rejects it if the table is already booked for an overlapping time window (based on the
   booking's start time + duration, default 90 minutes, configurable in Settings).

This keeps you from accidentally double-booking a table.
