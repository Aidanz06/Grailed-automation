#!/usr/bin/env node
/*
 * Phase 0b — follow-up probe (2026-07-19), building on collab-photos-probe:
 *
 *  B) COLLAB PICKER: probe 1 clicked "Add A Collaboration" and the button
 *     became a "Select an approved collaboration" control. On the SAME open
 *     draft tab (Nike selected): dump that control's structure, open it, dump
 *     its options, and if a Nocta collab is offered, select it and record what
 *     the designer section then shows.
 *
 *  C) MULTI-FILE UPLOAD: probe 1 proved the form never renders an input past
 *     photo_input_8 — but every photo input is `multiple`. On a FRESH tab:
 *     hand ALL 12 test photos to photo_input_0 in one DOM.setFileInputFiles
 *     and record how many actually land (grid size, remaining inputs, POSTs).
 *
 * Same footprint as probe 1 (driver primitives, detection watch, §8.1
 * breaker). NEVER submits; both draft tabs stay open for the owner to discard.
 *   node phase0Test/phase0b-collab-photos-probe2.js
 */

const fs = require('fs');
const path = require('path');
const { connect } = require('../ui/autofill-driver.js');

const PHOTO_DIR = path.join(__dirname, '..', 'grailed-vision-test', 'grailed-vision-test-2');
const PHOTOS = Array.from({ length: 12 }, (_, i) =>
  path.join(PHOTO_DIR, `grailed-vision-test2-${String(i + 1).padStart(2, '0')}.jpg`)
);
const OUT = path.join(__dirname, 'collab-photos-probe2.result.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The collab control's own structure + 5 ancestors (tag/id/class/role only).
const collabStructureExpr = `(() => {
  const el = Array.from(document.querySelectorAll('span, div, button, p')).find((n) =>
    n.children.length === 0 && /select an approved collaboration/i.test((n.textContent || '').trim()));
  if (!el) return { ok: false, reason: 'control not found' };
  const desc = (n) => ({ tag: n.tagName.toLowerCase(), id: n.id || null, role: n.getAttribute('role'),
    cls: n.className ? String(n.className).slice(0, 120) : null,
    ariaHaspopup: n.getAttribute('aria-haspopup'), ariaExpanded: n.getAttribute('aria-expanded') });
  const chain = [];
  let cur = el;
  for (let i = 0; i < 6 && cur && cur !== document.body; i++) { chain.push(desc(cur)); cur = cur.parentElement; }
  return { ok: true, chain };
})()`;

// Open the collab picker: synthetic pointerdown+pointerup+click on the nearest
// clickable ancestor of the "Select an approved collaboration" text (the
// proven Radix-open sequence).
const openCollabPickerExpr = `(() => {
  const leaf = Array.from(document.querySelectorAll('span, div, button, p')).find((n) =>
    n.children.length === 0 && /select an approved collaboration/i.test((n.textContent || '').trim()));
  if (!leaf) return { ok: false, reason: 'control not found' };
  const target = leaf.closest('button, [role="button"], [role="combobox"], a') || leaf.parentElement;
  target.scrollIntoView({ block: 'center' });
  const opts = { bubbles: true, cancelable: true };
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  target.click();
  return { ok: true, clicked: { tag: target.tagName.toLowerCase(), id: target.id || null,
    cls: target.className ? String(target.className).slice(0, 120) : null } };
})()`;

// Anything option-like that appeared: menuitems, options, listbox items, lis.
const pickerOptionsExpr = `(() => {
  const sels = ['[role="menu"] [role="menuitem"]', '[role="listbox"] [role="option"]', '[role="option"]', 'ul li'];
  for (const s of sels) {
    const items = Array.from(document.querySelectorAll(s))
      .filter((n) => n.offsetParent !== null)
      .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t && t.length < 80);
    if (items.length) return { via: s, items: items.slice(0, 40) };
  }
  // fallback: a native <select>?
  const sel = Array.from(document.querySelectorAll('select')).map((s) => ({
    id: s.id || null, name: s.name || null,
    options: Array.from(s.options).map((o) => o.textContent.trim()).slice(0, 40) }));
  return { via: 'select-scan', selects: sel };
})()`;

// Click an option whose text matches want (substring, case-insensitive).
const clickOptionExpr = (want) => `(() => {
  const w = ${JSON.stringify(want)}.toLowerCase();
  const cands = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], ul li'))
    .filter((n) => n.offsetParent !== null && (n.textContent || '').toLowerCase().includes(w));
  if (!cands.length) return { ok: false, reason: 'no matching option' };
  const el = cands[0];
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.textContent || '').trim() };
})()`;

const designerStateExpr = `(() => {
  const anchor = document.querySelector('#designer-autocomplete') || document.querySelector('input[id*="designer" i]');
  const section = anchor ? (anchor.closest('div.section') || anchor.parentElement.parentElement) : null;
  return {
    inputValue: anchor ? anchor.value : null,
    sectionText: section ? (section.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500) : null,
  };
})()`;

// Photo grid census — inputs left + preview tiles (imgs / background-images
// inside the section that contains (or contained) the photo inputs).
const photoCensusExpr = `(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]')).map((el) => el.id || '(no id)');
  const heads = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend, label, span'))
    .filter((n) => (n.textContent || '').trim() === 'Photos');
  let section = heads.length ? (heads[0].closest('div.section') || heads[0].parentElement) : null;
  for (let i = 0; section && i < 3 && !section.querySelector('img') && !section.querySelector('input[type="file"]'); i++) section = section.parentElement;
  const imgs = section ? section.querySelectorAll('img').length : null;
  const bg = section ? Array.from(section.querySelectorAll('div'))
    .filter((d) => (d.style && d.style.backgroundImage) || /photo|thumb|preview/i.test(String(d.className))).length : null;
  return { inputs, imgsInPhotoSection: imgs, bgLikeDivs: bg };
})()`;

(async () => {
  const report = { at: new Date().toISOString(), collab: {}, multiUpload: {} };

  /* ---------- B) collab picker on the existing draft tab ---------- */
  console.log('connecting to the existing draft tab…');
  const d1 = await connect({ freshTab: false });
  try {
    report.collab.structure = await d1.evaluate(collabStructureExpr, 'collabStructure');
    console.log('structure:', JSON.stringify(report.collab.structure, null, 1));

    await d1.pressEscape();
    report.collab.open = await d1.evaluate(openCollabPickerExpr, 'openCollabPicker');
    console.log('open:', JSON.stringify(report.collab.open));
    await sleep(800);
    report.collab.options = await d1.evaluate(pickerOptionsExpr, 'pickerOptions');
    console.log('options:', JSON.stringify(report.collab.options, null, 1));
    await d1.assertClean('collab picker open');

    const items = report.collab.options.items || [];
    const noctaOffered = items.some((t) => /nocta/i.test(t));
    if (noctaOffered) {
      const rect = await d1.evaluate(clickOptionExpr('Nocta'), 'clickOption(Nocta)');
      report.collab.noctaRect = rect;
      if (rect.ok) {
        await d1.client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: rect.x, y: rect.y });
        await d1.client.Input.dispatchMouseEvent({ type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
        await d1.client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
        await sleep(1200);
        await d1.assertClean('collab option click');
        report.collab.afterCommit = await d1.evaluate(designerStateExpr, 'designerState');
        console.log('after commit:', JSON.stringify(report.collab.afterCommit, null, 1));
      }
    } else if (items.length) {
      // Options exist but no Nocta — record and select nothing.
      report.collab.note = 'picker opened but no Nocta option — see options.items';
      await d1.pressEscape();
    }
    report.collab.signals = d1.signals;
  } finally {
    await d1.close();
  }

  /* ---------- C) multi-file upload on a fresh tab ---------- */
  console.log('\nopening a second fresh tab for the multi-file test…');
  const d2 = await connect({ freshTab: true });
  try {
    const empty = await d2.countEmptyPhotoSlots();
    if (empty.filled > 0) throw new Error('fresh tab restored a draft with photos — discard drafts and rerun');
    const { root } = await d2.client.DOM.getDocument();
    const { nodeIds } = await d2.client.DOM.querySelectorAll({ nodeId: root.nodeId, selector: '#photo_input_0' });
    if (!nodeIds || !nodeIds.length) throw new Error('photo_input_0 not found');
    console.log(`handing all ${PHOTOS.length} files to photo_input_0 at once…`);
    await d2.client.DOM.setFileInputFiles({ nodeId: nodeIds[0], files: PHOTOS });
    // 12 parallel-ish uploads — give it a generous settle, then census twice.
    await sleep(8000);
    report.multiUpload.census1 = await d2.evaluate(photoCensusExpr, 'photoCensus(1)');
    console.log('census after 8s:', JSON.stringify(report.multiUpload.census1));
    await sleep(7000);
    await d2.assertClean('multi-file upload');
    report.multiUpload.census2 = await d2.evaluate(photoCensusExpr, 'photoCensus(2)');
    report.multiUpload.uploadPosts = d2.uploads.length;
    console.log('census after 15s:', JSON.stringify(report.multiUpload.census2));
    console.log('media-host POSTs observed:', d2.uploads.length);
    report.multiUpload.signals = d2.signals;
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('\nreport written:', OUT);
    console.log('NOTE: two probe draft tabs are open in Chrome — inspect, then discard both drafts.');
    await d2.close();
  }
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
