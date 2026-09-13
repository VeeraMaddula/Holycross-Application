// Tables: the physical seating inventory (Main Floor + the two Function
// Rooms). SQL-backed as of task #206 (tables table — see db/schema.sql;
// its shape already matched the JSON model exactly, id/name/seats/area, so
// no migration was needed here). Every exported function is now ASYNC.
//
// getTablesWithStatus (today's live occupied/reserved/available status,
// combining tables with bookings) is NOT here — it needs both tables.js
// and bookings.js, and bookings.js already requires this file (for
// getTableById), so putting it here too would create a circular require
// that breaks under this codebase's `module.exports = {...}` pattern (see
// src/models.js's own comment on avoiding exactly this). It's composed in
// src/models.js instead, which already requires both peer files safely.
const { query } = require('../sqlPool');

function mapTableRow(r) {
  return { id: r.id, name: r.name, seats: r.seats, area: r.area };
}

async function listTables() {
  const { rows } = await query(`SELECT * FROM tables ORDER BY id ASC`);
  return rows.map(mapTableRow);
}

async function createTable({ name, seats, area }) {
  const { rows } = await query(
    `INSERT INTO tables (name, seats, area) VALUES ($1, $2, $3) RETURNING *`,
    [name, Number(seats), area || 'Main Floor']
  );
  return mapTableRow(rows[0]);
}

async function deleteTable(id) {
  await query(`DELETE FROM tables WHERE id = $1`, [Number(id)]);
}

async function getTableById(id) {
  const { rows } = await query(`SELECT * FROM tables WHERE id = $1`, [Number(id)]);
  return rows[0] ? mapTableRow(rows[0]) : null;
}

module.exports = { listTables, createTable, deleteTable, getTableById };
