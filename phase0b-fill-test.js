#!/usr/bin/env node
/*
 * Phase 0b — step 6: first WRITE. Native-setter fill of the real title field.
 *
 * Authorized because step 5 (Runtime.enable) and step 6a (Runtime.evaluate) both
 * tested clean (§8.5). This makes ONE Runtime.evaluate that uses the native value
 * setter + dispatched input/change events — the technique React-controlled inputs
 * require — to fill ONLY the title field with a clearly-marked test string, then
 * verifies the value stuck and watches the network for any detection reaction.
 *
 * It does NOT: enable Runtime.enable, touch any other field, or submit anything.
 * The test value is obvious and safe to clear. Silent-detection caveat (§8.5)
 * still applies — run once, human-paced; trip the breaker on any warning.
 *
 * Prereq: `npm run 0b:launch`, logged in, on /sell/new.
 *   node phase0b-fill-test.js   (or: npm run 0b:fill)
 */

const CDP = require('chrome-remote-interface');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9222;
const TEST_VALUE = 'TEST FILL — clear this before submitting';

const selectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'grailed-selectors.json'), 'utf8'));
const TITLE_SEL = selectors.textFields.title.selector;

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
async function grailedTarget() {
  const list = await getJSON('/json');
  return list.find((t) => t.type === 'page' && /grailed\.com/.test(t.url || '')) || null;
}

// Native-setter fill — the technique React-controlled inputs require (a plain
// el.value = x is ignored by React; the native setter + input event is not).
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

// Count detection signals in a short Network observation window.
function observe(client, ms) {
  const signals = { usersMe: [], forbidden403: [], challengeHosts: [] };
  const CHALLENGE = /perimeterx|px-cloud|px-cdn|pxchk|captcha|recaptcha|hcaptcha|challenges\.cloudflare|human(security)?/i;
  const onResp = (p) => {
    const url = p.response.url;
    if (/\/api\/users\/me/.test(url)) signals.usersMe.push(p.response.status);
    if (p.response.status === 403) signals.forbidden403.push(url);
    if (CHALLENGE.test(url)) signals.challengeHosts.push(url);
  };
  client.Network.responseReceived(onResp);
  return new Promise((r) => setTimeout(() => r(signals), ms));
}

async function main() {
  if (!(await portUp())) {
    console.error('❌ No CDP endpoint on :' + PORT + '. Run `npm run 0b:launch` and log in first.');
    process.exit(1);
  }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No grailed page target. Open /sell/new in the launched Chrome.'); process.exit(1); }

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  try {
    await client.Network.enable(); // observation only — Runtime.enable NOT called
    console.log('== STEP 6: native-setter fill of the title field ==');
    console.log('selector:', TITLE_SEL, '\n');

    console.log('>>> ONE Runtime.evaluate (native-setter fill of title only) …');
    const { result, exceptionDetails } = await client.Runtime.evaluate({ expression: fillExpr(TITLE_SEL, TEST_VALUE), returnByValue: true });
    if (exceptionDetails) { console.error('evaluate exceptionDetails:', JSON.stringify(exceptionDetails, null, 2)); process.exit(1); }
    console.log('fill result:', JSON.stringify(result.value, null, 2));

    console.log('\n--- observing network ~2.5s for any reaction ---');
    const sig = await observe(client, 2500);
    console.log(JSON.stringify(sig, null, 2));

    const flagged = sig.forbidden403.length > 0 || sig.challengeHosts.length > 0 || sig.usersMe.some((s) => s === 401);
    if (!result.value.ok) {
      console.log('\n⚠️  Fill did NOT stick — title value did not update. Selector or technique needs a look.');
    } else if (flagged) {
      console.log('\n🚩 RED FLAG: a 403 / challenge / logout appeared after the fill. Stop and reassess (§8.1).');
    } else {
      console.log('\n✅ Title filled and value held; no immediate detection reaction. (silent-detection caveat §8.5 still applies)');
      console.log('   Check the Chrome window — the title box should read the test string. Clear it before submitting.');
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error('fill-test error:', e && e.message ? e.message : e); process.exit(1); });
