// Wrapper around the OpenArt CLI (https://github.com/OpenArt-AI/cli) for the
// Design Studio feature (src/routes/design.js). OpenArt has no API-key
// system at all — the only programmatic access is this CLI (or their hosted
// MCP server, meant for AI agents like Claude/ChatGPT/Cursor, not a plain
// backend). The CLI signs in once via browser OAuth+PKCE and stores a
// refreshable credential file; this module shells out to it with that
// credential file redirected to the persistent disk, so it survives Render
// redeploys.
//
// SETUP (one-time, per environment): run `openart login` on a machine with a
// browser, then set OPENART_CLI_CREDENTIALS_JSON in the environment to the
// full contents of the resulting credentials file
// (~/.openart/cli-credentials.json, or %USERPROFILE%\.openart\cli-credentials.json
// on Windows). ensureCredentialsSeeded() below writes that env var to disk
// the first time the app boots with no credential file already there —
// after that, the CLI's own token refresh keeps the on-disk copy current, so
// the env var is only ever needed once per persistent disk.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Redirects the CLI's HOME (and therefore ~/.openart/cli-credentials.json)
// onto the persistent disk when one is configured (see src/persist.js),
// instead of the app's own container filesystem — otherwise the credential
// would be wiped on every Render redeploy and `openart login` would need to
// be repeated by hand each time.
const OPENART_HOME_DIR = path.join(process.env.PERSIST_DIR || path.join(__dirname, '..'), 'openart-home');
const CREDENTIALS_PATH = path.join(OPENART_HOME_DIR, '.openart', 'cli-credentials.json');

// Path to the `openart` binary itself. Render's build step installs it with
// the CLI's own default installer (see render.yaml), which lands on
// /usr/local/bin — already on PATH, so no path juggling needed. Override
// with OPENART_CLI_PATH if it's installed somewhere else.
const CLI_PATH = process.env.OPENART_CLI_PATH || 'openart';

// Best-guess model ids from OpenArt's current lineup (confirmed as of
// Sept 2026 — see https://openart.ai/mcp/). 'nano-banana-2', 'gpt-image-2',
// 'kling-3-omni', and 'pixverseV6' are copied verbatim from the CLI's own
// README examples; the rest are inferred slugs. Once credentials are set up,
// run `openart model list --json` and fix any that don't match — model ids
// change as OpenArt adds new ones.
const IMAGE_MODELS = ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2', 'seedream-5-pro', 'seedream-5-lite'];
const VIDEO_MODELS = ['seedance-2-5', 'kling-3-omni', 'grok-imagine-1-5', 'pixverseV6', 'wan-2-7'];

function ensureCredentialsSeeded() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) return; // already there — a previous boot seeded it, or the CLI refreshed it since
    const raw = process.env.OPENART_CLI_CREDENTIALS_JSON;
    if (!raw) return; // nothing to seed yet — /design will report "not connected" until this is set
    JSON.parse(raw); // fail loudly now if it's not valid JSON, rather than leaving a corrupt file for the CLI to choke on later
    fs.mkdirSync(path.dirname(CREDENTIALS_PATH), { recursive: true });
    fs.writeFileSync(CREDENTIALS_PATH, raw, { mode: 0o600 });
    console.log('OpenArt CLI credentials seeded from OPENART_CLI_CREDENTIALS_JSON.');
  } catch (err) {
    console.error('Failed to seed OpenArt CLI credentials:', err.message);
  }
}

function isConnected() {
  return fs.existsSync(CREDENTIALS_PATH);
}

// Runs the CLI with --json and parses stdout. Rejects with a readable
// message on any failure (missing binary, not logged in, OpenArt-side
// error) rather than leaking a raw stack trace up to the route handler.
function runCli(args, { timeoutMs = 6 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(CLI_PATH, [...args, '--json'], {
      env: { ...process.env, HOME: OPENART_HOME_DIR },
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error((stderr || err.message || 'OpenArt CLI call failed').trim()));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        reject(new Error(`Could not parse OpenArt CLI output: ${parseErr.message}`));
      }
    });
  });
}

// Pulls a result URL out of whatever shape the CLI's JSON actually returns —
// defensive because the exact schema hasn't been confirmed against a live
// account yet (this sandbox has no OpenArt credentials to test with). Check
// this against a real `openart generate image ... --json` run once
// credentials are live, and simplify once the real shape is confirmed.
function extractResultUrl(result) {
  if (!result) return '';
  if (typeof result.url === 'string') return result.url;
  if (Array.isArray(result.urls) && result.urls.length) return result.urls[0];
  if (result.data && typeof result.data.url === 'string') return result.data.url;
  if (Array.isArray(result.data) && result.data[0] && result.data[0].url) return result.data[0].url;
  return '';
}

async function generateImage({ prompt, model }) {
  const result = await runCli(['generate', 'image', prompt, '--model', model]);
  return { resultUrl: extractResultUrl(result), creationId: result.id || result.generationId || '', raw: result };
}

async function generateVideo({ prompt, model }) {
  const result = await runCli(['generate', 'video', prompt, '--model', model]);
  return { resultUrl: extractResultUrl(result), creationId: result.id || result.generationId || '', raw: result };
}

async function creationList(limit = 20) {
  const result = await runCli(['creation', 'list', '--limit', String(limit)]);
  return Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []);
}

async function creationGet(id) {
  return runCli(['creation', 'get', String(id)]);
}

module.exports = {
  IMAGE_MODELS, VIDEO_MODELS,
  ensureCredentialsSeeded, isConnected,
  generateImage, generateVideo, creationList, creationGet
};
