// CockroachDB connection pool (Postgres wire protocol via the `pg` driver).
//
// IMPORTANT — this does NOT replace src/db.js yet. The app still runs
// entirely on data/db.json today. This module exists so the migration can
// happen one model file at a time (see CockroachDB Migration Plan.md,
// tasks #205-209): each model file gets converted from readDb()/writeDb()
// to query()/getClient() individually, tested, then the next one starts.
// Only once every model file has been converted does src/db.js's JSON
// reader/writer actually get removed. Until then, both exist side by side
// and nothing in production changes.
//
// DATABASE_URL (CockroachDB Cloud, cluster "the-holy-cross-db", AWS Ireland
// eu-west-1) lives in .env locally and needs adding to Render's env vars
// before any model file that uses this pool can run in production.
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — check .env (see .env.example for the expected format).');
  }
  pool = new Pool({
    connectionString,
    // CockroachDB Cloud (Basic/Serverless) certs are signed by a publicly
    // trusted CA, so Node's default trusted root store is sufficient —
    // sslmode=verify-full in the connection string already tells `pg` to
    // do full hostname+chain verification. No custom CA bundle needed,
    // unlike a self-managed CockroachDB cluster.
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  pool.on('error', (err) => {
    // Fires on idle client errors (e.g. a dropped connection) — log, don't
    // crash the whole app over a single bad connection in the pool.
    console.error('Unexpected error on idle CockroachDB client:', err.message);
  });
  return pool;
}

// Thin query helper — same shape as `pg`'s own pool.query, kept as a
// wrapper so model files import one thing (`{ query }`) instead of reaching
// into the pool directly, and so we have one place to add query logging
// later if needed.
function query(text, params) {
  return getPool().query(text, params);
}

// For code that needs multiple statements in one transaction (e.g. booking
// creation, which touches bookings + notifications together) — caller is
// responsible for client.query('BEGIN')/('COMMIT')/('ROLLBACK') and
// client.release() when done.
function getClient() {
  return getPool().connect();
}

async function testConnection() {
  const { rows } = await query('SELECT version()');
  return rows[0].version;
}

module.exports = { query, getClient, getPool, testConnection };
