#!/usr/bin/env node
/*
 * Phase 0b — verification pass (2026-07-19) on the two draft tabs left open by
 * probes 1-2:
 *
 *  B') COLLAB COMMIT: probe 2 opened the approved-collab menu but its option
 *      dump was sliced at 40 (alphabetically before "Nocta") so nothing was
 *      selected. Here: reopen the picker, scan ALL menuitems for Nocta, click
 *      "Nike x Nocta", and record what the designer section commits to.
 *
 *  C') MULTI-FILE RESULT: probe 2 handed 12 files to photo_input_0 (12 media
 *      POSTs observed) but its grid census found nothing. Here: a robust
 *      census — all imgs, any "photo"/limit copy, any error/toast text — to
 *      answer whether the form KEPT more than 9.
 *
 * Never submits; drafts stay open for the owner to discard.
 *   node phase0Test/phase0b-collab-photos-probe3.js
 */

const fs = require('fs');
const CDP = require('chrome-remote-interface');
const http = require('http');
const { connect } = require('../ui/autofill-driver.js');

const OUT = require('path').join(__dirname, 'collab-photos-probe3.result.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function activate(id) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: 9222, path: `/json/activate/${id}` }, (res) => { res.resume(); res.on('end', resolve); }).on('error', resolve);
  });
}

const whichTabExpr = `(() => ({
  designer: (document.querySelector('#designer-autocomplete') || {}).value || null,
  fileInputs: document.querySelectorAll('input[type="file"]').length,
  imgs: document.querySelectorAll('img').length,
}))()`;

const photoCensusExpr = `(() => {
  const imgs = Array.from(document.querySelectorAll('img'));
  const media = imgs.filter((i) => /media|assets|blob:|amazonaws|cloudfront|imgix/i.test(i.src || ''));
  const copy = new Set();
  for (const el of document.querySelectorAll('p, span, h2, h3, label, div, li')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (t && t.length < 140 && /photo|maximum|limit|upload/i.test(t)) copy.add(t);
  }
  return {
    fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map((el) => el.id || '(no id)'),
    totalImgs: imgs.length,
    mediaImgs: media.length,
    mediaSrcSample: media.slice(0, 3).map((i) => (i.src || '').slice(0, 90)),
    copy: Array.from(copy).slice(0, 25),
  };
})()`;

const openCollabPickerExpr = `(() => {
  const leaf = Array.from(document.querySelectorAll('span, div, button, p')).find((n) =>
    n.children.length === 0 && /select an approved collaboration/i.test((n.textContent || '').trim()));
  if (!leaf) return { ok: false, reason: 'control not found' };
  const target = leaf.closest('[role="menu"] > *') || leaf.parentElement;
  target.scrollIntoView({ block: 'center' });
  const opts = { bubbles: true, cancelable: true };
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  target.click();
  return { ok: true };
})()`;

const noctaExpr = `(() => {
  const items = Array.from(document.querySelectorAll('[role="menuitem"]')).filter((n) => n.offsetParent !== null);
  const texts = items.map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim());
  const nocta = texts.filter((t) => /nocta/i.test(t));
  const el = items.find((n) => /nike x nocta/i.test((n.textContent || '')));
  if (!el) return { ok: false, totalItems: items.length, noctaMatches: nocta };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { ok: true, totalItems: items.length, noctaMatches: nocta,
    x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (el.textContent || '').trim() };
})()`;

const designerStateExpr = `(() => {
  const anchor = document.querySelector('#designer-autocomplete');
  const container = anchor ? anchor.closest('div[class*="DesignersAndCollabs"], div.section') || anchor.parentElement.parentElement : null;
  const collabScan = Array.from(document.querySelectorAll('span, div, button, p'))
    .filter((n) => n.children.length === 0 && /collab/i.test((n.textContent || '')))
    .map((n) => ({ tag: n.tagName.toLowerCase(), text: (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90) }));
  return {
    inputValue: anchor ? anchor.value : null,
    containerText: container ? (container.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500) : null,
    collabScan: collabScan.slice(0, 10),
  };
})()`;

(async () => {
  const report = { at: new Date().toISOString() };
  const list = await getJSON('/json');
  const sellTabs = list.filter((t) => t.type === 'page' && /grailed\.com\/sell\/new/.test(t.url || ''));
  console.log(`sell tabs open: ${sellTabs.length}`);
  if (!sellTabs.length) throw new Error('no /sell/new tabs — probes 1-2 drafts were closed?');

  // Identify each tab with a light read-only connect.
  const tabs = [];
  for (const t of sellTabs) {
    const c = await CDP({ target: t.webSocketDebuggerUrl });
    const { result } = await c.Runtime.evaluate({ expression: whichTabExpr, returnByValue: true });
    tabs.push({ id: t.id, info: result.value });
    await c.close();
  }
  console.log('tabs:', JSON.stringify(tabs, null, 1));
  const collabTab = tabs.find((t) => t.info.designer === 'Nike');
  const photoTab = tabs.find((t) => t.info.designer !== 'Nike');

  /* ---------- C') photo census ---------- */
  if (photoTab) {
    await activate(photoTab.id);
    await sleep(400);
    const d = await connect({ freshTab: false });
    try {
      report.photoCensus = await d.evaluate(photoCensusExpr, 'photoCensus');
      console.log('\nphoto census:', JSON.stringify(report.photoCensus, null, 1));
      await d.assertClean('photo census');
    } finally { await d.close(); }
  }

  /* ---------- B') collab commit ---------- */
  if (collabTab) {
    await activate(collabTab.id);
    await sleep(400);
    const d = await connect({ freshTab: false });
    try {
      const state0 = await d.evaluate(designerStateExpr, 'designerState(before)');
      console.log('\ndesigner state before:', JSON.stringify(state0, null, 1));
      await d.pressEscape();
      const open = await d.evaluate(openCollabPickerExpr, 'openCollabPicker');
      console.log('open picker:', JSON.stringify(open));
      await sleep(800);
      const nocta = await d.evaluate(noctaExpr, 'nocta');
      report.nocta = { totalItems: nocta.totalItems, matches: nocta.noctaMatches, found: nocta.ok };
      console.log('nocta scan:', JSON.stringify(report.nocta));
      if (nocta.ok) {
        await d.client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: nocta.x, y: nocta.y });
        await d.client.Input.dispatchMouseEvent({ type: 'mousePressed', x: nocta.x, y: nocta.y, button: 'left', clickCount: 1 });
        await d.client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: nocta.x, y: nocta.y, button: 'left', clickCount: 1 });
        await sleep(1200);
        await d.assertClean('nocta click');
        report.afterCommit = await d.evaluate(designerStateExpr, 'designerState(after)');
        console.log('after commit:', JSON.stringify(report.afterCommit, null, 1));
      } else {
        await d.pressEscape();
      }
      report.signals = d.signals;
    } finally { await d.close(); }
  } else {
    report.note = 'collab tab (designer=Nike) not found';
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nreport written:', OUT);
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
