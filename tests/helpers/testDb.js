// Points src/db.js at a throwaway temp JSON file for the duration of a test
// file, so tests never read or write the real data/db.json. Call setup()
// before requiring any module that (transitively) requires ../../src/db,
// and teardown() in an `after` hook.
const fs = require('fs');
const os = require('os');
const path = require('path');

let tempPath = null;

function setup(label) {
  tempPath = path.join(os.tmpdir(), `holycross-test-${label}-${process.pid}-${Date.now()}.json`);
  process.env.DB_FILE_PATH = tempPath;
  return tempPath;
}

function teardown() {
  if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  const tmp = tempPath ? tempPath + '.tmp' : null;
  if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
  delete process.env.DB_FILE_PATH;
  tempPath = null;
}

module.exports = { setup, teardown };
