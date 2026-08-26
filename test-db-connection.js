// One-off manual test — confirms Node can actually reach the CockroachDB
// cluster from wherever you run this (your machine, or later Render).
// Not part of the app itself. Safe to delete after use.
//
// Usage: node test-db-connection.js
// Loads your real .env, so it uses your real DATABASE_URL.
require('dotenv').config();
const { testConnection } = require('./src/sqlPool');

testConnection()
  .then((version) => {
    console.log('CONNECTED to CockroachDB.');
    console.log(version);
    process.exit(0);
  })
  .catch((err) => {
    console.error('CONNECTION FAILED:', err.message);
    process.exit(1);
  });
