/*
 * Tailor Studio — Slice 6 autofill driver (PRD §5.5, techniques proven in Phase 0b).
 *
 * Connects to the separately-launched REAL Chrome (`npm run 0b:launch`, human
 * logs in manually) over CDP on 127.0.0.1:9222 and drives the /sell/new form
 * using the exact in-page expressions validated by phase0b-fill-test.js.
 * Connection model follows phase0b.js: /json discovery → grailed page target →
 * CDP({ target }). Selectors come from grailed-selectors.json, never hardcoded.
 *
 * Hard rules (CLAUDE.md):
 *   - NEVER submits the form — the user reviews and clicks submit in Chrome.
 *   - NO navigator/fingerprint/UA spoofing of any kind (§8.3).
 *   - Refuses to start while the §8.1 circuit breaker is open, and TRIPS the
 *     breaker if a 403/challenge/logout appears mid-fill (abort, don't probe).
 *   - Network domain is enabled for observation only.
 *
 * Increment 1: connect() + fillText(). Dropdown/photo primitives land next,
 * each gated on a live-Chrome confirmation of the previous step.
 *
 * CLI test mode (live verification without the app):
 *   node ui/autofill-driver.js fill-title ["value"]
 */

const CDP = require('chrome-remote-interface');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { isCircuitOpen, tripCircuit, CIRCUIT_FILE } = require('../pipeline/compGuard');

const PORT = 9222;
const SELECTORS_PATH = path.join(__dirname, '..', 'grailed-selectors.json');
// Same signal set the phase0b scripts watched: challenge-vendor hosts, hard 403s,
// and a logged-out /api/users/me.
const CHALLENGE = /perimeterx|px-cloud|px-cdn|pxchk|captcha|recaptcha|hcaptcha|challenges\.cloudflare|human(security)?/i;
const SETTLE_MS = 1500; // post-action observation window before declaring clean

// Only a Grailed-origin 403 is a real block signal. The sell page loads
// third-party scripts/beacons/prefetches, and a benign 403 from an ad or
// analytics endpoint (or one injected by the user's own extensions) during the
// settle window must not trip the account circuit breaker (security review
// 2026-07-17, flaw #1). Challenge vendors stay origin-agnostic — they load
// cross-origin by design, and CHALLENGE already scopes them to actual
// challenge hosts.
const FIRST_PARTY = /(^|\.)grailed\.com$/i;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
function isFirstParty403(url, status) {
  return status === 403 && FIRST_PARTY.test(hostOf(url));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadSelectors() {
  return JSON.parse(fs.readFileSync(SELECTORS_PATH, 'utf8'));
}

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

// DevTools HTTP endpoint with a method (PUT /json/new on current Chrome; GET
// fallback for pre-111 builds). HTTP-only tab management — no page connection.
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
 * Open a brand-new /sell/new tab and return its target descriptor (id +
 * webSocketDebuggerUrl) so the fill can bind to EXACTLY this tab — never a
 * reused form, never the wrong sell tab when several are open (bug F,
 * PLAN-description-and-pricing-improvements §F: a reused form made new photos
 * append to a previous listing's). URL comes from grailed-selectors.json
 * (sellForm.url), tab creation is the same DevTools-HTTP /json/new technique
 * as ui/chrome-launch.js openSellTab — no page script, no navigation of
 * existing tabs. NOTE: a new tab is necessary but NOT sufficient for a clean
 * photo upload — Grailed can restore an unfinished draft into it — so
 * fillListing/uploadPhotos still assert the photo slots are actually empty.
 */
async function openFreshSellTab() {
  const url = loadSelectors().sellForm?.url || 'https://www.grailed.com/sell/new';
  const newPath = '/json/new?' + encodeURIComponent(url);
  let target = null;
  try {
    target = await devtoolsRequest('PUT', newPath);
  } catch {
    try {
      target = await devtoolsRequest('GET', newPath); // pre-111 Chrome
    } catch (err) {
      throw new Error(`Couldn’t open a fresh Sell-form tab in the launched Chrome (${err.message}). Open grailed.com/sell/new there yourself, then fill again.`);
    }
  }
  if (!target || !target.webSocketDebuggerUrl) {
    throw new Error('Couldn’t open a fresh Sell-form tab in the launched Chrome. Open grailed.com/sell/new there yourself, then fill again.');
  }
  await devtoolsRequest('GET', `/json/activate/${target.id}`).catch(() => {});
  return target;
}

async function portUp() {
  try { await getJSON('/json/version'); return true; } catch { return false; }
}

// Prefer the sell-form tab; fall back to any grailed tab (fillText will then
// report "element not found" with a hint rather than silently filling elsewhere).
// /json lists targets most-recently-focused first, so find() = the newest/
// active sell tab when several are open (bug F #3). Photo-carrying fills don't
// rely on this at all — they open their own tab and bind to its exact id
// (openFreshSellTab); this path serves changed-only re-fills + CLI primitives.
async function sellTarget() {
  const list = await getJSON('/json');
  const pages = list.filter((t) => t.type === 'page');
  return (
    pages.find((t) => /grailed\.com\/sell/.test(t.url || '')) ||
    pages.find((t) => /grailed\.com/.test(t.url || '')) ||
    null
  );
}

// Native-setter fill — verbatim technique from phase0b-fill-test.js (step 6,
// proven live): React ignores a plain `el.value =`; the native prototype setter
// plus dispatched input+change events is what registers.
const fillExpr = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'element not found', selector: ${JSON.stringify(sel)} };
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const before = el.value;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: el.value === ${JSON.stringify(value)}, before, after: el.value, url: location.href };
})()`;

// Radix dropdown expressions — verbatim from phase0b-dropdown-probe.js (step 7,
// proven live): triggers open on pointerdown/pointerup (a plain .click() does
// NOT open Radix); options are role=menuitem/option/menuitemradio; after
// selecting, the trigger is re-read by its session-stable id to confirm the
// label updated. Never match [data-radix-collection-item] (hits the top nav).
// `texts` is a list of candidate labels: the placeholder ("Item Condition")
// plus the known option values — once a value is selected, the trigger's
// visible text BECOMES that value, so the placeholder alone stops matching
// (found live 2026-07-03). Exact matches are preferred over substring ones so
// e.g. "Used" can't grab an unrelated button. If the trigger already shows
// `skipLabel` (the wanted option), report alreadySet instead of opening.
const openExpr = (texts, skipLabel) => `(() => {
  const cands = ${JSON.stringify(texts.map((t) => t.toLowerCase()))};
  const skip = ${JSON.stringify(skipLabel ? skipLabel.toLowerCase() : null)};
  const btns = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"]'));
  const ownText = (b) => (b.textContent || '').trim().toLowerCase();
  const fullText = (b) => (ownText(b) + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
  let trig = btns.find((b) => cands.includes(ownText(b)));
  if (!trig) trig = btns.find((b) => cands.some((t) => fullText(b).includes(t)));
  if (!trig) return { ok: false, reason: 'trigger not found', tried: cands };
  // Disabled triggers silently swallow clicks (found live: the dependent
  // size/sub-category dropdowns before a category is set) — say so instead
  // of reporting "menu did not open".
  if (trig.disabled || trig.getAttribute('data-disabled') !== null || trig.getAttribute('aria-disabled') === 'true')
    return { ok: false, reason: 'trigger is disabled', text: ownText(trig) };
  const r = trig.getBoundingClientRect();
  const info = { text: (trig.textContent || '').trim().slice(0, 60), id: trig.id || null, ariaExpandedBefore: trig.getAttribute('aria-expanded'), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  if (skip && ownText(trig) === skip) return { ok: true, alreadySet: true, trigger: info };
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, view: window };
  try { trig.dispatchEvent(new PointerEvent('pointerdown', o)); trig.dispatchEvent(new PointerEvent('pointerup', o)); trig.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
  return { ok: true, trigger: info };
})()`;

const readExpr = () => `(() => {
  const optSel = ['[role="option"]', '[role="menuitemradio"]', '[role="menuitem"]'];
  let opts = [], matched = null;
  for (const s of optSel) { const f = Array.from(document.querySelectorAll(s)); if (f.length) { opts = f; matched = s; break; } }
  return { optionSelectorMatched: matched, optionCount: opts.length };
})()`;

const selectExpr = (optionText) => `(() => {
  const ot = ${JSON.stringify(optionText)}.toLowerCase();
  const items = Array.from(document.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"]'));
  const item = items.find((el) => (el.textContent || '').trim().toLowerCase() === ot)
    || items.find((el) => (el.textContent || '').trim().toLowerCase().includes(ot));
  if (!item) return { ok: false, reason: 'option not found', want: ${JSON.stringify(optionText)}, available: items.map((el) => (el.textContent || '').trim().slice(0, 30)) };
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, view: window };
  try { item.dispatchEvent(new PointerEvent('pointerdown', o)); item.dispatchEvent(new PointerEvent('pointerup', o)); item.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
  return { ok: true, clicked: (item.textContent || '').trim().slice(0, 40) };
})()`;

const verifyExpr = (triggerId) => `(() => {
  const el = document.getElementById(${JSON.stringify(triggerId)});
  return { triggerText: el ? (el.textContent || '').trim().slice(0, 60) : null };
})()`;

// Nested "Department / Category" picker — technique PROVEN 2026-07-03
// (grailed-selectors.json category.technique): an in-place two-click drill, not
// a hover submenu. Locate the trigger by its placeholder ("Department /
// Category") or its selected "Dept / Cat" label (the only trigger whose text
// contains " / "); open with synthetic pointer events (the field sits above the
// fold, so real-mouse coords don't apply). If it already shows the wanted
// label, skip. `selectExpr` (above) clicks the department then the category
// menuitem — the same role=menu container re-renders in place between clicks.
const openCategoryExpr = (wantLabel) => `(() => {
  const want = ${JSON.stringify(wantLabel.toLowerCase())};
  const btns = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"]'));
  const ownText = (b) => (b.textContent || '').trim();
  const trig = btns.find((b) => ownText(b).toLowerCase() === 'department / category')
    || btns.find((b) => / \\/ /.test(ownText(b)) && b.getAttribute('aria-haspopup') === 'menu');
  if (!trig) return { ok: false, reason: 'category trigger not found — is /sell/new open?' };
  const info = { text: ownText(trig).slice(0, 60), id: trig.id || null };
  if (ownText(trig).toLowerCase() === want) return { ok: true, alreadySet: true, trigger: info };
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, view: window };
  try { trig.dispatchEvent(new PointerEvent('pointerdown', o)); trig.dispatchEvent(new PointerEvent('pointerup', o)); trig.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
  return { ok: true, trigger: info };
})()`;

// Count the visible menu options (to confirm each drill level rendered) and
// list their texts (so a bad department/category surfaces what WAS available).
const menuItemsExpr = () => `(() => {
  const items = Array.from(document.querySelectorAll('[role="menuitem"],[role="option"],[role="menuitemradio"]'));
  return { count: items.length, texts: items.map((el) => (el.textContent || '').trim()).slice(0, 40) };
})()`;

// Autocomplete (country of origin) — technique proven live 2026-07-03 (see
// grailed-selectors.json): free text does NOT persist and synthetic pointer
// events on the suggestion do nothing. Clear + focus, then REAL typing
// (Input.insertText) and a REAL mouse click on the scrolled-into-view <li>.
// checkAlready: the "value already committed → no-op" short-circuit is ONLY
// valid before this fill has typed anything (attempt 1). On retries the input
// holds our OWN uncommitted typing — which equals `want` by construction — so
// the check would false-positive and leave the field half-entered (found live
// 2026-07-12 while hardening bug G).
const acFocusExpr = (sel, want, checkAlready) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'input not found', selector: ${JSON.stringify(sel)} };
  if (el.disabled) return { ok: false, reason: 'input is disabled', selector: ${JSON.stringify(sel)} };
  if (${JSON.stringify(!!checkAlready)} && el.value.trim().toLowerCase() === ${JSON.stringify(want.toLowerCase())}) return { ok: true, alreadySet: true, value: el.value };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  return { ok: true, focused: document.activeElement === el };
})()`;

const acRectExpr = (sel, want, fallbackWant) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const container = el.closest('div.section') || el.parentElement;
  const items = Array.from(container.querySelectorAll('li'));
  // NBSP + doubled whitespace appear in suggestion labels, and Grailed's
  // designer entries are unaccented ("Comme des Garcons") while the pipeline
  // emits accented brands ("Comme des Garçons") — fold diacritics on BOTH
  // sides or the right suggestion on screen never matches (found live
  // 2026-07-18 via the designer probe).
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  const w = norm(${JSON.stringify(want)});
  // §K collab matching: "Supreme x Nike" must find "Supreme X Nike" /
  // "Nike x Supreme" / "Supreme/Nike" — compare token SETS with the collab
  // separators ("x", "×") dropped. Only used for multi-token wants so plain
  // one-word brands keep the stricter exact/substring behavior.
  const toks = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t && t !== 'x');
  const wt = toks(${JSON.stringify(want)});
  // texts = the settle signature (bug G): the caller clicks only once the
  // suggestion list reports the SAME items on two consecutive polls.
  const texts = items.map((li) => norm(li.textContent)).slice(0, 15);
  // Match priority: the full want (exact → substring → token set), then —
  // collab attempts only — the primary-brand fragment. Grailed has NO "A x B"
  // designer entries (probed live 2026-07-18: every variant returns only the
  // "Designer not listed" row), so when the full collab can't match, selecting
  // the primary brand IS the correct Grailed behavior — items list under the
  // primary designer; the collab belongs in the title/description.
  const fb = ${JSON.stringify(fallbackWant ? fallbackWant : null)};
  const fbw = fb ? norm(fb) : null;
  let usedFallback = false;
  let item = items.find((li) => norm(li.textContent) === w)
    || items.find((li) => norm(li.textContent).includes(w))
    || (wt.length > 1
      ? items.find((li) => { const lt = toks(li.textContent); return wt.every((t) => lt.includes(t)); })
      : null);
  if (!item && fbw) {
    item = items.find((li) => norm(li.textContent) === fbw)
      || items.find((li) => norm(li.textContent).includes(fbw));
    if (item) usedFallback = true;
  }
  if (!item) return { ok: false, reason: 'no matching suggestion', want: ${JSON.stringify(want)}, texts, available: items.map((li) => (li.textContent || '').trim()).slice(0, 10) };
  item.scrollIntoView({ block: 'center' });
  const r = item.getBoundingClientRect();
  return { ok: true, usedFallback, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (item.textContent || '').trim(), texts };
})()`;

// Native checkbox set-to-state (Smart Pricing toggle, plan §I). Idempotent:
// no-ops when the box already holds the wanted state — important live, since
// Grailed's fresh form renders Smart Pricing ON by default. A synthetic
// el.click() both flips .checked and fires the click event React's onChange
// listens for (same synthetic-event surface the dropdowns already use).
const checkboxExpr = (sel, want) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'checkbox not found', selector: ${JSON.stringify(sel)} };
  if (el.disabled) return { ok: false, reason: 'checkbox is disabled', selector: ${JSON.stringify(sel)} };
  const want = ${JSON.stringify(!!want)};
  const before = el.checked;
  if (before === want) return { ok: true, alreadySet: true, checked: el.checked };
  el.click();
  return { ok: el.checked === want, before, checked: el.checked };
})()`;

// Bug G fail-clean: on final failure the typed fragment is removed (same
// native-setter technique as acFocusExpr — no new surface) so the field never
// sits half-entered looking committed when it isn't.
const acClearExpr = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { cleared: false };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.blur();
  return { cleared: true };
})()`;

// §K collabs: split "A x B" / "A × B" / "A/B" / "A & B" into parts. The FIRST
// part is the primary brand — the twin of ui/main.js primaryBrand() and
// pipeline/priceProvider.js buildNarrowQueryText(), and the entry Grailed
// actually lists collab items under (no "A x B" designer entries exist —
// probed live 2026-07-18). Exported for offline unit tests.
function collabParts(value) {
  return String(value || '')
    .split(/\s+x\s+|\s*[×/&+]\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Fallback ladder for autocomplete wants whose exact Grailed entry doesn't
// exist. Collabs → the primary brand (first part). Non-collab multi-word
// brands (sub-lines — "Fear of God Essentials" probed live 2026-07-18:
// Grailed has "Fear of God" and "Essentials" but no combined entry, and its
// lookup is strict, so the full name surfaces NOTHING) → progressively
// shorter word-prefixes, longest first, at most two. The full want is always
// matched first; a fallback selection carries a note. Exported for tests.
function autocompleteFallbacks(value) {
  const want = String(value || '').replace(/\s+/g, ' ').trim();
  const parts = collabParts(want);
  if (parts.length > 1) return [parts[0]];
  const words = want.split(' ');
  const out = [];
  for (let n = words.length - 1; n >= 1 && out.length < 2; n--) out.push(words.slice(0, n).join(' '));
  return out;
}

class AutofillAbort extends Error {
  constructor(message, signals) {
    super(message);
    this.name = 'AutofillAbort';
    this.signals = signals;
  }
}

/*
 * Connect to the driven Chrome. Resolves to a driver handle:
 *   { selectors, targetUrl, fillText(sel, value), close(), signals }
 * Throws with a user-facing message when the breaker is open, Chrome isn't up,
 * or no grailed tab exists — the IPC layer surfaces these verbatim.
 *
 * opts.freshTab (bug F #1): open a brand-new /sell/new tab and bind the CDP
 * session to that exact target — photo-carrying fills use this so they can
 * never land on a reused form or the wrong sell tab. The handle then waits for
 * the form to actually render (waitForSellForm) before any fill primitive runs.
 */
async function connect({ freshTab = false } = {}) {
  if (isCircuitOpen()) {
    throw new Error(
      'Autofill disabled — the §8.1 circuit breaker is OPEN. ' +
        `Remove ${CIRCUIT_FILE} (or unset RESALE_CIRCUIT_OPEN) only after reviewing the account.`
    );
  }
  if (!(await portUp())) {
    throw new Error(
      `Chrome CDP endpoint not found on :${PORT}. Run \`npm run 0b:launch\`, log in, and open /sell/new.`
    );
  }
  const target = freshTab ? await openFreshSellTab() : await sellTarget();
  if (!target) {
    throw new Error('No grailed.com tab in the launched Chrome. Open https://www.grailed.com/sell/new there.');
  }

  const selectors = loadSelectors();
  const client = await CDP({ target: target.webSocketDebuggerUrl });
  const signals = { forbidden403: [], challengeHosts: [], loggedOut: [] };
  const uploads = []; // media-host POSTs — the success signal for uploadPhotos
  try {
    await client.Network.enable(); // observation only — the §8.1 detection watch
    client.Network.responseReceived((p) => {
      const { url, status } = p.response;
      if (isFirstParty403(url, status)) signals.forbidden403.push(url);
      if (CHALLENGE.test(url)) signals.challengeHosts.push(url);
      if (/\/api\/users\/me/.test(url) && status === 401) signals.loggedOut.push(url);
    });
    client.Network.requestWillBeSent((p) => {
      if (/upload|photo|image|s3|cloudinary|imgix/i.test(p.request.url) && p.request.method === 'POST') {
        uploads.push(p.request.url.slice(0, 90));
      }
    });
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }

  // Post-action gate: wait out a short observation window, then abort + trip
  // the breaker if any detection signal accumulated (§8.1: disable immediately,
  // don't keep testing the boundary).
  async function assertClean(label) {
    await sleep(SETTLE_MS);
    if (signals.forbidden403.length || signals.challengeHosts.length || signals.loggedOut.length) {
      tripCircuit(`autofill detection signal after ${label}: ${JSON.stringify(signals)}`);
      throw new AutofillAbort(
        `Autofill aborted after ${label}: a 403/challenge/logout appeared. ` +
          'The §8.1 circuit breaker has been tripped — scraping and autofill are disabled until you review the account.',
        signals
      );
    }
  }

  async function evaluate(expression, label) {
    const { result, exceptionDetails } = await client.Runtime.evaluate({ expression, returnByValue: true });
    if (exceptionDetails) throw new Error(`${label} threw in page: ${exceptionDetails.text || 'evaluate exception'}`);
    return result.value;
  }

  async function fillText(sel, value) {
    const res = await evaluate(fillExpr(sel, String(value)), `fillText(${sel})`);
    await assertClean(`fillText(${sel})`);
    return res; // { ok, before, after, url } | { ok:false, reason, selector }
  }

  // Set a native checkbox to an explicit state (Smart Pricing toggle). No-ops
  // when already there — see checkboxExpr.
  async function setCheckbox(sel, want) {
    const res = await evaluate(checkboxExpr(sel, want), `setCheckbox(${sel})`);
    await assertClean(`setCheckbox(${sel})`);
    return res; // { ok, alreadySet?, before?, checked } | { ok:false, reason }
  }

  // Fresh-tab fills only: wait until the sell form has actually rendered
  // (title field + photo inputs exist) before the first primitive runs — a
  // just-created /sell/new tab is still loading its React app. A timeout here
  // usually means the tab landed on a login page instead of the form.
  async function waitForSellForm() {
    const titleSel = selectors.textFields.title.selector;
    const photoSel = selectors.photos.fileInputs;
    for (let i = 0; i < 30; i++) {
      const r = await evaluate(
        `(() => ({ form: !!document.querySelector(${JSON.stringify(titleSel)}), photoInputs: document.querySelectorAll(${JSON.stringify(photoSel)}).length, url: location.href }))()`,
        'waitForSellForm'
      );
      if (r.form && r.photoInputs > 0) return r;
      await sleep(500);
    }
    throw new Error(
      'The fresh Sell-form tab never finished loading the form — check that Chrome is signed in to Grailed, then fill again.'
    );
  }

  // How many photo slots are still EMPTY on this form. Grailed renders one
  // file input per empty slot (photo_input_0..8) and removes it once the slot
  // holds a photo — so fewer inputs than photos.slots means the form already
  // has photos on it (the bug-F signal: filling would APPEND to a previous
  // listing's set). Same DOM.querySelectorAll the upload itself uses.
  async function countEmptyPhotoSlots() {
    const total = Number(selectors.photos.slots) || 9;
    const { root } = await client.DOM.getDocument();
    const { nodeIds } = await client.DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector: selectors.photos.fileInputs,
    });
    const empty = nodeIds ? nodeIds.length : 0;
    return { empty, total, filled: Math.max(0, total - empty) };
  }

  // Flat Radix dropdown: open by trigger text (pointer events, CDP mouse-click
  // fallback), select option by text, confirm the trigger label updated.
  // Waits mirror the human-paced timings the probe script validated.
  // `alternates` = other labels the trigger may currently show (typically the
  // dropdown's option values, from grailed-selectors.json) — the trigger text
  // is the selected value once one is set. Idempotent: no-ops when the trigger
  // already shows optionText.
  async function selectDropdown(triggerText, optionText, alternates = []) {
    await pressEscape(); // a menu left open would make the trigger click toggle it shut
    const candidates = [triggerText, ...alternates];
    const open = await evaluate(openExpr(candidates, optionText), `selectDropdown(${triggerText})`);
    if (!open.ok) return { ok: false, reason: open.reason, tried: candidates };
    if (open.alreadySet) return { ok: true, alreadySet: true, triggerLabel: open.trigger.text };
    await sleep(500);
    let read = await evaluate(readExpr(), `selectDropdown(${triggerText})`);
    if (read.optionCount === 0) {
      // Fallback proven in the probe: genuine CDP mouse click at the trigger center.
      const r = open.trigger.rect;
      const x = Math.round(r.x + r.w / 2), y = Math.round(r.y + r.h / 2);
      await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
      await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(500);
      read = await evaluate(readExpr(), `selectDropdown(${triggerText})`);
    }
    if (read.optionCount === 0) return { ok: false, reason: 'menu did not open', triggerText };
    const sel = await evaluate(selectExpr(optionText), `selectDropdown(${triggerText})`);
    if (!sel.ok) {
      // Close the menu we opened — leaving it up steals focus/clicks from every
      // later field (found live 2026-07-04: a failed sub-category match left the
      // menu open and the designer autocomplete typed into nothing).
      await pressEscape();
      return { ok: false, reason: sel.reason, want: optionText, available: sel.available };
    }
    await sleep(400);
    const verify = open.trigger.id
      ? await evaluate(verifyExpr(open.trigger.id), `selectDropdown(${triggerText})`)
      : { triggerText: null };
    await assertClean(`selectDropdown(${triggerText} → ${optionText})`);
    const label = verify.triggerText;
    return {
      ok: !!(label && label.toLowerCase().includes(optionText.toLowerCase())),
      triggerLabel: label,
      clicked: sel.clicked,
    };
  }

  // Esc closes any open Radix menu — reset to a known state so a trigger click
  // opens (not toggles-shut) the picker.
  async function pressEscape() {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);
  }

  // Nested "Department / Category" picker (technique PROVEN 2026-07-03; see
  // grailed-selectors.json category.technique). Two-click in-place drill:
  // open → click department → (same menu re-renders) → click category → menu
  // closes, trigger reads "Dept / Cat", and subcategory/size/designer become
  // enabled (the cascade). Idempotent: skips when already set.
  //
  // The picker opens at the DEPARTMENT level when unset, but jumps straight to
  // the CATEGORY level when a category is already set (found live). So we detect
  // the level from the rendered items rather than assuming. A cross-department
  // change on an already-set field isn't automated (no proven back control) —
  // we surface a clear "clear it in Chrome first" instead of guessing.
  //
  // NOTE: the caller owns STAGED CONFIRMATION — this commits the category it is
  // given, which cascades into the size list, so the app confirms first.
  async function selectNestedCategory(department, category) {
    const wantLabel = `${department} / ${category}`;
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const TOP = ['menswear', 'womenswear'];

    await pressEscape();
    const open = await evaluate(openCategoryExpr(wantLabel), `selectNestedCategory(${wantLabel})`);
    if (!open.ok) return { ok: false, reason: open.reason };
    if (open.alreadySet) return { ok: true, alreadySet: true, triggerLabel: open.trigger.text };
    await sleep(500);

    let items = await evaluate(menuItemsExpr(), `selectNestedCategory(open)`);
    if (items.count === 0) return { ok: false, reason: 'category menu did not open' };

    // At the department level? (items include Menswear/Womenswear.) If so, click
    // the department first — the same menu re-renders into that dept's categories.
    if (items.texts.some((t) => TOP.includes(norm(t)))) {
      const dept = await evaluate(selectExpr(department), `selectNestedCategory(dept ${department})`);
      if (!dept.ok) {
        await pressEscape(); // don't leave the picker open for the next field
        return { ok: false, reason: `department "${department}" not selectable`, available: items.texts };
      }
      await sleep(600);
      items = await evaluate(menuItemsExpr(), `selectNestedCategory(cats)`);
      if (items.count === 0) return { ok: false, reason: 'category list did not render after picking department', department };
    } else {
      // Already at category level for the current department (parsed from "X / Y").
      const curDept = (open.trigger.text.split('/')[0] || '').trim();
      if (norm(curDept) !== norm(department)) {
        await pressEscape();
        return {
          ok: false,
          reason: `category is set to "${open.trigger.text}"; changing to a different department isn't automated — clear the category in Chrome, then retry`,
        };
      }
    }

    // Click the category leaf; the menu closes and the cascade fires.
    const leaf = await evaluate(selectExpr(category), `selectNestedCategory(cat ${category})`);
    if (!leaf.ok) {
      await pressEscape(); // don't leave the picker open for the next field
      return { ok: false, reason: `category "${category}" not in ${department}`, available: items.texts };
    }
    await sleep(700);
    const verify = open.trigger.id
      ? await evaluate(verifyExpr(open.trigger.id), `selectNestedCategory(verify)`)
      : { triggerText: null };
    await assertClean(`selectNestedCategory(${wantLabel})`);
    return { ok: norm(verify.triggerText) === norm(wantLabel), triggerLabel: verify.triggerText, want: wantLabel };
  }

  // One file per photo_input_N slot via DOM.setFileInputFiles (proven step 8).
  // Grailed uploads on select then clears the input, so el.files stays 0 —
  // the POST to the media host is the success signal. `onSlot(done, total)`
  // (optional) reports each uploaded slot for the live fill checklist.
  //
  // HARD RULE (bug F #2): photos are NEVER added to a form that already has
  // some — that appends this item's photos to a previous listing's. If any
  // slot is already filled, abort with a clear message instead of mixing.
  async function uploadPhotos(paths, onSlot) {
    const missing = paths.filter((p) => !fs.existsSync(p));
    if (missing.length) return { ok: false, reason: 'files not found', missing };
    const { root } = await client.DOM.getDocument();
    const { nodeIds } = await client.DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector: selectors.photos.fileInputs,
    });
    if (!nodeIds || !nodeIds.length) return { ok: false, reason: 'no photo inputs found — is /sell/new open?' };
    const totalSlots = Number(selectors.photos.slots) || 9;
    if (nodeIds.length < totalSlots) {
      return {
        ok: false,
        reason: `this Sell form already has ${totalSlots - nodeIds.length} photo(s) — open a fresh, empty Sell form and fill again (photos are never added to an existing set)`,
      };
    }
    if (paths.length > nodeIds.length) {
      return { ok: false, reason: `only ${nodeIds.length} empty photo slots for ${paths.length} photos` };
    }
    const before = uploads.length;
    for (let i = 0; i < paths.length; i++) {
      await client.DOM.setFileInputFiles({ nodeId: nodeIds[i], files: [paths[i]] });
      await sleep(2500); // human-paced: let Grailed POST to the media host + render the preview
      await assertClean(`uploadPhotos(slot ${i}: ${path.basename(paths[i])})`);
      if (onSlot) {
        try { onSlot(i + 1, paths.length); } catch (err) { console.error('[autofill] onSlot listener failed:', err.message); }
      }
    }
    const uploadPosts = uploads.length - before;
    return {
      ok: uploadPosts >= 1,
      uploadPosts,
      requested: paths.length,
      note: uploadPosts < paths.length ? 'fewer media POSTs observed than photos — verify previews in Chrome' : undefined,
    };
  }

  // Autocomplete select: real-type the value, wait for the suggestion list to
  // SETTLE, real-click the matching suggestion, confirm the input holds the
  // suggestion's canonical text. Hardened per bug G (plan §G — designer
  // intermittently didn't commit: the list was still loading or the click
  // didn't register before the check): settle-before-click, verify + retry
  // the whole type→poll→click up to `retries` more times with small backoff,
  // and on final failure CLEAR the typed fragment so the field is never left
  // half-entered. Timings live in grailed-selectors.json autocompletes._timing.
  async function fillAutocomplete(sel, value) {
    const want = String(value).replace(/\s+/g, ' ').trim();
    // Case/whitespace/diacritic-insensitive: the input may canonicalize the
    // suggestion ("LOUIS VUITTON" chip vs clicked "Louis Vuitton"), and
    // Grailed's entries are unaccented while pipeline brands may carry accents
    // ("Comme des Garçons" → "Comme des Garcons") — that's still a fill.
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const t = (selectors.autocompletes && selectors.autocompletes._timing) || {};
    const pollMs = t.pollMs ?? 500;
    const pollTries = t.pollTries ?? 8; // ≈4s suggestion budget per attempt (the proven flow's budget, unchanged)
    const attempts = 1 + (t.retries ?? 2);
    const backoffMs = t.retryBackoffMs ?? 700;

    // §K fallback ladder, corrected 2026-07-18: Grailed's designer lookup has
    // NO "A x B" entries at all, and no combined sub-line entries either
    // ("Fear of God Essentials" surfaces nothing — probed live). Retries walk
    // autocompleteFallbacks(): collabs type the PRIMARY brand (Grailed lists
    // collab items under the primary designer); multi-word brands type shorter
    // word-prefixes. acRectExpr accepts the typed fragment as a fallback match
    // only when the full want isn't on offer; the result carries a note so the
    // checklist says what was actually selected.
    const isCollab = collabParts(want).length > 1;
    const fragments = autocompleteFallbacks(want);

    let lastFail = { ok: false, reason: 'no matching suggestion' };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(backoffMs * (attempt - 1));
      // Fragment retries apply only to "nothing matched" failures — a failed
      // CLICK (bug G's case) retypes the full value as before.
      const typed =
        attempt > 1 && fragments.length && /no matching suggestion/.test(lastFail.reason || '')
          ? fragments[Math.min(attempt - 2, fragments.length - 1)]
          : want;
      await pressEscape(); // an open menu (e.g. from a failed dropdown) would swallow the typing + click
      // Designer (and any dependent autocomplete) is DISABLED until a category
      // is chosen and Grailed enables it asynchronously after the category
      // click — failing instantly on 'input is disabled' lost real fills
      // (2026-07-04 run: Louis Vuitton reported as not found). Poll up to ~4s.
      // acFocusExpr also CLEARS the input, so every retry re-types from
      // scratch. The already-set short-circuit only applies on attempt 1 —
      // on retries the field holds our own uncommitted typing (see acFocusExpr).
      let focus = { ok: false, reason: 'input not found' };
      for (let i = 0; i < pollTries; i++) {
        focus = await evaluate(acFocusExpr(sel, want, attempt === 1), `fillAutocomplete(${sel})`);
        if (focus.ok || focus.reason !== 'input is disabled') break;
        await sleep(pollMs);
      }
      if (!focus.ok) return focus; // not found / still disabled — retyping won't change that
      if (focus.alreadySet) return focus;
      await client.Input.insertText({ text: typed });

      // Suggestions come from a network lookup, so render latency varies
      // (900ms was enough on 2026-07-03; the designer list took ~2s on
      // 2026-07-04). Poll for a matching <li>, and only click once the list
      // has SETTLED — the same items on two consecutive polls (bug G:
      // clicking a still-loading list is the intermittent no-commit). If the
      // budget ends with a match but no stable read, click the latest match
      // rather than giving up.
      let rect = { ok: false, reason: 'no matching suggestion' };
      let lastRead = rect; // last poll regardless of match — carries what WAS shown
      let lastSig = null;
      // Fragment attempts may accept the fragment alone — the full want
      // still matches first when Grailed does offer it.
      const fallbackWant = typed !== want ? typed : null;
      for (let i = 0; i < pollTries; i++) {
        await sleep(pollMs);
        const r = await evaluate(acRectExpr(sel, want, fallbackWant), `fillAutocomplete(${sel})`);
        lastRead = r;
        const sig = JSON.stringify(r.texts || []);
        if (r.ok && sig === lastSig) {
          rect = r; // settled with a match — click now
          break;
        }
        if (r.ok) rect = r; // match present but list still changing — confirm next poll
        lastSig = sig;
      }
      if (!rect.ok) {
        // Keep the last read (not the empty initial object) so the final
        // failure can say what Grailed DID offer — e.g. a collab fragment
        // retry surfaces the primary brand ("Stussy") for the manual pick.
        lastFail = lastRead.ok ? rect : lastRead;
        continue; // no suggestion matched this attempt — back off and re-type
      }

      const { x, y } = rect;
      await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
      await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(pollMs);
      const got = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.blur(); return el.value; })()`,
        `fillAutocomplete(${sel})`
      );
      await assertClean(`fillAutocomplete(${sel})`);
      const ok =
        norm(got) === norm(rect.text) ||
        (!!got && norm(got).includes(norm(rect.usedFallback ? fallbackWant : want)));
      if (ok) {
        return {
          ok: true,
          value: got,
          clicked: rect.text,
          attempt,
          ...(rect.usedFallback
            ? {
                usedFallback: true,
                note: isCollab
                  ? `“${want}” isn't a Grailed designer entry — selected the primary brand “${rect.text}”; put the collab in the title/description`
                  : `“${want}” isn't a Grailed designer entry — selected “${rect.text}” (closest parent brand); adjust in Chrome if needed`,
              }
            : {}),
        };
      }
      // The click didn't commit (the reported bug) — record why, retry clean.
      lastFail = {
        ok: false,
        reason: `value after click was "${got}" (clicked "${rect.text}")`,
        available: rect.texts,
      };
    }

    // Final failure: leave the field EMPTY (a half-typed value looks committed
    // but isn't — React wipes it on blur, or it confuses the manual fix) and
    // say exactly what the user should do.
    await evaluate(acClearExpr(sel), `fillAutocomplete(clear ${sel})`).catch(() => {});
    return {
      ok: false,
      cleared: true,
      reason:
        `couldn't select “${want}” from the suggestions after ${attempts} attempts — ` +
        'the field was cleared; pick it manually in Chrome' +
        (lastFail.available && lastFail.available.length
          ? ` (suggestions seen: ${lastFail.available.slice(0, 6).join(', ')})`
          : ` (${lastFail.reason})`),
    };
  }

  // Fresh tab: don't hand back the driver until the form has rendered — every
  // primitive (and the emptiness check) needs the React app up.
  if (freshTab) {
    try {
      await waitForSellForm();
    } catch (e) {
      await client.close().catch(() => {});
      throw e;
    }
  }

  return {
    selectors,
    targetUrl: target.url,
    targetId: target.id,
    freshTab,
    fillText,
    setCheckbox,
    selectDropdown,
    selectNestedCategory,
    uploadPhotos,
    fillAutocomplete,
    countEmptyPhotoSlots,
    signals,
    uploads,
    close: () => client.close().catch(() => {}),
  };
}

/*
 * High-level fill used by the app (IPC `autofill:fill`). Fields are pre-mapped
 * store values; null/absent fields are skipped. Scope: title, description,
 * price, condition, color, style, country of origin, photos, and (opt-in
 * only, plan §I) Grailed's native Smart Pricing toggle + floor — category/size/
 * designer fill ONLY when the app passes a user-CONFIRMED department+category
 * (staged confirmation, A1 — see grailed-selectors.json _dependentFieldsPolicy);
 * without that confirmation the cascade stays manual. Never submits.
 *
 * `onProgress` (optional) streams per-field events for a live checklist. The
 * shape is transport-agnostic (S3 — reusable verbatim by the extension shell):
 *   { kind: 'plan',  fields: string[] }                       — once, up front
 *   { kind: 'field', field, status: 'filling'|'ok'|'failed'|'skipped',
 *     done?, total?,   // photos only: slots uploaded so far
 *     reason? }
 * Listener errors never break the fill.
 */
async function fillListing(fields, onProgress) {
  const notify = (p) => {
    if (!onProgress) return;
    try { onProgress(p); } catch (err) { console.error('[autofill] onProgress listener failed:', err.message); }
  };
  // Bug F: any fill that carries photos gets its OWN brand-new /sell/new tab
  // (bound by target id — never a reused form, never the wrong tab among
  // several). Changed-only re-fills arrive with photoPaths nulled by
  // ui/main.js and deliberately keep targeting the existing form — their whole
  // point is updating the form that's already filled.
  const wantsPhotos = !!(fields.photoPaths && fields.photoPaths.length);
  const driver = await connect({ freshTab: wantsPhotos });
  try {
    // Even a brand-new tab can come up NON-empty — Grailed restores an
    // unfinished draft into /sell/new. Refuse it BEFORE any field is typed:
    // a partial fill over a restored draft would pair this item's text with
    // the previous item's photos (exactly the bug). Nothing is filled.
    if (wantsPhotos) {
      const slots = await driver.countEmptyPhotoSlots();
      if (slots.filled > 0) {
        return {
          ok: false,
          results: {},
          targetUrl: driver.targetUrl,
          message:
            `This Sell form already has ${slots.filled} photo(s) on it — Grailed restored an unfinished listing. ` +
            'Nothing was filled (photos are never mixed between listings). Publish or clear that draft in the Chrome tab, then fill again.',
        };
      }
    }
    const sel = driver.selectors;
    const results = {};
    // The plan mirrors the field gates below so the checklist can render all
    // rows (pending) before the first one starts.
    const priceDigits = fields.price != null ? String(fields.price).replace(/[^0-9]/g, '') : '';
    // Smart Pricing (plan §I): fields.smartPricing is the FLOOR VALUE and
    // non-null IS the opt-in — named like its step/results key so the app's
    // last-fill snapshot + changed-only diff track it like any other field —
    // ui/main.js only sets it when the user enabled the toggle AND gave a
    // floor. Absent/null = the driver never touches Grailed's Smart Pricing
    // section (which the live form defaults to ON — that's Grailed's state,
    // not ours to change).
    const floorDigits = fields.smartPricing != null ? String(fields.smartPricing).replace(/[^0-9]/g, '') : '';
    const cascade = !!(fields.department && fields.category);
    // §K: photos are planned (and run) FIRST — they're the highest-value field
    // and must never be a casualty of a flaky dropdown/autocomplete later on.
    const plan = [
      fields.photoPaths && fields.photoPaths.length && 'photos',
      fields.title != null && 'title',
      fields.description != null && 'description',
      priceDigits && 'price',
      floorDigits && 'smartPricing',
      fields.condition && 'condition',
      fields.color && 'color',
      fields.style && 'style',
      fields.countryOfOrigin && 'countryOfOrigin',
      cascade && 'category',
      cascade && fields.size && 'size',
      cascade && fields.subcategory && 'subcategory',
      cascade && fields.designer && 'designer',
    ].filter(Boolean);
    notify({ kind: 'plan', fields: plan });
    // Run one field, bracketing it with filling → ok/failed/skipped events.
    // §K step isolation: a field that THROWS becomes { ok:false } and the fill
    // CONTINUES (the tester's collab-designer hang aborted the run and cost
    // the photos); every field is also time-capped (grailed-selectors.json
    // fill.stepTimeoutMs) so nothing can hang the whole fill. The ONE
    // exception is AutofillAbort — a §8.1 detection signal still stops
    // everything immediately, by design.
    const fillTiming = sel.fill || {};
    const STEP_CAP = Number(fillTiming.stepTimeoutMs) || 30000;
    const PHOTO_CAP = Number(fillTiming.photoStepTimeoutMs) || 180000;
    const step = async (field, run, capMs = STEP_CAP) => {
      notify({ kind: 'field', field, status: 'filling' });
      let r;
      let timer = null;
      try {
        const timeout = new Promise((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                ok: false,
                timedOut: true,
                reason: `timed out after ${Math.round(capMs / 1000)}s — finish this field manually in Chrome`,
              }),
            capMs
          );
        });
        r = await Promise.race([run(), timeout]);
      } catch (err) {
        if (err instanceof AutofillAbort) throw err; // §8.1: detection aborts the whole run
        r = { ok: false, reason: err.message };
      } finally {
        if (timer) clearTimeout(timer);
      }
      results[field] = r;
      // r.note = an ok-with-caveat (e.g. collab designer → primary brand) —
      // surface it on the checklist so the substitution is visible pre-review.
      notify({ kind: 'field', field, status: r.skipped ? 'skipped' : r.ok ? 'ok' : 'failed', reason: r.reason || r.note });
      return r;
    };
    // §K: photos FIRST (see plan above) — runs right after the fresh-form
    // emptiness check, before any field that could fail or stall.
    if (fields.photoPaths && fields.photoPaths.length) {
      await step(
        'photos',
        () =>
          driver.uploadPhotos(fields.photoPaths, (done, total) =>
            notify({ kind: 'field', field: 'photos', status: 'filling', done, total })
          ),
        PHOTO_CAP
      );
    }
    if (fields.title != null) await step('title', () => driver.fillText(sel.textFields.title.selector, fields.title));
    if (fields.description != null)
      await step('description', () => driver.fillText(sel.textFields.description.selector, fields.description));
    if (priceDigits) await step('price', () => driver.fillText(sel.textFields.price.selector, priceDigits));
    if (floorDigits) {
      // Opt-in only (plan §I): enable Grailed's native Smart Pricing toggle,
      // then type the floor. Both idempotent; the user reviews and publishes.
      const sp = sel.smartPricing;
      await step('smartPricing', async () => {
        if (!sp || !sp.toggle || !sp.floor) return { ok: false, reason: 'smartPricing selectors missing from grailed-selectors.json' };
        const t = await driver.setCheckbox(sp.toggle, true);
        if (!t.ok) return { ok: false, reason: `couldn't enable the Smart Pricing toggle (${t.reason || 'state did not change'})` };
        const f = await driver.fillText(sp.floor, floorDigits);
        if (!f.ok) return { ok: false, reason: `toggle enabled but the floor price didn't take (${f.reason || 'value mismatch'})` };
        return { ok: true, enabled: true, alreadyEnabled: !!t.alreadySet, floor: f.after };
      });
    }
    if (fields.condition) {
      const cond = sel.dropdowns.condition;
      // Case-insensitive: the map covers both the UI's and the pipeline's
      // condition vocabularies (see appValueMap._note).
      const want = String(fields.condition).toLowerCase();
      const key = Object.keys(cond.appValueMap).find((k) => k !== '_note' && k.toLowerCase() === want);
      const grailedValue = key !== undefined ? cond.appValueMap[key] : null;
      await step('condition', async () =>
        grailedValue
          ? driver.selectDropdown(cond.triggerText, grailedValue, cond.options)
          : { ok: true, skipped: true, reason: `no Grailed mapping for condition "${fields.condition}" — pick it manually` }
      );
    }
    if (fields.color) {
      const d = sel.dropdowns.color;
      await step('color', () => driver.selectDropdown(d.triggerText, fields.color, d.options || []));
    }
    if (fields.style) {
      const d = sel.dropdowns.style;
      await step('style', () => driver.selectDropdown(d.triggerText, fields.style, d.options || []));
    }
    if (fields.countryOfOrigin) {
      await step('countryOfOrigin', () =>
        driver.fillAutocomplete(sel.autocompletes.countryOfOrigin.selector, fields.countryOfOrigin)
      );
    }
    // A1 dependent cascade: category FIRST (it enables + repopulates size/
    // sub-category/designer). Only attempted when the app passes BOTH halves —
    // the staged-confirmation gate lives in the app (ui/main.js only includes
    // these fields once the user confirmed the category in DraftEditor).
    // If the category doesn't confirm, the dependents are skipped, not guessed.
    if (cascade) {
      await step('category', () => driver.selectNestedCategory(fields.department, fields.category));
      if (results.category.ok) {
        if (fields.size) {
          const d = sel.dropdowns.size;
          const s = String(fields.size).trim();
          // Grailed size options are compound labels ("US M / EU 48-50 / 2",
          // found live) — a raw substring match is WRONG for e.g. "S" (hits
          // "US XS…" first). Try the anchored "US {size} /" form, then fall
          // back to the raw text for categories/labels that don't use it.
          // The "US x /" candidate also re-finds the trigger once a size is
          // set (its label becomes the option text — placeholder gone).
          await step('size', async () => {
            let r = await driver.selectDropdown(d.triggerTextIncludes, `US ${s} /`, [`US ${s} /`]);
            if (!r.ok && r.available) r = await driver.selectDropdown(d.triggerTextIncludes, s, [s]);
            return r;
          });
        }
        if (fields.subcategory) {
          const d = sel.dropdowns.subcategory;
          await step('subcategory', () =>
            driver.selectDropdown(d.triggerTextIncludes, fields.subcategory, [fields.subcategory])
          );
        }
        if (fields.designer) {
          await step('designer', () => driver.fillAutocomplete(sel.autocompletes.designer.selector, fields.designer));
        }
      } else {
        const skip = (what) => ({ ok: true, skipped: true, reason: `${what} skipped — category did not confirm` });
        for (const [field, label] of [['size', 'size'], ['subcategory', 'sub-category'], ['designer', 'designer']]) {
          if (fields[field === 'subcategory' ? 'subcategory' : field]) {
            results[field] = skip(label);
            notify({ kind: 'field', field, status: 'skipped', reason: results[field].reason });
          }
        }
      }
    }
    return {
      ok: Object.values(results).every((r) => r.ok),
      results,
      targetUrl: driver.targetUrl,
    };
  } finally {
    await driver.close();
  }
}

// getJSON/portUp/sellTarget are shared with ui/chrome-dock.js (window
// choreography uses the same :9222 endpoint but a browser-level connection).
module.exports = { connect, fillListing, AutofillAbort, getJSON, portUp, sellTarget, openFreshSellTab, PORT, isFirstParty403, collabParts, autocompleteFallbacks };

// ---------------------------------------------------------------- CLI test modes
// Live per-primitive verification without the app. Prereq: `npm run 0b:launch`,
// logged in, /sell/new open. Nothing here ever submits.
//   node ui/autofill-driver.js fill-title ["value"]          (""" clears the field)
//   node ui/autofill-driver.js dropdown ["Trigger"] ["Option"]  (default: condition → Used)
//   node ui/autofill-driver.js category ["Dept"] ["Category"] — COMMITS a category (cascades)
//   node ui/autofill-driver.js cascade ["Size"] ["Subcat"] ["Designer"] — size+subcat+designer
//                              (assumes a category is already set on the draft)
//   node ui/autofill-driver.js upload [paths…]  — PUTS REAL PHOTOS ON THE DRAFT; remove after
if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const actions = {
    'fill-title': async (driver) => {
      // An explicit "" is a valid value (clears the field) — only default when absent.
      const value = rest.length ? rest[0] : 'TEST FILL (driver) — clear this before submitting';
      const res = await driver.fillText(driver.selectors.textFields.title.selector, value);
      console.log('fill result:', JSON.stringify(res, null, 2));
      return res.ok;
    },
    dropdown: async (driver) => {
      const cond = driver.selectors.dropdowns.condition;
      const trigger = rest[0] || cond.triggerText;
      const option = rest[1] || 'Used';
      // Default (condition) run: known option values double as trigger labels.
      const alternates = rest[0] ? [] : cond.options;
      const res = await driver.selectDropdown(trigger, option, alternates);
      console.log('dropdown result:', JSON.stringify(res, null, 2));
      return res.ok;
    },
    cascade: async (driver) => {
      // The A1 dependents in one connection (like a real fill). Prereq: a
      // category already set on the draft (run `category` first) so the three
      // fields are enabled. All values are form-only; never submits. A failed
      // sub-field prints Grailed's available options for the next attempt.
      const size = rest[0] || 'M';
      const subcat = rest.length > 1 ? rest[1] : null; // pass "" to skip
      const designer = rest.length > 2 ? rest[2] : 'Carhartt';
      const out = {};
      out.size = await driver.selectDropdown(driver.selectors.dropdowns.size.triggerTextIncludes, size, [size]);
      if (subcat) out.subcategory = await driver.selectDropdown(driver.selectors.dropdowns.subcategory.triggerTextIncludes, subcat, [subcat]);
      if (designer) out.designer = await driver.fillAutocomplete(driver.selectors.autocompletes.designer.selector, designer);
      console.log('cascade result:', JSON.stringify(out, null, 2));
      return Object.values(out).every((r) => r.ok);
    },
    category: async (driver) => {
      // Commits a nested Department/Category (default Menswear → Outerwear),
      // which cascades into the size list. Reversible (form only). Never submits.
      const dept = rest[0] || 'Menswear';
      const cat = rest[1] || 'Outerwear';
      const res = await driver.selectNestedCategory(dept, cat);
      console.log('category result:', JSON.stringify(res, null, 2));
      return res.ok;
    },
    country: async (driver) => {
      const res = await driver.fillAutocomplete(driver.selectors.autocompletes.countryOfOrigin.selector, rest[0] || 'Portugal');
      console.log('country result:', JSON.stringify(res, null, 2));
      return res.ok;
    },
    upload: async (driver) => {
      const paths = rest.length
        ? rest
        : [path.join(__dirname, '..', 'grailed-vision-test', 'grailed-vision-test-4.jpg')];
      const res = await driver.uploadPhotos(paths);
      console.log('upload result:', JSON.stringify(res, null, 2));
      console.log('media POSTs:', JSON.stringify(driver.uploads, null, 2));
      if (res.ok) console.log('REMOVE the test photo(s) from the draft before submitting.');
      return res.ok;
    },
    // Smart Pricing (plan §I): enable Grailed's native toggle + type a floor
    // on the ACTIVE sell tab, exactly like an opted-in fill would. Form-only,
    // reversible, never submits. Run twice to see the idempotent alreadySet.
    //   node ui/autofill-driver.js smart-pricing [floor]
    'smart-pricing': async (driver) => {
      const sp = driver.selectors.smartPricing;
      const floor = String(rest[0] || '45').replace(/[^0-9]/g, '');
      const toggle = await driver.setCheckbox(sp.toggle, true);
      console.log('toggle result:', JSON.stringify(toggle, null, 2));
      if (!toggle.ok) return false;
      const f = await driver.fillText(sp.floor, floor);
      console.log('floor result:', JSON.stringify(f, null, 2));
      if (f.ok) console.log('CLEAR the Smart Pricing floor / review the toggle on the form before submitting.');
      return f.ok;
    },
    // Read-only diagnostic: how many photo slots are empty on the ACTIVE sell
    // tab (the bug-F emptiness signal). Safe to run any time.
    slots: async (driver) => {
      const res = await driver.countEmptyPhotoSlots();
      console.log('photo slots:', JSON.stringify(res, null, 2));
      console.log(res.filled > 0
        ? `→ a photo-carrying fill would REFUSE this form (${res.filled} slot(s) already filled).`
        : '→ form is empty — a fill would proceed.');
      return true;
    },
  };
  // fresh-fill exercises the REAL app path (fillListing): opens its own fresh
  // /sell/new tab, refuses a restored non-empty form, fills title + uploads a
  // test photo into that exact tab. Never submits; remove the test content.
  //   node ui/autofill-driver.js fresh-fill [photo-path]
  if (cmd === 'fresh-fill') {
    (async () => {
      console.log('== autofill-driver: fresh-fill (fillListing end-to-end) ==');
      const photo = rest[0] || path.join(__dirname, '..', 'grailed-vision-test', 'grailed-vision-test-4.jpg');
      const res = await fillListing(
        { title: 'TEST FILL (fresh-tab) — clear this before submitting', photoPaths: [photo] },
        (p) => console.log('  progress:', JSON.stringify(p))
      );
      console.log('fill result:', JSON.stringify(res, null, 2));
      console.log(res.ok
        ? '\n✅ fresh-tab fill succeeded — check the NEW Sell tab holds exactly this photo, then remove the test content.'
        : `\n⚠️  fill refused/failed: ${res.message || 'see per-field results above'}`);
    })().catch((e) => {
      console.error('❌', e.message);
      process.exit(1);
    });
  } else {
    const action = actions[cmd];
    if (!action) {
      console.log('usage: node ui/autofill-driver.js fill-title ["value"] | dropdown ["Trigger"] ["Option"] | category ["Dept"] ["Category"] | country ["Country"] | upload [paths…] | slots | smart-pricing [floor] | fresh-fill [photo]');
      process.exit(cmd ? 1 : 0);
    }
    (async () => {
      console.log(`== autofill-driver: ${cmd} ==`);
      const driver = await connect();
      try {
        console.log('connected to tab:', driver.targetUrl);
        const ok = await action(driver);
        console.log('network signals:', JSON.stringify(driver.signals));
        console.log(ok
          ? '\n✅ primitive succeeded; no detection reaction in the observation window (silent-detection caveat §8.5 applies).'
          : '\n⚠️  primitive did not confirm — see result above. Are you logged in and on /sell/new?');
      } finally {
        await driver.close();
      }
    })().catch((e) => {
      console.error('❌', e.message);
      process.exit(1);
    });
  }
}
