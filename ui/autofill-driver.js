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

async function portUp() {
  try { await getJSON('/json/version'); return true; } catch { return false; }
}

// Prefer the sell-form tab; fall back to any grailed tab (fillText will then
// report "element not found" with a hint rather than silently filling elsewhere).
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
const acFocusExpr = (sel, want) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'input not found', selector: ${JSON.stringify(sel)} };
  if (el.disabled) return { ok: false, reason: 'input is disabled', selector: ${JSON.stringify(sel)} };
  if (el.value.trim().toLowerCase() === ${JSON.stringify(want.toLowerCase())}) return { ok: true, alreadySet: true, value: el.value };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  return { ok: true, focused: document.activeElement === el };
})()`;

const acRectExpr = (sel, want) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const container = el.closest('div.section') || el.parentElement;
  const items = Array.from(container.querySelectorAll('li'));
  // NBSP + doubled whitespace appear in suggestion labels — normalize both
  // sides or an exact brand ("Louis Vuitton") can miss its own suggestion.
  const norm = (s) => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  const w = norm(${JSON.stringify(want)});
  const item = items.find((li) => norm(li.textContent) === w)
    || items.find((li) => norm(li.textContent).includes(w));
  if (!item) return { ok: false, reason: 'no matching suggestion', want: ${JSON.stringify(want)}, available: items.map((li) => (li.textContent || '').trim()).slice(0, 10) };
  item.scrollIntoView({ block: 'center' });
  const r = item.getBoundingClientRect();
  return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (item.textContent || '').trim() };
})()`;

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
 */
async function connect() {
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
  const target = await sellTarget();
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
      if (status === 403) signals.forbidden403.push(url);
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
  async function uploadPhotos(paths, onSlot) {
    const missing = paths.filter((p) => !fs.existsSync(p));
    if (missing.length) return { ok: false, reason: 'files not found', missing };
    const { root } = await client.DOM.getDocument();
    const { nodeIds } = await client.DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector: selectors.photos.fileInputs,
    });
    if (!nodeIds || !nodeIds.length) return { ok: false, reason: 'no photo inputs found — is /sell/new open?' };
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

  // Autocomplete select: real-type the value, real-click the matching
  // suggestion, confirm the input holds the suggestion's canonical text.
  async function fillAutocomplete(sel, value) {
    const want = String(value).replace(/\s+/g, ' ').trim();
    await pressEscape(); // an open menu (e.g. from a failed dropdown) would swallow the typing + click
    // Designer (and any dependent autocomplete) is DISABLED until a category
    // is chosen and Grailed enables it asynchronously after the category
    // click — failing instantly on 'input is disabled' lost real fills
    // (2026-07-04 run: Louis Vuitton reported as not found). Poll up to ~4s.
    let focus = { ok: false, reason: 'input not found' };
    for (let i = 0; i < 8; i++) {
      focus = await evaluate(acFocusExpr(sel, want), `fillAutocomplete(${sel})`);
      if (focus.ok || focus.reason !== 'input is disabled') break;
      await sleep(500);
    }
    if (!focus.ok || focus.alreadySet) return focus;
    await client.Input.insertText({ text: want });
    // Suggestions come from a network lookup, so render latency varies (900ms
    // was enough on 2026-07-03; the designer list took ~2s on 2026-07-04 and
    // the single fixed wait made the fill "fail" while suggestions were still
    // loading). Poll up to ~4s for a matching <li> instead.
    let rect = { ok: false, reason: 'no matching suggestion' };
    for (let i = 0; i < 8; i++) {
      await sleep(500);
      rect = await evaluate(acRectExpr(sel, want), `fillAutocomplete(${sel})`);
      if (rect.ok) break;
    }
    if (!rect.ok) return rect;
    const { x, y } = rect;
    await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
    await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(500);
    const got = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.blur(); return el.value; })()`,
      `fillAutocomplete(${sel})`
    );
    await assertClean(`fillAutocomplete(${sel})`);
    // Case/whitespace-insensitive: the input may canonicalize the suggestion
    // ("LOUIS VUITTON" chip vs clicked "Louis Vuitton") — that's still a fill.
    const norm = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const ok = norm(got) === norm(rect.text) || (!!got && norm(got).includes(norm(want)));
    return { ok, value: got, clicked: rect.text, reason: ok ? undefined : `value after click was "${got}" (clicked "${rect.text}")` };
  }

  return {
    selectors,
    targetUrl: target.url,
    fillText,
    selectDropdown,
    selectNestedCategory,
    uploadPhotos,
    fillAutocomplete,
    signals,
    uploads,
    close: () => client.close().catch(() => {}),
  };
}

/*
 * High-level fill used by the app (IPC `autofill:fill`). Fields are pre-mapped
 * store values; null/absent fields are skipped. Scope: title, description,
 * price, condition, color, style, country of origin, photos — category/size/
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
  const driver = await connect();
  try {
    const sel = driver.selectors;
    const results = {};
    // The plan mirrors the field gates below so the checklist can render all
    // rows (pending) before the first one starts.
    const priceDigits = fields.price != null ? String(fields.price).replace(/[^0-9]/g, '') : '';
    const cascade = !!(fields.department && fields.category);
    const plan = [
      fields.title != null && 'title',
      fields.description != null && 'description',
      priceDigits && 'price',
      fields.condition && 'condition',
      fields.color && 'color',
      fields.style && 'style',
      fields.countryOfOrigin && 'countryOfOrigin',
      cascade && 'category',
      cascade && fields.size && 'size',
      cascade && fields.subcategory && 'subcategory',
      cascade && fields.designer && 'designer',
      fields.photoPaths && fields.photoPaths.length && 'photos',
    ].filter(Boolean);
    notify({ kind: 'plan', fields: plan });
    // Run one field, bracketing it with filling → ok/failed/skipped events.
    const step = async (field, run) => {
      notify({ kind: 'field', field, status: 'filling' });
      const r = await run();
      results[field] = r;
      notify({ kind: 'field', field, status: r.skipped ? 'skipped' : r.ok ? 'ok' : 'failed', reason: r.reason });
      return r;
    };
    if (fields.title != null) await step('title', () => driver.fillText(sel.textFields.title.selector, fields.title));
    if (fields.description != null)
      await step('description', () => driver.fillText(sel.textFields.description.selector, fields.description));
    if (priceDigits) await step('price', () => driver.fillText(sel.textFields.price.selector, priceDigits));
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
    if (fields.photoPaths && fields.photoPaths.length) {
      await step('photos', () =>
        driver.uploadPhotos(fields.photoPaths, (done, total) =>
          notify({ kind: 'field', field: 'photos', status: 'filling', done, total })
        )
      );
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
module.exports = { connect, fillListing, AutofillAbort, getJSON, portUp, sellTarget, PORT };

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
  };
  const action = actions[cmd];
  if (!action) {
    console.log('usage: node ui/autofill-driver.js fill-title ["value"] | dropdown ["Trigger"] ["Option"] | category ["Dept"] ["Category"] | country ["Country"] | upload [paths…]');
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
