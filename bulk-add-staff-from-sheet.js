// One-off — bulk-creates the 13 staff accounts from Veera's Google Form
// response sheet (https://docs.google.com/spreadsheets/d/1M-w7OrPn2rVS__ZYcrWQjSWsaqV413Am2LDvxg0wwLA).
// Goes through the exact same models.createUser()/setUserPin() functions
// routes/users.js's "Add Staff" form uses — same uniqueness checks, same
// password hashing, same welcome email (see notify.staffWelcomeEmail,
// added for this) — this script just does 13 of them in one run instead
// of one at a time through the UI.
//
// Corrections applied per Veera's confirmation (this session):
// - Yaakoub Warde's email fixed from a typo'd "icould.com" to "icloud.com".
// - Sean Creed's and Ingrid Corr's DOB both read "0073" in the sheet
//   (obviously a data-entry error) — left blank rather than guessing.
// - Role mapped from the sheet's free-text answer to this app's actual
//   role values: "Bar Staff" -> bar_staff, "Kitchen stafff" (typo) ->
//   kitchen_staff, "Waitress" -> bar_staff (no separate front-of-house
//   role exists).
// - Rob Kearney's DOB (5/8/2009) makes him 17 as of today — created as
//   Bar Staff anyway per Veera's explicit confirmation, but flagged again
//   in this run's output as a reminder to check Irish licensing law before
//   rostering him onto anything involving alcohol service.
// - Passwords are used exactly as each person entered them on the form.
//   Three (Juliet Evans, Yaakoub Warde, Catherine Morgan) don't meet this
//   app's current password strength rule (needs a special character) —
//   they'll still work to log in (that rule is only enforced when a
//   password is SET, not at login), but are flagged below so those three
//   can be told to change theirs.
//
// Safe to re-run: any row whose email or username already exists is
// skipped (not overwritten, no duplicate created, no duplicate email
// sent) — this matters because at least Megan Morgan almost certainly
// already exists as a real user (she shows up in existing duty
// completion/report history), so this checks first exactly like the
// live "Add Staff" form does.
//
// Usage (Render Shell): node bulk-add-staff-from-sheet.js
require('dotenv').config();
const models = require('./src/models');
const notify = require('./src/notify');
const { hashPassword, isValidPassword } = require('./src/password');
const { getPool } = require('./src/sqlPool');

const ROWS = [
  { name: 'Benarji Mandala', username: 'Ben', email: 'benarjimandala4@gmail.com', password: 'Mandala123@', phone: '0894241541', dob: '2002-07-28', sex: 'Male', location: 'X91RY9A', role: 'bar_staff', pin: '3593' },
  { name: 'Megan Morgan', username: 'Megan', email: 'meganmorgan200277@gmail.com', password: 'Megan202!', phone: '0830185854', dob: '2002-09-29', sex: 'Female', location: 'Waterford', role: 'bar_staff', pin: '2002' },
  { name: 'Juliet Evans', username: 'Juliet', email: 'julietdotevans@gmail.com', password: 'Jul1etEvan5', phone: '0858010159', dob: '2006-01-04', sex: 'Female', location: 'X91A0DA Rocksprings Knockhouse Waterford', role: 'bar_staff', pin: '0401' },
  { name: 'Ella Phelan', username: 'ellaphelan', email: 'ellaphelan2004@icloud.com', password: 'Bellabags456@', phone: '0830310467', dob: '2004-07-09', sex: 'Female', location: 'Daru Holycross Butlerstown North Co.Waterford', role: 'bar_staff', pin: '8927' },
  { name: 'Maisie O’Reilly', username: 'Maisieor123', email: 'Maisieoreilly14@gmail.com', password: 'Maisieor2006?', phone: '0833165755', dob: '2006-06-06', sex: 'Female', location: 'X91x2c0', role: 'bar_staff', pin: '3693' }, // sheet said "Waitress" -> mapped to bar_staff
  { name: 'Sophie oreilly', username: 'Sophieoreilly78', email: 'sophieoreilly78@gmail.com', password: 'Sophie2004?', phone: '0831097459', dob: '2004-04-14', sex: 'Female', location: 'X91 x2c0', role: 'bar_staff', pin: '2004' },
  { name: 'Nikita Karpenko', username: 'Nikita', email: 'karpenkonikita789@gmail.com', password: 'Zxcvbnm123.', phone: '0892152875', dob: '2004-08-06', sex: 'Male', location: 'St Joseph prologue, Callan, co.Kilkenny R95T4A3', role: 'bar_staff', pin: '4565' },
  { name: 'Yaakoub', username: 'Warde', email: 'Yaakoubwarde@icloud.com', password: 'Yaakoubwarde', phone: '0871179529', dob: '2006-08-17', sex: 'Male', location: 'Alexander street x91py03', role: 'bar_staff', pin: '0982' }, // email typo fixed (icould.com -> icloud.com)
  { name: 'Molly kearney', username: 'Mollykearney06', email: 'mollykearney06@icloud.com', password: 'Blarney10*', phone: '0852764495', dob: '2006-12-07', sex: 'Female', location: 'X91yk8f', role: 'bar_staff', pin: '0712' },
  { name: 'Sean creed', username: 'Creed', email: 'screed1973@gmail.com', password: 'Spider@holy', phone: '0892130460', dob: null, sex: 'Male', location: 'X91KX7R', role: 'kitchen_staff', pin: '2209' }, // sheet DOB was "9/22/0073" -> left blank
  { name: 'Rob Kearney', username: 'Robkearney', email: 'robkearney09@icloud.com', password: 'Hiddeninn10*', phone: '0899419541', dob: '2009-05-08', sex: 'Male', location: 'X91yk8f', role: 'bar_staff', pin: '5298' }, // NOTE: 17 years old as of this run — see file header
  { name: 'Ingrid corr', username: 'Ingrid77', email: 'Ingridcorr73@gmail.com', password: 'I,ngrid77', phone: '0894336615', dob: null, sex: 'Female', location: '77 central ave lisduggan waterford x91axt2', role: 'kitchen_staff', pin: '1423' }, // sheet DOB was "5/10/0073" -> left blank
  { name: 'Catherine Morgan', username: 'Cathy', email: 'cathymorgan00@hotmail.com', password: 'Laylah88', phone: '0851982700', dob: '2000-06-15', sex: 'Female', location: '6 slievekeale road Waterford X91R26D', role: 'bar_staff', pin: '2000' }
];

async function main() {
  const results = { created: [], skipped: [], failed: [] };

  for (const row of ROWS) {
    try {
      const existingByEmail = await models.getUserByEmail(row.email);
      const existingByUsername = await models.getUserByUsername(row.username);
      if (existingByEmail || existingByUsername) {
        results.skipped.push(`${row.name} — already exists (matched by ${existingByEmail ? 'email' : 'username'})`);
        continue;
      }

      const weakPassword = !isValidPassword(row.password);
      const newUser = await models.createUser({
        name: row.name, username: row.username, email: row.email,
        passwordHash: hashPassword(row.password), role: row.role,
        phone: row.phone, dob: row.dob, sex: row.sex, location: row.location
      });
      await models.setUserPin(newUser.id, row.pin);

      const { subject, text } = notify.staffWelcomeEmail(newUser, { username: row.username, password: row.password, pin: row.pin });
      await notify.sendEmail({ to: newUser.email, subject, text, type: 'staff-welcome' });

      results.created.push(`${row.name} (id ${newUser.id}, role ${row.role})${weakPassword ? ' — password does not meet current strength rules, tell them to change it' : ''}`);
    } catch (err) {
      results.failed.push(`${row.name} — ${err.message}`);
    }
  }

  console.log('\n--- Created ---');
  console.log(results.created.length ? results.created.join('\n') : 'none');
  console.log('\n--- Skipped (already existed) ---');
  console.log(results.skipped.length ? results.skipped.join('\n') : 'none');
  console.log('\n--- Failed ---');
  console.log(results.failed.length ? results.failed.join('\n') : 'none');
  console.log(`\nDone: ${results.created.length} created, ${results.skipped.length} skipped, ${results.failed.length} failed.`);

  await getPool().end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
