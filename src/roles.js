// Central list of user roles. Only "admin" currently has elevated access
// (Settings, Users, payment updates, deleting bookings). The other roles exist
// so staff can be categorized correctly now — specific permissions per role
// (e.g. what a Senior Manager can do vs a Staff Manager) can be wired in later
// by adding checks alongside requireAdmin in src/middleware.js.
const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'senior_manager', label: 'Senior Manager' },
  { value: 'general_manager', label: 'General Manager' },
  { value: 'staff_manager', label: 'Staff Manager' },
  { value: 'floor_manager', label: 'Floor Manager' },
  { value: 'bar_staff', label: 'Bar Staff' },
  { value: 'kitchen_staff', label: 'Kitchen Staff' },
  { value: 'kiosk', label: 'Kiosk (Bot)' }
];

const ROLE_VALUES = ROLES.map(r => r.value);
const ROLE_LABELS = Object.fromEntries(ROLES.map(r => [r.value, r.label]));

// "Manager or above" — used for the booking-approval workflow (a booking
// created by any of these roles never needs approval, even if it overlaps
// an existing one) and for who receives the "approval needed" notification
// when Bar Staff hits a double-booked slot.
const MANAGER_ROLES = ['admin', 'senior_manager', 'general_manager', 'floor_manager', 'staff_manager'];

module.exports = { ROLES, ROLE_VALUES, ROLE_LABELS, MANAGER_ROLES };
