#!/usr/bin/env node
/*
 * Phase 0b — sell-form inventory (read-only). Step 9 groundwork: capture the
 * REAL /sell/new field structure so grailed-selectors.json can be built from
 * fact, not guesses (§7.1), and so the custom dropdown / photo-upload techniques
 * (§11 steps 7-8) can be figured out from the actual DOM.
 *
 * Footprint is deliberately identical to the proven-clean `phase0b.js probe`
 * (steps 5 + 6a): connect via raw chrome-remote-interface, enable ONLY Network
 * as an observation instrument, make exactly ONE Runtime.evaluate. That evaluate
 * ONLY READS the DOM — no value setting, no event dispatch, no fill logic. The
 * silent-detection caveat (§8.5) still applies; run it once, human-paced.
 *
 * Prereq: `npm run 0b:launch`, logged in, sitting on /sell/new.
 *   node phase0b-form-probe.js   (or: npm run 0b:form)
 */

const CDP = require('chrome-remote-interface');
const http = require('http');

const PORT = 9222;

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

// Runs in the page. Pure reads: querySelector / getAttribute / textContent only.
const INVENTORY = `(() => {
  const clip = (s, n) => (s == null ? null : String(s).trim().slice(0, n) || null);
  function labelFor(el) {
    if (el.id) { const l = document.querySelector('label[for="' + (window.CSS ? CSS.escape(el.id) : el.id) + '"]'); if (l) return clip(l.textContent, 50); }
    const wrap = el.closest && el.closest('label'); if (wrap) return clip(wrap.textContent, 50);
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const l = document.getElementById(lb); if (l) return clip(l.textContent, 50); }
    return null;
  }
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    id: el.id || null,
    placeholder: el.getAttribute('placeholder'),
    ariaLabel: el.getAttribute('aria-label'),
    dataTestid: el.getAttribute('data-testid'),
    role: el.getAttribute('role'),
    maxLength: el.getAttribute('maxlength'),
    contentEditable: el.getAttribute('contenteditable'),
    label: labelFor(el),
    text: clip(el.textContent, 40),
  });
  const map = (sel) => Array.from(document.querySelectorAll(sel)).map(desc);
  // custom dropdown candidates: ARIA comboboxes/listboxes, popup triggers, and
  // buttons whose text names a sell-form field.
  const comboish = Array.from(document.querySelectorAll('[role="combobox"],[role="listbox"],[aria-haspopup],button'))
    .filter((el) => {
      const t = (el.textContent || '').toLowerCase();
      return el.getAttribute('role') || el.getAttribute('aria-haspopup') || /designer|brand|category|department|size|condition|color|material/.test(t);
    })
    .slice(0, 40)
    .map(desc);
  return {
    url: location.href,
    onSellNew: location.href.includes('/sell'),
    webdriver: navigator.webdriver,
    counts: {
      inputs: document.querySelectorAll('input').length,
      textareas: document.querySelectorAll('textarea').length,
      selects: document.querySelectorAll('select').length,
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      editables: document.querySelectorAll('[contenteditable="true"]').length,
    },
    inputs: map('input'),
    textareas: map('textarea'),
    selects: map('select'),
    fileInputs: map('input[type="file"]'),
    editables: map('[contenteditable="true"]'),
    comboish,
  };
})()`;

async function main() {
  if (!(await portUp())) {
    console.error('❌ No CDP endpoint on :' + PORT + '. Run `npm run 0b:launch` and log in first.');
    process.exit(1);
  }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No grailed page target found. Open /sell/new in the launched Chrome.'); process.exit(1); }

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  try {
    await client.Network.enable(); // observation only — Runtime.enable is NOT called
    console.log('>>> ONE read-only Runtime.evaluate (inventory; no value setting) …\n');
    const { result, exceptionDetails } = await client.Runtime.evaluate({ expression: INVENTORY, returnByValue: true });
    if (exceptionDetails) {
      console.error('evaluate exceptionDetails:', JSON.stringify(exceptionDetails, null, 2));
      process.exit(1);
    }
    const inv = result.value;
    console.log('=== SELL FORM INVENTORY ===');
    console.log(JSON.stringify(inv, null, 2));
    if (!inv.onSellNew) console.log('\n⚠️  Not on /sell — navigate the launched Chrome to /sell/new and re-run.');
    console.log('\nnavigator.webdriver =', inv.webdriver, '| read-only, no fill. Silent-detection caveat (§8.5) still applies.');
  } finally {
    await client.close();
  }
}

async function portUp() {
  try { await getJSON('/json/version'); return true; } catch { return false; }
}
async function grailedTarget() {
  const list = await getJSON('/json');
  return list.find((t) => t.type === 'page' && /grailed\.com/.test(t.url || '')) || null;
}

main().catch((e) => { console.error('form-probe error:', e && e.message ? e.message : e); process.exit(1); });
