// Shared phone-number helpers. Used by sms.js (sending texts) and by the
// login flow (matching a typed phone number + country code against a
// stored user.phone). Centralised here so both stay consistent instead of
// each having their own slightly-different normalization logic.

// A short, practical list for the country-code dropdown on the login page —
// not exhaustive, just common countries for this business's likely staff.
const COUNTRY_CODES = [
  { code: '+353', flag: '🇮🇪', label: 'Ireland' },
  { code: '+44', flag: '🇬🇧', label: 'UK' },
  { code: '+1', flag: '🇺🇸', label: 'US/Canada' },
  { code: '+91', flag: '🇮🇳', label: 'India' },
  { code: '+48', flag: '🇵🇱', label: 'Poland' },
  { code: '+40', flag: '🇷🇴', label: 'Romania' },
  { code: '+33', flag: '🇫🇷', label: 'France' },
  { code: '+49', flag: '🇩🇪', label: 'Germany' },
  { code: '+34', flag: '🇪🇸', label: 'Spain' },
  { code: '+351', flag: '🇵🇹', label: 'Portugal' },
  { code: '+39', flag: '🇮🇹', label: 'Italy' },
  { code: '+61', flag: '🇦🇺', label: 'Australia' },
  { code: '+55', flag: '🇧🇷', label: 'Brazil' }
];

// Converts a local Irish number (e.g. "089 433 8657") into E.164 format
// (e.g. "+353894338657"). Already-international numbers (starting with +
// or 00) are left alone. This is the same default behaviour sms.js always
// used — kept as the fallback when no explicit country code is given.
function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).trim().replace(/[\s-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) return '+353' + p.slice(1);
  return p;
}

// Combines an explicit country code (from the login page's dropdown) with
// the digits someone typed, dropping a leading trunk "0" the way you would
// when dialling internationally (e.g. "0894338657" + "+353" -> "+353894338657").
function normalizePhoneWithCountryCode(phone, countryCode) {
  if (!phone) return null;
  let p = String(phone).trim().replace(/[\s-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) return p; // already fully-qualified, ignore the dropdown
  if (!countryCode) return normalizePhone(p);
  p = p.replace(/^0+/, '');
  return countryCode + p;
}

module.exports = { COUNTRY_CODES, normalizePhone, normalizePhoneWithCountryCode };
