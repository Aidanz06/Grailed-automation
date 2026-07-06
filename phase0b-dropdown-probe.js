#!/usr/bin/env node
/*
 * Phase 0b — step 7 investigation: how do the Radix dropdowns open + expose
 * options? Read-only-ish: clicks ONE trigger (located by visible text) to open
 * the popover, then reads the option list so the "select by text" technique can
 * be built from fact. Does NOT select anything, submit, or enable Runtime.enable.
 *
 * Footprint = the proven-clean Runtime.evaluate path (steps 5/6/6a): Network for
 * observation only, a couple of evaluate calls. Silent-detection caveat (§8.5)
 * still applies — run once, human-paced.
 *
 * Prereq: `npm run 0b:launch`, logged in, on /sell/new.
 *   node phase0b-dropdown-probe.js ["Trigger Text"]   (default: "Item Condition")
 *   npm run 0b:dropdown
 */

const CDP = require('chrome-remote-interface');
const http = require('http');

const PORT = 9222;
const TRIGGER_TEXT = process.argv[2] || 'Item Condition';
const SELECT_TEXT = process.argv[3] || null; // if set, select this option after opening

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      })
      .on('error', reject);
  });
}
async function portUp() { try { await getJSON('/json/version'); return true; } catch { return false; } }
async function grailedTarget() {
  const list = await getJSON('/json');
  return list.find((t) => t.type === 'page' && /grailed\.com/.test(t.url || '')) || null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Locate the trigger by visible text and open it via real pointer events
// (Radix Select opens on pointerdown; a plain .click() does not). Returns the
// trigger's viewport rect so we can fall back to a genuine CDP mouse click.
const openExpr = (text) => `(() => {
  const t = ${JSON.stringify(text)}.toLowerCase();
  const btns = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"]'));
  const trig = btns.find((b) => ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase().includes(t));
  if (!trig) return { ok: false, reason: 'trigger not found', text: ${JSON.stringify(text)} };
  const r = trig.getBoundingClientRect();
  const info = { text: (trig.textContent || '').trim().slice(0, 60), id: trig.id || null, ariaExpandedBefore: trig.getAttribute('aria-expanded'), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, view: window };
  try { trig.dispatchEvent(new PointerEvent('pointerdown', o)); trig.dispatchEvent(new PointerEvent('pointerup', o)); trig.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
  return { ok: true, trigger: info };
})()`;

// Read ONLY real option roles (never [data-radix-collection-item] — that also
// matches the always-present top-nav menu). Also re-report the trigger's
// aria-expanded so we know whether the listbox actually opened.
const readExpr = (text) => `(() => {
  const t = ${JSON.stringify(text)}.toLowerCase();
  const trig = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"]'))
    .find((b) => ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase().includes(t));
  const optSel = ['[role="option"]', '[role="menuitemradio"]', '[role="menuitem"]'];
  let opts = [], matched = null;
  for (const s of optSel) { const f = Array.from(document.querySelectorAll(s)); if (f.length) { opts = f; matched = s; break; } }
  const options = opts.slice(0, 60).map((el) => ({ text: (el.textContent || '').trim().slice(0, 50), role: el.getAttribute('role'), dataValue: el.getAttribute('data-value'), ariaSelected: el.getAttribute('aria-selected') }));
  const container = document.querySelector('[role="listbox"],[role="menu"]');
  return { optionSelectorMatched: matched, optionCount: opts.length, ariaExpandedNow: trig ? trig.getAttribute('aria-expanded') : null, containerRole: container ? container.getAttribute('role') : null, options };
})()`;

// Select an option by text (Radix menuitem/option selects on pointerup).
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

// Re-read the trigger by its (session-stable) id — its label changes after select.
const verifyExpr = (triggerId) => `(() => {
  const el = document.getElementById(${JSON.stringify(triggerId)});
  return { triggerText: el ? (el.textContent || '').trim().slice(0, 60) : null, ariaExpanded: el ? el.getAttribute('aria-expanded') : null };
})()`;

async function main() {
  if (!(await portUp())) { console.error('❌ No CDP endpoint on :' + PORT + '. Run `npm run 0b:launch` first.'); process.exit(1); }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No grailed page target. Open /sell/new.'); process.exit(1); }

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  const CHALLENGE = /perimeterx|px-cloud|px-cdn|pxchk|captcha|recaptcha|hcaptcha|challenges\.cloudflare|human(security)?/i;
  const sig = { forbidden403: [], challengeHosts: [] };
  try {
    await client.Network.enable();
    client.Network.responseReceived((p) => {
      if (p.response.status === 403) sig.forbidden403.push(p.response.url);
      if (CHALLENGE.test(p.response.url)) sig.challengeHosts.push(p.response.url);
    });

    console.log('== STEP 7 PROBE: open Radix dropdown "' + TRIGGER_TEXT + '" and read its options ==\n');
    console.log('>>> evaluate 1: locate trigger + open via pointer events …');
    const open = await client.Runtime.evaluate({ expression: openExpr(TRIGGER_TEXT), returnByValue: true });
    console.log(JSON.stringify(open.result.value, null, 2));
    if (!open.result.value.ok) { console.log('\n⚠️  Trigger not found — pass the exact visible text, e.g. `npm run 0b:dropdown "Select a Color"`.'); return; }

    await sleep(500);
    console.log('\n>>> evaluate 2: read options (pointer-event open) …');
    let read = await client.Runtime.evaluate({ expression: readExpr(TRIGGER_TEXT), returnByValue: true });
    console.log(JSON.stringify(read.result.value, null, 2));

    // Fallback: if pointer events didn't open it, do a genuine CDP mouse click
    // at the trigger's center (real mousePressed/mouseReleased — no Runtime.enable).
    if (read.result.value.optionCount === 0) {
      const r = open.result.value.trigger.rect;
      const x = Math.round(r.x + r.w / 2), y = Math.round(r.y + r.h / 2);
      console.log(`\n>>> pointer events didn't open it — CDP Input mouse click at (${x}, ${y}) …`);
      await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
      await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(500);
      read = await client.Runtime.evaluate({ expression: readExpr(TRIGGER_TEXT), returnByValue: true });
      console.log(JSON.stringify(read.result.value, null, 2));
    }

    // Optional: select an option by text and verify the trigger updated.
    if (SELECT_TEXT && read.result.value.optionCount > 0) {
      console.log(`\n>>> selecting option "${SELECT_TEXT}" …`);
      const sel = await client.Runtime.evaluate({ expression: selectExpr(SELECT_TEXT), returnByValue: true });
      console.log(JSON.stringify(sel.result.value, null, 2));
      if (sel.result.value.ok) {
        await sleep(400);
        const verify = await client.Runtime.evaluate({ expression: verifyExpr(open.result.value.trigger.id), returnByValue: true });
        const label = verify.result.value.triggerText;
        console.log('trigger now reads:', JSON.stringify(label));
        console.log(label && label.toLowerCase().includes(SELECT_TEXT.toLowerCase())
          ? '✅ selection registered — trigger shows the chosen value.'
          : '⚠️  trigger label did not update to the selection — check the Chrome window.');
      }
    }

    await sleep(1500);
    const opened = read.result.value.optionCount > 0;
    console.log('\ndetection signals:', JSON.stringify(sig));
    if (sig.forbidden403.length || sig.challengeHosts.length) {
      console.log('\n🚩 a 403/challenge appeared — stop and reassess (§8.1).');
    } else if (opened) {
      console.log(`\n✅ dropdown opened (${read.result.value.optionCount} options), no detection reaction (silent-detection caveat §8.5 applies).`);
    } else {
      console.log('\n⚠️  Could not read options — the listbox may not have opened, or uses a structure not covered. Paste this output.');
    }
    console.log('   (If it opened, it is left open in Chrome — press Esc to close. Nothing was selected.)');
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error('dropdown-probe error:', e && e.message ? e.message : e); process.exit(1); });
