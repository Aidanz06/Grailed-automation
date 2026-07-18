/*
 * Circuit-breaker signal scoping (security review 2026-07-17, flaw #1):
 * only a Grailed-origin 403 may trip the §8.1 breaker — third-party 403s
 * (ads/beacons/extensions) during the settle window must be ignored.
 * Run:  node --test pipeline/autofillSignals.test.js   (or  npm run test:unit)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { isFirstParty403 } = require('../ui/autofill-driver');

test('grailed.com 403 is a block signal', () => {
  assert.strictEqual(isFirstParty403('https://www.grailed.com/api/listings', 403), true);
  assert.strictEqual(isFirstParty403('https://grailed.com/sell/new', 403), true);
  assert.strictEqual(isFirstParty403('https://media.grailed.com/x.jpg', 403), true);
});

test('third-party 403s do not trip the breaker', () => {
  assert.strictEqual(isFirstParty403('https://ads.doubleclick.net/beacon', 403), false);
  assert.strictEqual(isFirstParty403('https://cdn.segment.com/analytics.js', 403), false);
  assert.strictEqual(isFirstParty403('https://notgrailed.com/x', 403), false);
  // suffix spoof: "evilgrailed.com" is not first-party
  assert.strictEqual(isFirstParty403('https://evilgrailed.com/x', 403), false);
});

test('non-403 statuses and unparseable URLs are never signals', () => {
  assert.strictEqual(isFirstParty403('https://www.grailed.com/api', 200), false);
  assert.strictEqual(isFirstParty403('https://www.grailed.com/api', 401), false);
  assert.strictEqual(isFirstParty403('not a url', 403), false);
});

// ---- collabParts (designer collab fallback, fixed 2026-07-18) ----

const { collabParts } = require('../ui/autofill-driver');

test('collabParts: primary brand is the FIRST part across separator styles', () => {
  assert.deepStrictEqual(collabParts('Stussy x Nike'), ['Stussy', 'Nike']);
  assert.deepStrictEqual(collabParts('Supreme × Comme des Garcons'), ['Supreme', 'Comme des Garcons']);
  assert.deepStrictEqual(collabParts('A/B'), ['A', 'B']);
  assert.deepStrictEqual(collabParts('A & B'), ['A', 'B']);
});

test('collabParts: single brands and x-containing names stay whole', () => {
  assert.deepStrictEqual(collabParts('Nike'), ['Nike']);
  // "x" without surrounding spaces is part of the name, not a collab separator
  assert.deepStrictEqual(collabParts('Exit Clothing'), ['Exit Clothing']);
  assert.deepStrictEqual(collabParts(''), []);
});

// ---- autocompleteFallbacks (sub-line/word-prefix ladder, 2026-07-18) ----

const { autocompleteFallbacks } = require('../ui/autofill-driver');

test('fallbacks: collab -> primary brand only', () => {
  assert.deepStrictEqual(autocompleteFallbacks('Stussy x Nike'), ['Stussy']);
  assert.deepStrictEqual(autocompleteFallbacks('Supreme x Comme des Garçons SHIRT'), ['Supreme']);
});

test('fallbacks: multi-word brand -> up to two word-prefixes, longest first', () => {
  assert.deepStrictEqual(autocompleteFallbacks('Fear of God Essentials'), ['Fear of God', 'Fear of']);
  assert.deepStrictEqual(autocompleteFallbacks('Carhartt WIP'), ['Carhartt']);
});

test('fallbacks: single-word brand has no ladder (fails clean instead)', () => {
  assert.deepStrictEqual(autocompleteFallbacks('ISOKNOCK'), []);
  assert.deepStrictEqual(autocompleteFallbacks(''), []);
});
