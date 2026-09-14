-- Website booking approval SLA: tracks how far a pending_approval booking
-- has escalated up the manager hierarchy so the reminder sweep (see
-- runBookingApprovalEscalationSweep in src/notify.js) never re-sends a
-- tier that's already gone out. 0 = no reminder sent yet; 1 = Floor
-- Manager reminded (~1hr); 2 = + Senior Manager (~2.5hr); 3 = + General
-- Manager/Admin, SLA breached (4hr). Only meaningful while the booking is
-- still pending_approval — once approved/declined the sweep skips it
-- entirely since it filters on status.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS escalation_tier INT NOT NULL DEFAULT 0;
