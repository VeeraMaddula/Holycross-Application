# Bar & Restaurant Booking Admin

A self-hosted admin tool for managing table bookings at a bar/restaurant: create and track
reservations, avoid double-booking tables, see a calendar view, edit your menu/events page,
and automatically email and text customers a reminder as their booking date approaches.

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
- Automatic email + SMS notifications:
  - Confirmation message when a booking is created
  - Reminder message sent once, a configurable number of hours before the booking (checked every 15 min)
  - Cancellation message if a booking is cancelled
  - Email and SMS are independent — set up either one, both, or neither; each just sends to
    whichever of the customer's email/phone you have on file
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

   Email and SMS are both optional. If you leave the `SMTP_*` / `TWILIO_*` values blank, the app
   still works — it just logs notifications as "skipped" instead of sending them. See the **Email
   via Resend** and **SMS via Twilio** sections below for the one-time setup for each.

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

## Email via Resend (optional)

Gmail has been phasing out App Passwords for a lot of personal accounts (especially ones set up
for passwordless/passkey sign-in), so this app is set up to use [Resend](https://resend.com)
instead — a proper transactional email service with a generous free tier (3,000 emails/month),
better deliverability, and no fighting with Google's account settings.

1. Sign up free at https://resend.com.
2. Under **Domains**, add and verify a domain you own (add the DNS records Resend gives you —
   usually a few TXT/MX/CNAME records at your domain registrar). You need a verified domain to
   send to arbitrary customer addresses; Resend's shared test address only lets you email
   yourself. If you don't have a domain yet for the pub, this is the one thing you'll need to
   sort out first (a cheap domain like `theholycross.ie` works fine, or even a subdomain of one
   you already own).
3. Under **API Keys**, create a new key and copy it.
4. In `.env`, set:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=resend
   SMTP_PASS=your-resend-api-key
   SMTP_FROM=bookings@your-verified-domain.com
   ```
   `SMTP_FROM` must be an address on the domain you verified in step 2 (e.g.
   `bookings@theholycross.ie`) — Resend rejects sending from domains you haven't verified.
5. Restart the app and create a test booking with your own email to confirm it arrives.

If you skip this setup, the app works exactly as before — email is entirely optional, and SMS
(below) can cover notifications on its own if you'd rather not deal with email at all.

## SMS via Twilio (optional)

Text message notifications use [Twilio](https://www.twilio.com), the standard service for
sending SMS from an app. It's pay-as-you-go — a phone number costs roughly €1/month and each text
is a few cents, with a small free trial credit to test with.

1. Sign up at https://www.twilio.com.
2. From the Twilio Console dashboard, buy a phone number (**Phone Numbers → Buy a number** —
   pick one with SMS capability in your country or a nearby one).
3. On the same Console dashboard, copy your **Account SID** and **Auth Token**.
4. In `.env`, set:
   ```
   TWILIO_ACCOUNT_SID=your-account-sid
   TWILIO_AUTH_TOKEN=your-auth-token
   TWILIO_PHONE_NUMBER=+15551234567
   ```
   `TWILIO_PHONE_NUMBER` is the number you bought, in international format (starts with `+` and
   the country code).
5. Restart the app and create a test booking with your own phone number to confirm it arrives.
   Customer phone numbers entered in the Irish local format (e.g. `089 433 8657`) are converted
   to international format automatically before sending.

**Trial accounts:** if you haven't added billing to Twilio yet, trial accounts can only text
phone numbers you've manually verified in the Twilio Console (**Phone Numbers → Verified Caller
IDs**) — real customers' numbers won't receive anything until you add a payment method and
upgrade out of trial mode.

If you skip this setup, the app works exactly as before — SMS is entirely optional, and email
(above) can cover notifications on its own if you'd rather not use Twilio.

## Google Calendar sync (optional)

Bookings can automatically sync to a Google Calendar: creating, editing, or cancelling a booking
in the app updates a matching event there, and anything added directly on that Google Calendar
(e.g. "Closed for private function") shows up on the app's own Calendar page. This uses a
**service account**, so there's no Google sign-in screen inside the app — just a one-time setup:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project
   (e.g. "Holy Cross Booking").
2. In that project, go to **APIs & Services → Library**, search for **Google Calendar API**, and
   enable it.
3. Go to **APIs & Services → Credentials → Create Credentials → Service Account**. Give it any
   name (e.g. `holycross-booking-sync`) and finish creating it.
4. Open the service account you just created → **Keys** tab → **Add Key → Create new key → JSON**.
   This downloads a `.json` file — save it into this project folder as `google-service-account.json`
   (it's already excluded from git via `.gitignore`, since it contains a private key).
5. Copy the service account's **email address** (looks like
   `holycross-booking-sync@your-project.iam.gserviceaccount.com`) — you'll need it next.
6. Go to [Google Calendar](https://calendar.google.com). Either use an existing calendar or create
   a new one dedicated to bookings (Settings → "Add calendar" → "Create new calendar"). Open that
   calendar's **Settings**, and under **"Share with specific people"**, add the service account's
   email address with **"Make changes to events"** permission.
7. Still in that calendar's Settings, scroll to **"Integrate calendar"** and copy the **Calendar
   ID** (it looks like an email address, e.g. `abc123@group.calendar.google.com`).
8. In `.env`, set:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./google-service-account.json
   GOOGLE_CALENDAR_ID=abc123@group.calendar.google.com
   ```
9. Restart the app. Check **Settings** in the app — it should show "Connected" under Google
   Calendar sync. New bookings will now push to that calendar automatically, and events added
   directly on Google Calendar will appear on the app's Calendar page within 10 minutes (or click
   "Sync now" in Settings for an immediate pull).

If you skip this setup, the app works exactly as before — Google sync is entirely optional.

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
