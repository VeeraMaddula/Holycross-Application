# Setup Notes — Email & SMS (in progress)

Personal reference for where things stand. Not needed by the app itself — see `README.md` for
the full generic setup instructions.

## Email (Resend) — partially done

- Signed up at resend.com, API key created and already in `.env` (`SMTP_PASS`).
- **Currently using Resend's test sender** (`SMTP_FROM=onboarding@resend.dev`), which can only
  deliver to the email address used to sign up to Resend
  (`jagannadham.ireland.edu@gmail.com`). This is fine for confirming the connection works, but
  won't send to real customers yet.
- **Still to do:** verify the domain `veera.world` in Resend (Domains → Add Domain → add the DNS
  records it gives you at wherever `veera.world` is registered). Once verified, change
  `SMTP_FROM` in `.env` to something like `bookings@veera.world`.
- Since the Resend API key was shared in chat, consider regenerating it later (Resend dashboard →
  API Keys → revoke old one → create new → update `.env`). Not urgent, just good hygiene.

## SMS (Sendmode) — not started yet

- Switched from Twilio to Sendmode (an Irish SMS provider — cheaper for Irish numbers, and
  supports a branded sender ID like "HolyCross"). Nothing set up yet — `SENDMODE_API_KEY` and
  `SENDMODE_SENDER_ID` are still placeholders (commented out) in `.env`.
- Steps are in `README.md` under "SMS via Sendmode (optional)" whenever ready to pick this up:
  sign up free, generate an API Access Key, optionally register a sender ID (takes a few days —
  goes through ComReg), buy a credit bundle (starts at 1,000 credits / €50).
- Until `SENDMODE_API_KEY` is set, SMS sends are logged as "skipped" on the Notifications page —
  nothing breaks, texts just don't go out yet.

## Quick status check

- Go to the app's **Notifications** page any time to see what's configured (email/SMS banners at
  the top) and the log of what's been sent, skipped, or failed (failed rows now show the error
  message directly underneath).
