/*
 * Deterministic unit tests for the content-generation scrubs (no API key).
 * Run:  node --test pipeline/content.test.js   (or  npm run test:unit)
 *
 * These guard the buyer-facing text backstops — the pure, free-to-test half of
 * the content pipeline. The AI generation itself is covered by the on-demand
 * eval (docs/DIAGNOSIS-AND-TEST-SUITE.md §D), which needs a live key.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { stripHypeLines, stripAuthenticityLines, stripMeasurementBlanks } = require('./content');

test('stripHypeLines drops a marketing sentence but keeps facts', () => {
  const out = stripHypeLines({
    description: 'Black cotton hoodie. A timeless wardrobe staple. Size L.',
    desc_parts: { overview: 'Black cotton hoodie.', condition: 'Good used condition.' },
  });
  assert.ok(!/timeless/i.test(out.description), 'hype phrase removed');
  assert.ok(/Black cotton hoodie/.test(out.description), 'factual content kept');
  assert.ok(/Size L/.test(out.description), 'unrelated fact kept');
});

test('stripAuthenticityLines removes authenticity mentions from the body only', () => {
  const out = stripAuthenticityLines({
    description: 'Good condition. Authenticity not verified.',
    desc_parts: { overview: 'Good condition.', condition: '' },
  });
  assert.ok(!/authentic/i.test(out.description), 'authenticity sentence removed');
  assert.ok(/Good condition/.test(out.description), 'rest of the line kept');
});

test('stripMeasurementBlanks removes placeholder blanks, keeps typed measurements', () => {
  const out = stripMeasurementBlanks({
    description: 'Overview line.\nPit to pit: __ in\nLength: 28 in',
    desc_parts: { overview: 'Overview line.', condition: '' },
  });
  assert.ok(!/__/.test(out.description), 'blank placeholder removed');
  assert.ok(/Length: 28 in/.test(out.description), 'real typed measurement kept');
});

test('scrubs are no-ops on clean, objective copy', () => {
  const clean = { description: 'Navy wool overcoat. Good used condition.', desc_parts: { overview: 'Navy wool overcoat.', condition: 'Good used condition.' } };
  const out = stripMeasurementBlanks(stripHypeLines(stripAuthenticityLines({ ...clean, desc_parts: { ...clean.desc_parts } })));
  assert.strictEqual(out.description, clean.description, 'clean copy is untouched');
});
