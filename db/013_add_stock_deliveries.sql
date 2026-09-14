-- Stock Delivery & Recheck: a sub-feature of the existing Breakage & Stock
-- page. Logs every vendor delivery (spirits, wine, beer, soft drinks,
-- food, toiletries, equipment, etc.) with a required invoice/receipt
-- photo, one or more physical-stock photos, and a tick confirming the
-- delivered stock matches the invoice. All photos are images only (no
-- video/PDF need here), so unlike `reports`, every photo goes into the
-- shared `files` table via fileStore — never on-disk.

CREATE TABLE stock_deliveries (
  id                   SERIAL PRIMARY KEY,
  category             TEXT NOT NULL,
  subcategory          TEXT DEFAULT '',
  item_name            TEXT NOT NULL,
  vendor_name          TEXT DEFAULT '',
  delivery_date        DATE NOT NULL,
  quantity             TEXT DEFAULT '',
  matches_invoice      BOOLEAN NOT NULL DEFAULT false,
  notes                TEXT DEFAULT '',
  submitted_by_user_id INT REFERENCES users(id),
  submitted_by_name    TEXT NOT NULL,
  invoice_photo_path   TEXT NOT NULL,
  stock_photo_paths    JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_deliveries_created_at ON stock_deliveries(created_at);
CREATE INDEX idx_stock_deliveries_category ON stock_deliveries(category);
