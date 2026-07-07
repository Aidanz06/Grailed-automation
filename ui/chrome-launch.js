/*
 * Tailor Studio — in-app launcher for the CDP Chrome.
 *
 * Extracted from phase0b.js `launch()` (step 1) so a new user never needs a
 * terminal: same binary, same dedicated profile dir, same :9222 debug port,
 * spawned detached so Chrome outlives the app. If the port is already up this
 * is a friendly no-op — it never starts a second instance.
 *
 * Process management ONLY. This module never connects to a page target, never
 * navigates existing tabs, and never touches login/captcha — the user signs in
 * to Grailed themselves in the launched window (PRD §8.2). Flags stay minimal
 * and stock: no --enable-automation, no AutomationControlled, no
 * navigator/fingerprint/UA spoofing of any kind (PRD §8.3).
 *
 * CLI test mode (live verification without the app):
 *   node ui/chrome-launch.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { portUp, PORT } = require('./autofill-driver');

// Same profile phase0b.js uses (project root/.chrome-profile) — the launched
// Chrome keeps the user's existing Grailed login across launches.
const PROFILE = path.join(__dirname, '..', '.chrome-profile');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOME = 'https://www.grailed.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIGN_IN_NEXT =
  'Sign in to Grailed there yourself if asked (login is always manual), then open grailed.com/sell/new.';

/*
 * Launch the dedicated CDP Chrome. Never throws — every path resolves to
 * { ok, alreadyRunning, message } with user-facing (no-jargon) copy; the
 * ChromeStatusChip's 4s poll picks up the state change after ok:true.
 */
async function launchChrome() {
  if (await portUp()) {
    return {
      ok: true,
      alreadyRunning: true,
      message: `Chrome is already running and connected to the app. ${SIGN_IN_NEXT}`,
    };
  }
  if (!fs.existsSync(CHROME)) {
    return {
      ok: false,
      alreadyRunning: false,
      message: 'Google Chrome isn’t installed in /Applications. Install it from google.com/chrome, then try again.',
    };
  }
  fs.mkdirSync(PROFILE, { recursive: true });

  // Flags intentionally minimal + stock (mirrors phase0b launch). NOTE what is
  // NOT here: --enable-automation (navigator.webdriver stays false) and no
  // spoofing flag of any kind (PRD §8.3).
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    HOME,
  ];

  let spawnError = null;
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    spawnError = err;
  });
  child.unref();

  // Wait for the debugging endpoint to come up (10s, matching phase0b).
  for (let i = 0; i < 40; i++) {
    if (spawnError) {
      return { ok: false, alreadyRunning: false, message: `Couldn’t start Chrome: ${spawnError.message}` };
    }
    if (await portUp()) {
      return { ok: true, alreadyRunning: false, message: `Chrome is up. ${SIGN_IN_NEXT}` };
    }
    await sleep(250);
  }
  return {
    ok: false,
    alreadyRunning: false,
    message:
      'Chrome started but never became reachable. If a Chrome window from Tailor is already open without the app connection, quit it fully (Cmd+Q) and try again.',
  };
}

// ---------------------------------------------------------------- open Sell tab

// The Sell-form URL is configuration (grailed-selectors.json sellForm.url),
// not a magic string; fall back to the shipped value if the JSON is older.
function sellFormUrl() {
  try {
    const sel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'grailed-selectors.json'), 'utf8'));
    return sel.sellForm?.url || 'https://www.grailed.com/sell/new';
  } catch {
    return 'https://www.grailed.com/sell/new';
  }
}

// One request against the DevTools HTTP endpoint (never a page connection).
function devtoolsRequest(method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/*
 * Open a NEW tab on the Sell form in the launched Chrome, via the DevTools
 * HTTP endpoint's /json/new (PUT on current Chrome; GET fallback for older
 * builds) + /json/activate to focus it. This creates a tab — it never
 * navigates or touches an existing one, runs no page script, and if the user
 * isn't signed in Grailed will show its own login page there (which they
 * complete manually, PRD §8.2). Never throws; resolves { ok, message }.
 */
async function openSellTab() {
  if (!(await portUp())) {
    return { ok: false, message: 'Chrome isn’t running with the app connection — launch it first.' };
  }
  const url = sellFormUrl();
  let target = null;
  try {
    target = await devtoolsRequest('PUT', `/json/new?${encodeURIComponent(url)}`);
  } catch {
    try {
      target = await devtoolsRequest('GET', `/json/new?${encodeURIComponent(url)}`); // pre-111 Chrome
    } catch (err) {
      return { ok: false, message: `Couldn’t open the tab: ${err.message}` };
    }
  }
  if (target && target.id) await devtoolsRequest('GET', `/json/activate/${target.id}`).catch(() => {});
  return {
    ok: true,
    message: 'Opened a Sell-form tab in Chrome. If Grailed asks you to sign in there, do that first (always manual).',
  };
}

module.exports = { launchChrome, openSellTab, PROFILE, CHROME };

// ---------------------------------------------------------------- CLI test mode
if (require.main === module) {
  launchChrome().then((r) => {
    console.log('== chrome-launch ==');
    console.log(JSON.stringify(r, null, 2));
  });
}
