// Stock Delivery & Recheck: logs every vendor delivery (drinks, food,
// toiletries, equipment, etc.) with an invoice photo, one or more physical
// stock photos, and a tick confirming the delivered stock matches the
// invoice. A sub-feature of the Breakage & Stock page (see
// src/models/breakage.js) — same page, same access control, separate
// table since the data shape is unrelated.
const { query } = require('../sqlPool');

// Deliberately broad — covers everything a bar/restaurant takes delivery
// of, from drinks and food through to toiletries and repairs/equipment.
// Add more here (and to the label map) if a delivery doesn't fit — nothing
// else needs to change, the value is just stored as free text elsewhere.
const STOCK_CATEGORIES = [
  { value: 'spirits', label: 'Spirits' },
  { value: 'wine_champagne', label: 'Wine & Champagne' },
  { value: 'beer', label: 'Beer' },
  { value: 'soft_drinks_juices', label: 'Soft Drinks & Juices' },
  { value: 'coffee_tea', label: 'Coffee & Tea' },
  { value: 'meat', label: 'Meat' },
  { value: 'fish_seafood', label: 'Fish & Seafood' },
  { value: 'fruit_veg', label: 'Fruit & Vegetables' },
  { value: 'dry_goods_kitchen', label: 'Dry Goods & Kitchen Supplies' },
  { value: 'toiletries_cleaning', label: 'Toiletries & Cleaning Supplies' },
  { value: 'equipment_repairs', label: 'Equipment & Repairs' },
  { value: 'other', label: 'Other' },
];
const STOCK_CATEGORY_VALUES = STOCK_CATEGORIES.map(c => c.value);
const STOCK_CATEGORY_LABELS = Object.fromEntries(STOCK_CATEGORIES.map(c => [c.value, c.label]));

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    category: r.category,
    subcategory: r.subcategory || '',
    itemName: r.item_name,
    vendorName: r.vendor_name || '',
    deliveryDate: r.delivery_date ? new Date(r.delivery_date).toISOString().slice(0, 10) : '',
    quantity: r.quantity || '',
    matchesInvoice: !!r.matches_invoice,
    notes: r.notes || '',
    submittedByUserId: r.submitted_by_user_id,
    submittedByName: r.submitted_by_name,
    invoicePhotoPath: r.invoice_photo_path,
    stockPhotoPaths: r.stock_photo_paths || [],
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null
  };
}

async function listStockDeliveries() {
  const { rows } = await query(`SELECT * FROM stock_deliveries ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

async function getStockDelivery(id) {
  const { rows } = await query(`SELECT * FROM stock_deliveries WHERE id = $1`, [Number(id)]);
  return mapRow(rows[0]);
}

async function addStockDelivery({
  category, subcategory, itemName, vendorName, deliveryDate, quantity, matchesInvoice, notes,
  submittedByUserId, submittedByName, invoicePhotoPath, stockPhotoPaths
}) {
  const cat = String(category || '').trim();
  if (!STOCK_CATEGORY_VALUES.includes(cat)) return { error: 'Pick a valid stock category.' };
  if (!itemName || !String(itemName).trim()) return { error: 'Item name is required.' };
  if (!deliveryDate) return { error: 'Delivery date is required.' };
  if (!invoicePhotoPath) return { error: 'An invoice/receipt photo is required.' };
  if (!Array.isArray(stockPhotoPaths) || !stockPhotoPaths.length) {
    return { error: 'At least one photo of the physical stock is required.' };
  }

  const { rows } = await query(
    `INSERT INTO stock_deliveries
       (category, subcategory, item_name, vendor_name, delivery_date, quantity, matches_invoice, notes,
        submitted_by_user_id, submitted_by_name, invoice_photo_path, stock_photo_paths)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      cat, (subcategory || '').trim(), String(itemName).trim(), (vendorName || '').trim(), deliveryDate,
      (quantity || '').trim(), !!matchesInvoice, (notes || '').trim(),
      submittedByUserId || null, submittedByName || 'Unknown', invoicePhotoPath, JSON.stringify(stockPhotoPaths)
    ]
  );
  return { delivery: await getStockDelivery(rows[0].id) };
}

module.exports = {
  STOCK_CATEGORIES, STOCK_CATEGORY_VALUES, STOCK_CATEGORY_LABELS,
  listStockDeliveries, getStockDelivery, addStockDelivery
};
