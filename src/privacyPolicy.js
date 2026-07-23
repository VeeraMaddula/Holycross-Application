// Central source for both privacy notices (staff + customer) so the
// version number, contact address, and wording only live in one place.
//
// IMPORTANT: this content was drafted to be a reasonable, GDPR-informed
// starting point based on what this app actually collects — it is NOT a
// substitute for review by a solicitor or data protection professional
// before relying on it. In particular the retention periods below are
// placeholders and should be confirmed against the business's actual
// record-keeping practice.
//
// Bump STAFF_PRIVACY_VERSION whenever the staff notice materially changes —
// every user with an older accepted version gets re-prompted on next login
// (see the privacy-acceptance-gate middleware in server.js).
const STAFF_PRIVACY_VERSION = '1.0';

const CONTROLLER_NAME = 'The Holy Cross Bar & Restaurant';
const PRIVACY_CONTACT_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'waterfordholycross@gmail.com';

const STAFF_PRIVACY_SECTIONS = [
  {
    heading: 'Who we are',
    body: `${CONTROLLER_NAME}, Waterford, Ireland, is the data controller for the personal data described in this notice. `
      + `If you have any question about how your data is used, contact ${PRIVACY_CONTACT_EMAIL}.`
  },
  {
    heading: 'What we collect about you',
    list: [
      'Identity & contact details: full name, username, email address, phone number, date of birth, sex, and home location.',
      'Login credentials: a hashed password and/or a 4-digit PIN used to clock in/out on the shared kiosk tablet. Your PIN and password are never stored in plain text.',
      'Employment records: your role, roster/shift assignments, clock-in/clock-out times, break durations, and timesheet history.',
      'Photographs: a profile picture, plus a fresh photo automatically taken when you clock in or start/end a break — used only to confirm identity at the point of clocking. Clock-in photos are automatically replaced or cleared when you clock out.',
      'Duty checklist records: which tasks you or your shift ticked off, and any reason given if a duty wasn’t completed.',
      'Reports: if you file, or are named in, a "Report an Issue" submission, including any photo or file evidence attached.',
      'Cash Safe records: if you log a change to the cash safe, we record your name, the reason given, the amounts, and a photo taken at the time of submission.',
      'Requests: any time-off or other request you submit, and its outcome.'
    ]
  },
  {
    heading: 'Why we process this data, and our legal basis',
    list: [
      'To perform your contract of employment — scheduling you, recording hours worked, paying you correctly (Article 6(1)(b) GDPR).',
      'To comply with our legal obligations — e.g. Organisation of Working Time Act 1997 record-keeping, health & safety, and tax/Revenue requirements (Article 6(1)(c) GDPR).',
      'For our legitimate interests in running the business safely and fairly — e.g. verifying who clocked in, keeping an accurate log of cash movements, and following up on workplace incident reports (Article 6(1)(f) GDPR).'
    ],
    note: 'We don’t rely on your consent for the processing above — in an employment relationship, consent isn’t considered freely given, since you can’t realistically refuse and keep working normally. If anything genuinely optional is introduced in future, we’ll ask for your consent separately and you’ll be free to decline.'
  },
  {
    heading: 'Who can see your data',
    body: 'Access is restricted by role. Admin and Senior Management can see most records; Floor/General Managers see what their role needs (e.g. timesheets, rosters). '
      + 'Ordinary colleagues cannot see your timesheets, Cash Safe logs, or reports about you unless they’re the specific person you (or a colleague) addressed a report to. '
      + 'Photos attached to reports and Cash Safe logs are stored outside the public website and are reachable only by people with a legitimate reason to view them.'
  },
  {
    heading: 'Who we share it with',
    body: 'We don’t sell or share your data for marketing purposes. A small number of technical processors help us run this system: our email provider (used to send you shift/roster notifications), '
      + 'and — only if enabled — an SMS provider and Google Calendar (used only to sync shift times, never your photos or PIN). These providers only ever receive the minimum data needed to send that one message or event.'
  },
  {
    heading: 'How long we keep it',
    body: 'Timesheet and roster records are kept for the period required by the Organisation of Working Time Act 1997 (currently 3 years). '
      + 'Clock-in/break photos are automatically replaced or cleared when you clock out, so we don’t build up a photo history from routine clocking. '
      + 'Reports and Cash Safe logs are retained for as long as needed for accountability purposes, after which they may be deleted unless needed for an ongoing investigation or legal claim. '
      + '(These are the business’s current retention practices, and may be refined as formal written policy is developed.)'
  },
  {
    heading: 'Your rights',
    body: 'Under GDPR you have the right to: access the data we hold on you; ask us to correct it; ask us to delete it (subject to our legal retention obligations above); '
      + 'restrict or object to certain processing; and receive a portable copy of data you provided. '
      + `To exercise any of these, contact ${PRIVACY_CONTACT_EMAIL}. If you’re unhappy with how we’ve handled a request, you can complain to the Irish Data Protection Commission at dataprotection.ie.`
  },
  {
    heading: 'Changes to this notice',
    body: 'If we materially change what we collect or why, we’ll ask you to review and acknowledge this notice again before you can keep using the app.'
  }
];

const CUSTOMER_PRIVACY_SECTIONS = [
  {
    heading: 'Who we are',
    body: `${CONTROLLER_NAME}, Waterford, Ireland, is the data controller for the personal data described below. Contact ${PRIVACY_CONTACT_EMAIL} with any question.`
  },
  {
    heading: 'What we collect',
    body: 'When you submit a table booking request, we collect your name, phone number, email address (if given), party size, requested date and time, and any occasion or notes you choose to add.'
  },
  {
    heading: 'Why we use it',
    body: 'To process and confirm your booking, seat you appropriately, and contact you about it (including sending a calendar invite link). '
      + 'This is necessary to fulfil the booking you’ve requested (Article 6(1)(b) GDPR) and for our legitimate interest in running our reservations efficiently (Article 6(1)(f) GDPR). '
      + 'We don’t use your details for marketing unless you separately opt in elsewhere.'
  },
  {
    heading: 'How long we keep it',
    body: 'We keep booking records for as long as needed for business and tax record-keeping purposes, then delete them.'
  },
  {
    heading: 'Your rights',
    body: `You can ask to access or delete your data by contacting ${PRIVACY_CONTACT_EMAIL}. If you’re unhappy with how we’ve handled your data, you can complain to the Irish Data Protection Commission at dataprotection.ie.`
  }
];

module.exports = { STAFF_PRIVACY_VERSION, CONTROLLER_NAME, PRIVACY_CONTACT_EMAIL, STAFF_PRIVACY_SECTIONS, CUSTOMER_PRIVACY_SECTIONS };
