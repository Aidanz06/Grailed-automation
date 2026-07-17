#!/usr/bin/env node
/*
 * Phase 0b harness — real Chrome + CDP driver, steps 1-5 ONLY (PRD §11).
 *
 * Deliberately built on `chrome-remote-interface` (a raw CDP client) instead
 * of Puppeteer/Playwright, because those auto-enable the Runtime domain on
 * connect — which would silently contaminate step 5, whose entire purpose is
 * to isolate the effect of enabling Runtime. Here, NOTHING is enabled unless
 * this script explicitly calls `.enable()`.
 *
 * Experimental design:
 *   - Network domain is the observation instrument. It is enabled in BOTH the
 *     `check` (steps 3-4) and `runtime-test` (step 5) flows, held constant, so
 *     that Runtime.enable is the ONLY new variable introduced in step 5.
 *   - Runtime is NEVER enabled until step 5, and Runtime.evaluate is NEVER
 *     called at all (no fill logic in this phase).
 *   - No navigator / fingerprint / UA spoofing anywhere (PRD §8.3).
 *
 * Commands:
 *   node phase0b.js launch        # step 1
 *   node phase0b.js check         # steps 3 + 4 (run after login, and again after "restarting the app")
 *   node phase0b.js runtime-test  # step 5
 */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 9222;
const PROFILE = path.join(__dirname, '..', '.chrome-profile'); // repo root — scripts moved into phase0Test/
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOME = 'https://www.grailed.com';
const SELL = 'https://www.grailed.com/sell';
const MONITOR_LOG = path.join(__dirname, 'phase0b-monitor.log');

const CHALLENGE_HOSTS = /perimeterx|px-cloud|px-cdn|pxchk|captcha|recaptcha|hcaptcha|challenges\.cloudflare|human(security)?/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

async function portUp() {
  try { await getJSON('/json/version'); return true; } catch { return false; }
}

// ---------------------------------------------------------------- step 1
async function launch() {
  if (await portUp()) {
    console.log(`A Chrome with remote debugging is ALREADY up on :${PORT}.`);
    console.log('If that is our instance, skip launch and go straight to login.');
    return;
  }
  fs.mkdirSync(PROFILE, { recursive: true });

  // Flags kept intentionally minimal + stock. NOTE what is NOT here:
  //   - no --enable-automation  (so navigator.webdriver stays false)
  //   - no --disable-blink-features=AutomationControlled or any spoofing flag
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    HOME,
  ];

  console.log('Launching real Google Chrome (separate instance, dedicated profile)…');
  console.log('  binary :', CHROME);
  console.log('  profile:', PROFILE);
  console.log('  flags  :', args.join(' '));

  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  child.unref();

  // Wait for the debugging endpoint to come up.
  for (let i = 0; i < 40; i++) {
    if (await portUp()) {
      const v = await getJSON('/json/version');
      console.log('\n✅ Chrome is up with remote debugging.');
      console.log('   ', v.Browser, '|', v['User-Agent']);
      console.log('\n>>> STEP 2: In that Chrome window, log into Grailed and solve the captcha yourself.');
      console.log('    When you are fully logged in, tell me and I will run `check` (steps 3-4).');
      return;
    }
    await sleep(250);
  }
  console.error('❌ Debugging endpoint never came up on :' + PORT);
}

async function grailedTarget() {
  const list = await getJSON('/json');
  const page =
    list.find((t) => t.type === 'page' && /grailed\.com/.test(t.url)) ||
    list.find((t) => t.type === 'page');
  return page || null;
}

function summarizeCookies(cookies) {
  const g = cookies.filter((c) => /grailed\.com/.test(c.domain));
  // Report NAMES + metadata only — never values.
  const authish = g.filter((c) =>
    /(sess|auth|token|sign|user|remember|_grailed|jwt|sid)/i.test(c.name)
  );
  return {
    grailedCookieCount: g.length,
    authishCookieNames: authish.map((c) => c.name),
    pxCookieNames: g.filter((c) => /^_px/i.test(c.name)).map((c) => c.name),
    longestExpiryDays: g.reduce((max, c) => {
      if (!c.expires || c.expires < 0) return max;
      const days = (c.expires * 1000 - Date.now()) / 86400000;
      return Math.max(max, days);
    }, 0),
  };
}

// Observe one navigation with the Network domain (instrument held constant).
async function observeNavigation(client, url, label) {
  const seen = [];
  const handler = ({ response, type }) => {
    seen.push({ url: response.url, status: response.status, type });
  };
  client.Network.responseReceived(handler);
  await client.Page.navigate({ url });
  await sleep(7000);

  const usersMe = seen.filter((e) => /\/api\/users\/me/.test(e.url)).map((e) => e.status);
  const signIn = seen.filter((e) => /\/api\/sign_in/.test(e.url)).map((e) => e.status);
  const forbidden = seen.filter((e) => e.status === 403).map((e) => e.url);
  const challenges = seen.filter((e) => CHALLENGE_HOSTS.test(e.url)).map((e) => e.url);

  const tab = await grailedTarget();
  const result = {
    label,
    requestedUrl: url,
    finalUrl: tab ? tab.url : '(unknown)',
    apiUsersMeStatuses: usersMe,
    apiSignInStatuses: signIn,
    forbidden403Urls: forbidden.slice(0, 12),
    challengeHostRequests: [...new Set(challenges)].slice(0, 12),
    totalResponses: seen.length,
  };
  return result;
}

// Append one line per observation so the account can be monitored over days
// without a process running continuously. JSONL for easy parsing later.
function appendMonitorLog(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(MONITOR_LOG, line);
  console.log('[monitor] logged to', path.basename(MONITOR_LOG));
}

function verdictFromNav(nav) {
  const loggedIn = nav.apiUsersMeStatuses.includes(200);
  const loggedOut = nav.apiUsersMeStatuses.includes(401);
  const challenged = nav.challengeHostRequests.length > 0 || nav.forbidden403Urls.length > 0;
  return { loggedIn, loggedOut, challenged };
}

// ---------------------------------------------------------------- steps 3+4
async function check() {
  if (!(await portUp())) {
    console.error('❌ No debugging endpoint on :' + PORT + '. Run `launch` first.');
    return;
  }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No page target found.'); return; }

  console.log('== STEP 3: session survived (app restarted → fresh CDP connection) ==');
  const client = await CDP({ target: target.webSocketDebuggerUrl });
  try {
    // Cookies: minimal footprint — Storage.getCookies needs no domain enabled,
    // and specifically does NOT enable Runtime.
    const { cookies } = await client.Storage.getCookies();
    const cookieSummary = summarizeCookies(cookies);
    console.log(JSON.stringify(cookieSummary, null, 2));

    console.log('\n== STEP 4: session STILL valid post-reconnect (server-side check) ==');
    console.log('(enabling Network only — Runtime is NOT enabled here)');
    await client.Network.enable();
    const nav = await observeNavigation(client, SELL, 'check/step4');
    const v = verdictFromNav(nav);
    console.log(JSON.stringify(nav, null, 2));
    console.log('\nverdict:', JSON.stringify(v));

    appendMonitorLog({
      event: 'check',
      loggedIn: v.loggedIn,
      loggedOut: v.loggedOut,
      challenged: v.challenged,
      apiUsersMe: nav.apiUsersMeStatuses,
      forbidden403: nav.forbidden403Urls.length,
      challengeHosts: nav.challengeHostRequests.length,
      finalUrl: nav.finalUrl,
    });
    if (v.loggedIn && !v.challenged) {
      console.log('✅ Session valid after CDP reconnect; no challenge triggered by connecting/observing.');
    } else if (v.loggedOut) {
      console.log('⚠️  Appears logged OUT (/api/users/me 401) — either login did not stick or reconnect invalidated it.');
    } else if (v.challenged) {
      console.log('⚠️  A challenge/403 appeared during reconnect+observe — investigate.');
    } else {
      console.log('❓ Inconclusive — /api/users/me not observed. See finalUrl / totalResponses above.');
    }
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------- step 5
async function runtimeTest() {
  if (!(await portUp())) {
    console.error('❌ No debugging endpoint on :' + PORT + '. Run `launch` first.');
    return;
  }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No page target found.'); return; }

  console.log('== STEP 5: does enabling the CDP Runtime domain change anything? ==');
  console.log('Network is the constant instrument. Runtime is the ONLY new variable.');
  console.log('Runtime.evaluate is NEVER called — we only enable the domain.\n');

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  try {
    await client.Network.enable();

    console.log('--- BASELINE (Runtime NOT enabled) ---');
    const before = await observeNavigation(client, SELL, 'baseline');
    const vBefore = verdictFromNav(before);
    console.log(JSON.stringify(before, null, 2));
    console.log('baseline verdict:', JSON.stringify(vBefore), '\n');

    console.log('>>> Calling Runtime.enable() now (NO Runtime.evaluate) …');
    await client.Runtime.enable();
    // Give any silent/async server reaction a moment, purely passively.
    await sleep(3000);

    console.log('--- AFTER Runtime.enable (reload same page) ---');
    const after = await observeNavigation(client, SELL, 'post-runtime-enable');
    const vAfter = verdictFromNav(after);
    console.log(JSON.stringify(after, null, 2));
    console.log('post-runtime verdict:', JSON.stringify(vAfter), '\n');

    console.log('=== DELTA (Runtime.enable is the only difference) ===');
    const delta = {
      usersMe: { before: before.apiUsersMeStatuses, after: after.apiUsersMeStatuses },
      signIn: { before: before.apiSignInStatuses, after: after.apiSignInStatuses },
      new403s: after.forbidden403Urls.filter((u) => !before.forbidden403Urls.includes(u)),
      newChallengeHosts: after.challengeHostRequests.filter(
        (u) => !before.challengeHostRequests.includes(u)
      ),
      finalUrl: { before: before.finalUrl, after: after.finalUrl },
    };
    console.log(JSON.stringify(delta, null, 2));

    const flagged =
      delta.new403s.length > 0 ||
      delta.newChallengeHosts.length > 0 ||
      (vBefore.loggedIn && !vAfter.loggedIn);
    console.log(
      '\n' +
        (flagged
          ? '🚩 RED FLAG: enabling Runtime coincided with a new 403 / challenge / lost session.'
          : '✅ No VISIBLE change after Runtime.enable (see the important caveat in the report).')
    );
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------- step 6a (probe)
// EXACTLY ONE Runtime.evaluate. Read navigator.webdriver + locate the title
// input (read attributes only — NO focus/click/fill). Deliberately does NOT
// call Runtime.enable: Runtime.evaluate works without it, and Runtime.enable is
// the command §8.5 specifically flags, so omitting it keeps the footprint as
// narrow as possible. No fill logic beyond this — scope ends here.
async function probe() {
  if (!(await portUp())) {
    console.error('❌ No debugging endpoint on :' + PORT + '. Run `launch` first.');
    return;
  }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No page target found.'); return; }

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  try {
    await client.Network.enable(); // observation instrument only (not Runtime)

    console.log('== STEP 6a PROBE: exactly one Runtime.evaluate (Runtime.enable NOT called) ==\n');
    console.log('--- land on /sell/new, capture BASELINE network signals ---');
    const baseline = await observeNavigation(client, SELL, 'probe/baseline');
    console.log(JSON.stringify(baseline, null, 2));

    const expression = `(() => {
      const candidates = [
        'input[name="title"]','input#title','input[placeholder*="title" i]',
        'input[aria-label*="title" i]','input[data-testid*="title" i]','textarea[name="title"]'
      ];
      const describe = (el, sel) => ({
        matchedSelector: sel,
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute('name'),
        id: el.id || null,
        placeholder: el.getAttribute('placeholder'),
        ariaLabel: el.getAttribute('aria-label'),
        dataTestid: el.getAttribute('data-testid'),
        type: el.getAttribute('type'),
        maxLength: el.getAttribute('maxlength')
      });
      let found = null;
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) { found = describe(el, sel); break; }
      }
      let fallbackInputs = null;
      if (!found) {
        fallbackInputs = Array.from(document.querySelectorAll('input,textarea'))
          .slice(0, 20).map((el) => describe(el, null));
      }
      return { webdriver: navigator.webdriver, url: location.href, titleField: found, fallbackInputs };
    })()`;

    console.log('\n>>> Making the ONE Runtime.evaluate call now …');
    const { result, exceptionDetails } = await client.Runtime.evaluate({
      expression,
      returnByValue: true,
    });
    if (exceptionDetails) console.log('evaluate exceptionDetails:', JSON.stringify(exceptionDetails));
    const probeResult = result && result.value;

    console.log('\n=== PROBE RESULT ===');
    console.log(JSON.stringify(probeResult, null, 2));
    console.log('\nnavigator.webdriver =', probeResult ? probeResult.webdriver : '(no value)');
    if (probeResult && probeResult.titleField) {
      console.log('title field FOUND via selector:', probeResult.titleField.matchedSelector);
    } else {
      console.log('⚠️  title field NOT found by any candidate — see fallbackInputs above.');
    }

    console.log('\n--- immediately AFTER evaluate: re-observe network for a reaction ---');
    const after = await observeNavigation(client, SELL, 'probe/post-evaluate');
    console.log(JSON.stringify(after, null, 2));
    const vAfter = verdictFromNav(after);

    const flagged =
      after.forbidden403Urls.length > baseline.forbidden403Urls.length ||
      after.challengeHostRequests.length > baseline.challengeHostRequests.length ||
      !vAfter.loggedIn;
    console.log(
      '\n' +
        (flagged
          ? '🚩 RED FLAG: a 403 / challenge / logout appeared right after the evaluate.'
          : '✅ No immediate network-visible reaction to the Runtime.evaluate (silent-detection caveat still applies).')
    );

    appendMonitorLog({
      event: 'probe',
      loggedIn: vAfter.loggedIn,
      loggedOut: vAfter.loggedOut,
      challenged: vAfter.challenged,
      apiUsersMe: after.apiUsersMeStatuses,
      forbidden403: after.forbidden403Urls.length,
      challengeHosts: after.challengeHostRequests.length,
      finalUrl: after.finalUrl,
      webdriver: probeResult ? probeResult.webdriver : null,
      titleSelector: probeResult && probeResult.titleField ? probeResult.titleField.matchedSelector : null,
    });
  } finally {
    await client.close();
  }
}

const cmd = process.argv[2];
({
  launch,
  check,
  'runtime-test': runtimeTest,
  probe,
}[cmd] || (() => {
  console.log('usage: node phase0b.js <launch|check|runtime-test|probe>');
}))().catch((e) => {
  console.error('harness error:', e && e.message ? e.message : e);
  process.exit(1);
});
