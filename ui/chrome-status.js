/*
 * Tailor Studio — read-only Chrome status probe (audit §3.1/§3.2).
 *
 * Answers "is the launched Chrome ready for a fill?" using ONLY the CDP HTTP
 * endpoint: one GET of http://127.0.0.1:9222/json/list (the same data
 * `chrome-remote-interface`'s CDP.List returns). That listing carries every
 * target's type/url/title with NO WebSocket to a page target, NO
 * Runtime.enable, and NO page script — zero detection surface, which is why
 * this must never grow a Runtime.evaluate path (Runtime.enable was cleared in
 * §8.5 for the fill, but status must not need it).
 *
 * "Logged in" is inferred ONLY from a public URL signal (a Grailed tab
 * sitting on a signup/login route → false; otherwise unknown/null). The probe
 * never reads cookies or credentials — login stays manual (PRD §8.2).
 *
 * Passive by design: it neither checks nor trips the §8.1 circuit breaker
 * (the breaker gates ACTIONS — scraping and autofill; looking at a tab list
 * is neither).
 *
 * URL patterns are configuration, not magic strings — they live in
 * grailed-selectors.json under `sellForm`.
 *
 * CLI test mode (live verification without the app):
 *   node ui/chrome-status.js
 */

const fs = require('fs');
const path = require('path');
const { getJSON } = require('./autofill-driver');

const SELECTORS_PATH = path.join(__dirname, '..', 'grailed-selectors.json');

// Fallbacks mirror the shipped grailed-selectors.json sellForm block, so a
// malformed/older JSON degrades to sensible matching instead of throwing.
function sellFormConfig() {
  let sf = {};
  try {
    sf = JSON.parse(fs.readFileSync(SELECTORS_PATH, 'utf8')).sellForm || {};
  } catch {
    /* fall through to defaults */
  }
  return {
    sellForm: new RegExp(sf.urlPattern || 'grailed\\.com/sell/new', 'i'),
    grailed: new RegExp(sf.grailedUrlPattern || 'grailed\\.com', 'i'),
    login: (Array.isArray(sf.loginUrlPatterns) ? sf.loginUrlPatterns : []).map((p) => new RegExp(p, 'i')),
  };
}

/*
 * One fast, side-effect-free snapshot of the launched Chrome:
 *   connected    — the :9222 HTTP endpoint answered
 *   loggedIn     — false only if a Grailed tab is on a login/signup route;
 *                  null otherwise (unknown — the probe can't confirm a login)
 *   sellFormTabs — page targets whose url matches the sellForm pattern
 *   activeUrl    — a representative Grailed url (sell-form tab preferred)
 *   ready        — connected && sellFormTabs >= 1 && loggedIn !== false
 * Never throws: Chrome not launched (connection refused) is a normal state,
 * reported as { connected: false, ready: false }.
 */
async function getChromeStatus() {
  let list;
  try {
    list = await getJSON('/json/list');
  } catch {
    return { connected: false, loggedIn: null, sellFormTabs: 0, activeUrl: null, ready: false };
  }
  return statusFromTargets(list);
}

/** Pure classification of a /json/list payload (separate so it's testable
 * without a live Chrome — getChromeStatus only adds the HTTP fetch). */
function statusFromTargets(list) {
  const cfg = sellFormConfig();
  const pages = (Array.isArray(list) ? list : []).filter((t) => t && t.type === 'page');
  const grailedPages = pages.filter((t) => cfg.grailed.test(t.url || ''));
  const sellPages = grailedPages.filter((t) => cfg.sellForm.test(t.url || ''));
  const onLoginRoute = grailedPages.some((t) => cfg.login.some((re) => re.test(t.url || '')));
  const loggedIn = onLoginRoute ? false : null;
  return {
    connected: true,
    loggedIn,
    sellFormTabs: sellPages.length,
    activeUrl: (sellPages[0] || grailedPages[0])?.url ?? null,
    ready: sellPages.length >= 1 && loggedIn !== false,
  };
}

module.exports = { getChromeStatus, statusFromTargets };

// ---------------------------------------------------------------- CLI test mode
// Live verification across the three Chrome states (not launched / on some
// other page / on grailed.com/sell/new). Read-only — safe to run any time.
if (require.main === module) {
  getChromeStatus().then((s) => {
    console.log('== chrome-status (read-only, HTTP /json/list only) ==');
    console.log(JSON.stringify(s, null, 2));
    console.log(
      !s.connected
        ? '\nChrome not connected on :9222 (not launched, or launched without the debug port).'
        : s.ready
          ? '\n✅ ready — a Sell-form tab is open; Fill has a fresh target.'
          : s.loggedIn === false
            ? '\n⚠️  a Grailed tab is on a login/signup route — sign in manually first.'
            : '\n⚠️  connected, but no tab on the Sell form — open grailed.com/sell/new there.'
    );
  });
}
