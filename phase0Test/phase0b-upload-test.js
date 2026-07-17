#!/usr/bin/env node
/*
 * Phase 0b — step 8: photo upload via CDP DOM.setFileInputFiles.
 *
 * Sets a real image on the first sell-form file input (#photo_input_0). Grailed
 * uploads on file-select, so THIS PUTS A REAL IMAGE ON YOUR SELL DRAFT — remove
 * it afterward. Uses the DOM domain (new variable vs the proven Runtime path);
 * network is observed before/after for any detection reaction (§8.5 caveat).
 * Does NOT submit.
 *
 * Prereq: `npm run 0b:launch`, logged in, on /sell/new.
 *   node phase0b-upload-test.js [/abs/path/to/image.jpg]
 *   npm run 0b:upload
 */

const CDP = require('chrome-remote-interface');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9222;
const IMAGE = process.argv[2] || path.join(__dirname, '..', 'grailed-vision-test', 'grailed-vision-test-4.jpg');
const SLOT = 'input[type="file"][id^="photo_input_"]'; // first slot

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
async function portUp() { try { await getJSON('/json/version'); return true; } catch { return false; } }
async function grailedTarget() {
  const list = await getJSON('/json');
  return list.find((t) => t.type === 'page' && /grailed\.com/.test(t.url || '')) || null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(IMAGE)) { console.error('❌ Image not found:', IMAGE); process.exit(1); }
  if (!(await portUp())) { console.error('❌ No CDP endpoint on :' + PORT + '. Run `npm run 0b:launch` first.'); process.exit(1); }
  const target = await grailedTarget();
  if (!target) { console.error('❌ No grailed page target. Open /sell/new.'); process.exit(1); }

  const client = await CDP({ target: target.webSocketDebuggerUrl });
  const CHALLENGE = /perimeterx|px-cloud|px-cdn|pxchk|captcha|recaptcha|hcaptcha|challenges\.cloudflare|human(security)?/i;
  const sig = { forbidden403: [], challengeHosts: [], uploads: [] };
  try {
    await client.Network.enable();
    client.Network.responseReceived((p) => {
      if (p.response.status === 403) sig.forbidden403.push(p.response.url);
      if (CHALLENGE.test(p.response.url)) sig.challengeHosts.push(p.response.url);
    });
    client.Network.requestWillBeSent((p) => {
      if (/upload|photo|image|s3|cloudinary|imgix/i.test(p.request.url) && p.request.method === 'POST') sig.uploads.push(p.request.url.slice(0, 90));
    });

    console.log('== STEP 8: photo upload (DOM.setFileInputFiles) ==');
    console.log('image:', IMAGE, '\n');

    const { root } = await client.DOM.getDocument();
    const { nodeId } = await client.DOM.querySelector({ nodeId: root.nodeId, selector: SLOT });
    if (!nodeId) { console.error('❌ file input not found via', SLOT); return; }

    console.log('>>> DOM.setFileInputFiles on first photo slot …');
    await client.DOM.setFileInputFiles({ nodeId, files: [IMAGE] });

    await sleep(3000); // give Grailed time to upload + render a preview
    const check = await client.Runtime.evaluate({
      expression: `(() => { const el = document.querySelector(${JSON.stringify(SLOT)}); return { files: el ? el.files.length : null, name: el && el.files[0] ? el.files[0].name : null, previewImgs: document.querySelectorAll('img[src^="blob:"]').length }; })()`,
      returnByValue: true,
    });
    console.log('page state:', JSON.stringify(check.result.value, null, 2));
    console.log('network:', JSON.stringify(sig, null, 2));

    const flagged = sig.forbidden403.length || sig.challengeHosts.length;
    // Grailed uploads on select then clears the input, so files:0 is normal —
    // the media-host POST is the real proof the upload happened.
    const uploaded = sig.uploads.length > 0 || check.result.value.files >= 1;
    if (flagged) console.log('\n🚩 403/challenge appeared — stop and reassess (§8.1).');
    else if (uploaded) console.log('\n✅ upload fired (POST to media host); Grailed consumed the file + cleared the input (files:0 is expected). Check Chrome for the photo; REMOVE the test image before submitting. (silent-detection caveat §8.5)');
    else console.log('\n⚠️  no upload POST and files:0 — setFileInputFiles did not take. Paste this output.');
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error('upload-test error:', e && e.message ? e.message : e); process.exit(1); });
