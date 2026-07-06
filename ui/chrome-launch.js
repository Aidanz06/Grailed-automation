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

module.exports = { launchChrome, PROFILE, CHROME };

// ---------------------------------------------------------------- CLI test mode
if (require.main === module) {
  launchChrome().then((r) => {
    console.log('== chrome-launch ==');
    console.log(JSON.stringify(r, null, 2));
  });
}
