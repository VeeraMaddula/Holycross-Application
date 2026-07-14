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

## SMS (Twilio) — not started yet

- Nothing set up yet. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` are all
  still placeholders in `.env`.
- Steps are in `README.md` under "SMS via Twilio (optional)" whenever ready to pick this up.
- Trial Twilio accounts can only text phone numbers manually verified in the Twilio Console until
  billing is added.

## Quick status check

- Go to the app's **Notifications** page any time to see what's configured (email/SMS banners at
  the top) and the log of what's been sent, skipped, or failed (failed rows now show the error
  message directly underneath).
