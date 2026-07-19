#!/usr/bin/env node
/*
 * Phase 0b — collab-designer + >9-photo probe (2026-07-19).
 *
 * Two open questions from the owner's live testing, answered against the REAL
 * /sell/new form in the separately-launched Chrome (:9222):
 *
 *  A) PHOTOS: Grailed now allows more than 9 photos per listing, but the
 *     selectors file says 9 slots (photo_input_0..8) and the driver hard-caps
 *     there. Question: how does the form expose slots past 9 — do new
 *     photo_input_N inputs render as earlier slots fill? This probe uploads
 *     12 real test photos ONE AT A TIME, re-querying the file inputs after
 *     each, and records how the input set evolves.
 *
 *  B) COLLABS: the 2026-07-18 probe concluded Grailed has no "A x B" designer
 *     entries — but it only tested the autocomplete. The owner reports the
 *     form has an "add a collab" control after a designer is selected (e.g.
 *     Nike → add a collab → Nike x Nocta). This probe selects Nike, scans the
 *     DOM for the collab control, clicks it, types "Nocta" into whatever
 *     appears, and records the suggestions + what a selection produces.
 *
 * Footprint: reuses the app driver's proven primitives (same detection watch,
 * same §8.1 breaker, human-paced waits). Opens a FRESH sell tab; NEVER
 * submits. The draft is left open in Chrome for the owner to inspect and
 * discard. Run once, human-paced:  node phase0Test/phase0b-collab-photos-probe.js
 */

const fs = require('fs');
const path = require('path');
const { connect } = require('../ui/autofill-driver.js');

const PHOTO_DIR = path.join(__dirname, '..', 'grailed-vision-test', 'grailed-vision-test-2');
const PHOTOS = Array.from({ length: 12 }, (_, i) =>
  path.join(PHOTO_DIR, `grailed-vision-test2-${String(i + 1).padStart(2, '0')}.jpg`)
);
const OUT = path.join(__dirname, 'collab-photos-probe.result.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads only: current photo file inputs + any short visible copy mentioning photos.
const photoStateExpr = `(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]')).map((el) => ({
    id: el.id || null, accept: el.getAttribute('accept'), aria: el.getAttribute('aria-label'), multiple: el.multiple,
  }));
  const copy = new Set();
  for (const el of document.querySelectorAll('p, span, h1, h2, h3, label, button, a, div')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t && t.length < 120 && /photo/i.test(t)) copy.add(t);
  }
  return { inputs, copy: Array.from(copy).slice(0, 20) };
})()`;

// Reads only: every element whose OWN text mentions "collab".
const collabScanExpr = `(() => {
  const found = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], span, p, label, div')) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
    const t = own || (el.children.length === 0 ? (el.textContent || '').trim() : '');
    if (!t || !/collab/i.test(t) || t.length > 100) continue;
    const r = el.getBoundingClientRect();
    found.push({
      tag: el.tagName.toLowerCase(), id: el.id || null, role: el.getAttribute('role'),
      cls: el.className ? String(el.className).slice(0, 100) : null, text: t,
      clickableAncestor: (() => { const a = el.closest('button, a, [role="button"]'); return a && a !== el ? { tag: a.tagName.toLowerCase(), id: a.id || null, cls: a.className ? String(a.className).slice(0, 100) : null } : null; })(),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return found;
})()`;

// Reads only: every input that looks designer/collab-related.
const designerInputsExpr = `(() =>
  Array.from(document.querySelectorAll('input')).filter((el) =>
    /designer|collab/i.test([el.id, el.name, el.placeholder, el.getAttribute('aria-label')].join(' '))
  ).map((el) => ({
    id: el.id || null, name: el.name || null, placeholder: el.placeholder || null,
    aria: el.getAttribute('aria-label'), disabled: el.disabled, value: el.value,
  }))
)()`;

// Click a collab control found by collabScanExpr — prefer its clickable
// ancestor. Same synthetic pointer sequence the proven dropdown technique uses.
const clickCollabExpr = `(() => {
  let target = null;
  for (const el of document.querySelectorAll('button, a, [role="button"], span, p, label, div')) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
    const t = own || (el.children.length === 0 ? (el.textContent || '').trim() : '');
    if (t && /collab/i.test(t) && t.length <= 100) { target = el.closest('button, a, [role="button"]') || el; break; }
  }
  if (!target) return { ok: false, reason: 'no collab control found' };
  target.scrollIntoView({ block: 'center' });
  const opts = { bubbles: true, cancelable: true };
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  target.click();
  return { ok: true, clicked: { tag: target.tagName.toLowerCase(), id: target.id || null, text: (target.textContent || '').trim().slice(0, 80) } };
})()`;

// Focus + native-setter-clear an input by selector (acFocusExpr technique).
const focusExpr = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'input not found' };
  if (el.disabled) return { ok: false, reason: 'input is disabled' };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  return { ok: true, focused: document.activeElement === el };
})()`;

// Suggestion <li>s in the input's container (same container walk as acRectExpr).
const suggestionsExpr = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'input not found' };
  const container = el.closest('div.section') || el.parentElement;
  const items = Array.from(container.querySelectorAll('li'));
  return { ok: true, texts: items.map((li) => (li.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim()).slice(0, 15) };
})()`;

const suggestionRectExpr = (sel, want) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return { ok: false, reason: 'input not found' };
  const container = el.closest('div.section') || el.parentElement;
  const norm = (s) => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
  const w = norm(${JSON.stringify(want)});
  const items = Array.from(container.querySelectorAll('li'));
  const item = items.find((li) => norm(li.textContent) === w) || items.find((li) => norm(li.textContent).includes(w));
  if (!item) return { ok: false, reason: 'no matching suggestion', texts: items.map((li) => (li.textContent || '').trim()).slice(0, 10) };
  item.scrollIntoView({ block: 'center' });
  const r = item.getBoundingClientRect();
  return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (item.textContent || '').trim() };
})()`;

// What the designer area shows AFTER a collab commit — chips/labels/values.
const designerStateExpr = `(() => {
  const inputs = Array.from(document.querySelectorAll('input')).filter((el) =>
    /designer|collab/i.test([el.id, el.name, el.placeholder, el.getAttribute('aria-label')].join(' '))
  ).map((el) => ({ id: el.id || null, value: el.value }));
  const anchor = document.querySelector('#designer-autocomplete') || document.querySelector('input[id*="designer" i]');
  const section = anchor ? (anchor.closest('div.section') || anchor.parentElement.parentElement) : null;
  const sectionText = section ? (section.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400) : null;
  return { inputs, sectionText };
})()`;

(async () => {
  for (const p of PHOTOS) {
    if (!fs.existsSync(p)) { console.error('missing test photo:', p); process.exit(1); }
  }

  const report = { at: new Date().toISOString(), photos: {}, collab: {} };
  console.log('connecting (fresh /sell/new tab)…');
  const d = await connect({ freshTab: true });
  const { client, evaluate, assertClean } = d;

  try {
    /* ---------- A) photos past 9 ---------- */
    const empty = await d.countEmptyPhotoSlots();
    console.log('initial empty photo slots:', JSON.stringify(empty));
    if (empty.filled > 0) throw new Error('fresh tab restored a draft with photos — close Grailed drafts and rerun');

    report.photos.initial = await evaluate(photoStateExpr, 'photoState(initial)');
    report.photos.steps = [];

    for (let i = 0; i < PHOTOS.length; i++) {
      const { root } = await client.DOM.getDocument();
      const { nodeIds } = await client.DOM.querySelectorAll({ nodeId: root.nodeId, selector: 'input[type="file"]' });
      if (!nodeIds || !nodeIds.length) {
        report.photos.steps.push({ upload: i + 1, note: 'NO file inputs remain — form stopped offering slots', leftover: PHOTOS.length - i });
        console.log(`upload ${i + 1}: no file inputs remain (${PHOTOS.length - i} photos left over)`);
        break;
      }
      await client.DOM.setFileInputFiles({ nodeId: nodeIds[0], files: [PHOTOS[i]] });
      await sleep(2500); // human-paced — let the POST + preview land
      await assertClean(`probe upload ${i + 1}`);
      const state = await evaluate(photoStateExpr, `photoState(${i + 1})`);
      report.photos.steps.push({ upload: i + 1, inputs: state.inputs.map((x) => x.id), copy: state.copy });
      console.log(`upload ${i + 1}/${PHOTOS.length}: ${state.inputs.length} file input(s) now — ids: ${state.inputs.map((x) => x.id).join(', ') || '(none)'}`);
    }
    report.photos.uploadsObserved = d.uploads.length;

    /* ---------- B) collab designer ---------- */
    console.log('\nselecting category (Menswear / Outerwear)…');
    report.collab.category = await d.selectNestedCategory('Menswear', 'Outerwear');
    console.log('category:', JSON.stringify(report.collab.category));

    console.log('selecting designer Nike…');
    report.collab.designer = await d.fillAutocomplete('#designer-autocomplete', 'Nike');
    console.log('designer:', JSON.stringify(report.collab.designer));

    await sleep(800);
    report.collab.scanAfterDesigner = await evaluate(collabScanExpr, 'collabScan');
    report.collab.inputsAfterDesigner = await evaluate(designerInputsExpr, 'designerInputs');
    console.log('collab controls found:', JSON.stringify(report.collab.scanAfterDesigner, null, 2));

    if (report.collab.scanAfterDesigner.length) {
      report.collab.click = await evaluate(clickCollabExpr, 'clickCollab');
      console.log('clicked:', JSON.stringify(report.collab.click));
      await sleep(1000);
      await assertClean('collab control click');

      report.collab.inputsAfterClick = await evaluate(designerInputsExpr, 'designerInputs(afterClick)');
      report.collab.scanAfterClick = await evaluate(collabScanExpr, 'collabScan(afterClick)');
      console.log('designer-ish inputs after click:', JSON.stringify(report.collab.inputsAfterClick, null, 2));

      // A new input (not the primary #designer-autocomplete) = the collab field.
      const second = (report.collab.inputsAfterClick || []).find((x) => x.id !== 'designer-autocomplete');
      if (second && second.id) {
        const sel = `#${second.id}`;
        const focus = await evaluate(focusExpr(sel), 'focus(collab)');
        console.log('focus collab input:', JSON.stringify(focus));
        if (focus.ok) {
          await client.Input.insertText({ text: 'Nocta' });
          // settle-poll the suggestion list like fillAutocomplete does
          let sug = null;
          for (let i = 0; i < 8; i++) {
            await sleep(500);
            sug = await evaluate(suggestionsExpr(sel), 'suggestions(collab)');
            if (sug.ok && sug.texts.length) break;
          }
          report.collab.noctaSuggestions = sug;
          console.log('Nocta suggestions:', JSON.stringify(sug));

          const rect = await evaluate(suggestionRectExpr(sel, 'Nocta'), 'suggestionRect(collab)');
          report.collab.noctaRect = rect;
          if (rect.ok) {
            await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: rect.x, y: rect.y });
            await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
            await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
            await sleep(1000);
            await assertClean('collab suggestion click');
            report.collab.afterCommit = await evaluate(designerStateExpr, 'designerState(final)');
            console.log('designer state after commit:', JSON.stringify(report.collab.afterCommit, null, 2));
          }
        }
      } else {
        report.collab.note = 'no second designer-ish input appeared after the click — see scanAfterClick for what changed';
      }
    } else {
      report.collab.note = 'no element mentioning "collab" found after designer selection';
    }

    report.signals = d.signals;
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nreport written:', OUT);
    console.log('NOTE: the probe draft tab is left open in Chrome — inspect, then discard the draft.');
    await d.close();
  }
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
