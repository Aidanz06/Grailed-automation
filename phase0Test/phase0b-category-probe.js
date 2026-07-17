#!/usr/bin/env node
/*
 * A1 investigation (category/size/designer automation) — how does the NESTED
 * "Department / Category" picker drill from department (Menswear/Womenswear)
 * into categories? This is the one unknown the flat-dropdown work
 * (phase0b-dropdown-probe.js) didn't cover. READ-ONLY-FIRST: opens the picker,
 * dumps the top-level structure, then tries to reveal the second level by HOVER
 * (non-committal) and, only if hover does nothing, by click — dumping what
 * appears each time. Does NOT commit a category selection; nothing is submitted.
 *
 * Footprint = the proven-clean Runtime.evaluate + Input path (same as the
 * dropdown/country probes): Network for observation only. §8.5 silent-detection
 * caveat applies — run ONCE, human-paced, watch signals.
 *
 * Prereq: `npm run 0b:launch`, logged in, on /sell/new.
 *   node phase0b-category-probe.js ["Department"]   (default: "Menswear")
 */

const CDP = require('chrome-remote-interface');
const http = require('http');

const PORT = 9222;
const DEPARTMENT = process.argv[2] || 'Menswear';
// Opt-in: if a category is given, COMMIT it (click the leaf) to observe the
// cascade — does it enable size/subcategory/designer, or drill to a 3rd level?
// This changes the draft's category in the form (reversible; not server-saved
// until the user Saves/Publishes — same as every other fill). Omit for a pure
// read-only structural run.
const CATEGORY = process.argv[3] || null;
const TRIGGER_TEXT = 'Department / Category';
const CHALLENGE = /perimeterx|px-cloud|px-cdn|pxchk|captcha|recaptcha|hcaptcha|challenges\.cloudflare|human(security)?/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Open the category trigger by visible text (Radix opens on pointerdown, not click).
const openExpr = (text) => `(() => {
  const t = ${JSON.stringify(text)}.toLowerCase();
  const btns = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"]'));
  const trig = btns.find((b) => ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase().includes(t));
  if (!trig) return { ok: false, reason: 'trigger not found', text: ${JSON.stringify(text)} };
  const r = trig.getBoundingClientRect();
  const info = { text: (trig.textContent || '').trim().slice(0, 60), id: trig.id || null, ariaExpandedBefore: trig.getAttribute('aria-expanded'), ariaHasPopup: trig.getAttribute('aria-haspopup'), rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, view: window };
  try { trig.dispatchEvent(new PointerEvent('pointerdown', o)); trig.dispatchEvent(new PointerEvent('pointerup', o)); trig.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
  return { ok: true, trigger: info };
})()`;

// Dump every open menu/listbox and its items with the attributes that reveal
// nesting: aria-haspopup (has a submenu), aria-expanded/data-state (open?),
// role. Multiple containers = the submenu opened as a separate panel.
const dumpExpr = () => `(() => {
  const containers = Array.from(document.querySelectorAll('[role="menu"],[role="listbox"]'));
  const itemRoles = '[role="menuitem"],[role="menuitemradio"],[role="option"]';
  const desc = (el) => ({
    text: (el.textContent || '').trim().slice(0, 40),
    role: el.getAttribute('role'),
    ariaHasPopup: el.getAttribute('aria-haspopup'),
    ariaExpanded: el.getAttribute('aria-expanded'),
    dataState: el.getAttribute('data-state'),
  });
  return {
    containerCount: containers.length,
    containers: containers.map((c, i) => {
      const r = c.getBoundingClientRect();
      const items = Array.from(c.querySelectorAll(itemRoles));
      return {
        index: i,
        role: c.getAttribute('role'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        itemCount: items.length,
        items: items.slice(0, 40).map(desc),
      };
    }),
  };
})()`;

// Drill into a department by CLICKING it (hover revealed no submenu — the
// picker replaces the menu contents in place). Uses the proven synthetic
// pointerdown+pointerup+click (works regardless of viewport position, unlike a
// real CDP mouse click — the field sits above the fold here). Navigating to
// the category list does NOT commit a final category; a leaf pick does that.
const drillExpr = (dept) => `(() => {
  const d = ${JSON.stringify(dept.toLowerCase())};
  const items = Array.from(document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"]'));
  const item = items.find((el) => (el.textContent || '').trim().toLowerCase() === d)
    || items.find((el) => (el.textContent || '').trim().toLowerCase().includes(d));
  if (!item) return { ok: false, reason: 'department item not found', want: ${JSON.stringify(dept)}, available: items.map((el) => (el.textContent || '').trim()).slice(0, 20) };
  const o = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, view: window };
  try { item.dispatchEvent(new PointerEvent('pointerdown', o)); item.dispatchEvent(new PointerEvent('pointerup', o)); item.dispatchEvent(new MouseEvent('click', o)); } catch (e) {}
  return { ok: true, clicked: (item.textContent || '').trim() };
})()`;

// Whether the dependent fields have become enabled (the cascade signal).
const dependentStateExpr = () => `(() => {
  const q = (sel) => { const el = document.querySelector(sel); return el ? { present: true, disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' } : { present: false }; };
  const byText = (t) => { const b = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"]')).find((x) => (x.textContent || '').toLowerCase().includes(t)); return b ? { present: true, text: (b.textContent||'').trim().slice(0,30), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' } : { present: false }; };
  return { designer: q('#designer-autocomplete'), size: byText('select size'), subcategory: byText('sub-category') };
})()`;

async function main() {
  if (!(await portUp())) { console.error('❌ No CDP endpoint on :' + PORT + '. Run `npm run 0b:launch` first.'); process.exit(1); }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No grailed page target. Open /sell/new.'); process.exit(1); }

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  const sig = { forbidden403: [], challengeHosts: [] };
  const ev = async (expr) => (await client.Runtime.evaluate({ expression: expr, returnByValue: true })).result.value;
  try {
    await client.Network.enable();
    client.Network.responseReceived((p) => {
      if (p.response.status === 403) sig.forbidden403.push(p.response.url);
      if (CHALLENGE.test(p.response.url)) sig.challengeHosts.push(p.response.url);
    });

    console.log('== A1 PROBE: nested category picker "' + TRIGGER_TEXT + '" ==\n');
    // Reset to a known-closed state: a lingering open menu from a prior run
    // would make the trigger click TOGGLE it shut. Esc closes any open Radix menu.
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);

    console.log('>>> dependent fields BEFORE opening (baseline) …');
    console.log(JSON.stringify(await ev(dependentStateExpr()), null, 2));

    console.log('\n>>> open the category trigger …');
    const open = await ev(openExpr(TRIGGER_TEXT));
    console.log(JSON.stringify(open, null, 2));
    if (!open.ok) { console.log('\n⚠️  Trigger not found — is /sell/new open? Exact text expected: "Department / Category".'); return; }

    await sleep(600);
    console.log('\n>>> level 1: dump open menu(s) …');
    let dump = await ev(dumpExpr());
    // Fallback: real CDP mouse click if pointer events didn't open it.
    if (dump.containerCount === 0) {
      const r = open.trigger.rect, x = Math.round(r.x + r.w / 2), y = Math.round(r.y + r.h / 2);
      console.log(`   (pointer open showed nothing — CDP mouse click at ${x},${y})`);
      await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
      await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(600);
      dump = await ev(dumpExpr());
    }
    console.log(JSON.stringify(dump, null, 2));

    if (dump.containerCount > 0) {
      console.log(`\n>>> level 2: click department "${DEPARTMENT}" to drill into categories …`);
      const drill = await ev(drillExpr(DEPARTMENT));
      console.log(JSON.stringify(drill, null, 2));
      if (drill.ok) {
        await sleep(700);
        const after = await ev(dumpExpr());
        console.log('\n>>> menu after drilling (categories should now appear, department items gone):');
        console.log(JSON.stringify(after, null, 2));
        console.log('\n>>> dependent fields after drilling (still disabled = no leaf committed yet):');
        console.log(JSON.stringify(await ev(dependentStateExpr()), null, 2));

        // Opt-in leaf commit: click the category and observe the cascade.
        if (CATEGORY) {
          console.log(`\n>>> level 3: click category "${CATEGORY}" (COMMITS a selection) …`);
          const leaf = await ev(drillExpr(CATEGORY)); // same synthetic-click technique
          console.log(JSON.stringify(leaf, null, 2));
          if (leaf.ok) {
            await sleep(900);
            const menus = await ev(dumpExpr());
            console.log(`\n>>> menus after category click — ${menus.containerCount === 0 ? 'CLOSED (leaf committed)' : 'still open (drilled to a 3rd level?)'}:`);
            console.log(JSON.stringify(menus, null, 2));
            console.log('\n>>> trigger label now (should read the chosen department/category):');
            console.log(JSON.stringify(await ev(`(() => { const el = document.getElementById(${JSON.stringify(open.trigger.id)}); return { triggerText: el ? (el.textContent||'').trim().slice(0,80) : null }; })()`), null, 2));
            console.log('\n>>> dependent fields after commit (ENABLED = cascade fired):');
            console.log(JSON.stringify(await ev(dependentStateExpr()), null, 2));
          }
        }
      }
    }

    await sleep(1500);
    console.log('\ndetection signals:', JSON.stringify(sig));
    if (sig.forbidden403.length || sig.challengeHosts.length) {
      console.log('\n🚩 a 403/challenge appeared — STOP and reassess (§8.1).');
    } else if (dump.containerCount > 0) {
      console.log('\n✅ picker opened, structure dumped, no detection reaction (silent-detection caveat §8.5 applies).');
      if (CATEGORY) console.log(`   NOTE: "${DEPARTMENT} / ${CATEGORY}" was COMMITTED to the draft (form only; reload restores Grailed's saved draft).`);
      else console.log('   Nothing was selected. Press Esc in Chrome to close the menu.');
    } else {
      console.log('\n⚠️  Menu did not open / no containers read — paste this output so the technique can be designed.');
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error('category-probe error:', e && e.message ? e.message : e); process.exit(1); });
