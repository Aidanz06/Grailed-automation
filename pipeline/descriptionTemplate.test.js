/*
 * Deterministic tests for the Description Styles template engine (Phase 1).
 * These ARE the composition spec: footer always last, empty chips drop their
 * line, only template chips appear (in order), unset config = clean default.
 * Run:  node --test pipeline/descriptionTemplate.test.js   (or npm run test:unit)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const {
  BUILTIN_STYLES,
  DEFAULT_FOOTER,
  resolveStyles,
  activeTemplate,
  chipValues,
  composeDescription,
  styleFooter,
  finalizeDescription,
} = require('./descriptionTemplate');

const FULL_ATTRS = {
  resembles_brand: 'Carhartt',
  brand_confidence: 0.9,
  primary_color: 'brown',
  materials: ['duck canvas', 'cotton'],
  era_style: '90s workwear',
  visible_text: 'DETROIT J97',
  condition_rating: 'Gently used',
};
const FULL_PARTS = {
  overview: 'Brown duck canvas work jacket with blanket lining.',
  condition_note: 'light fading at the cuffs',
  fit: 'Runs boxy through the shoulders.',
  flaws: 'Small stain on the left sleeve.',
};

test('footer is ALWAYS the exact last line, for every built-in style', () => {
  const values = chipValues(FULL_ATTRS, FULL_PARTS);
  for (const s of BUILTIN_STYLES) {
    const body = finalizeDescription(composeDescription(s.template, values), s.template);
    assert.ok(body.endsWith(DEFAULT_FOOTER), `${s.name}: footer last, got …"${body.slice(-50)}"`);
  }
});

test('finalize appends the footer when missing and is idempotent', () => {
  const t = BUILTIN_STYLES[0].template;
  const bare = 'Some body without the closer.';
  const once = finalizeDescription(bare, t);
  assert.ok(once.endsWith(DEFAULT_FOOTER));
  assert.strictEqual(finalizeDescription(once, t), once, 'no double footer');
  assert.strictEqual(finalizeDescription('', t), DEFAULT_FOOTER, 'empty body → footer alone');
});

test('a data chip with an empty source drops its whole line — no blanks, no "unknown"', () => {
  const template = '[overview]\nMaterial: [material]\n\n[condition_rating]';
  const body = composeDescription(template, chipValues({ condition_rating: 'Used' }, { overview: 'A jacket.' }));
  assert.ok(!/Material/.test(body), 'empty material line dropped entirely');
  assert.ok(!/unknown/i.test(body));
  assert.strictEqual(body, 'A jacket.\n\nUsed');
});

test('only chips present in the active template appear, in order', () => {
  const template = '[color]\n[brand]';
  const body = composeDescription(template, chipValues(FULL_ATTRS, FULL_PARTS));
  assert.strictEqual(body, 'brown\nCarhartt', 'template order wins; no overview/condition leaked in');
});

test('unset config → the default: overview + condition + footer (flaws-less item)', () => {
  const t = activeTemplate(null);
  const values = chipValues(
    { condition_rating: 'Gently used' },
    { overview: 'Knit hoodie in brown.', condition_note: 'no visible wear' }
  );
  const body = finalizeDescription(composeDescription(t, values), t);
  assert.strictEqual(
    body,
    'Knit hoodie in brown.\n\nCondition: Gently used, no visible wear\n\n' + DEFAULT_FOOTER
  );
});

test('conditional overview: empty overview (title already says it) → opens on the Condition line', () => {
  // The owner's "UTOPIA Circus Maximus Tour I KNOW Shirt" case: the AI returns
  // "" for overview and the composed listing goes straight to Condition + footer.
  const t = activeTemplate(null);
  const values = chipValues(
    { condition_rating: 'Gently used' },
    { overview: '', condition_note: 'no stains or holes' }
  );
  const body = finalizeDescription(composeDescription(t, values), t);
  assert.strictEqual(body, 'Condition: Gently used, no stains or holes\n\n' + DEFAULT_FOOTER);
});

test('a constant label line drops when everything under it dropped ("Note:" with no flaws)', () => {
  const t = BUILTIN_STYLES.find((s) => s.name === 'Standard').template;
  const body = composeDescription(t, chipValues(FULL_ATTRS, { ...FULL_PARTS, flaws: '' }));
  assert.ok(!/Note:/.test(body), '"Note:" label dropped');
  const withFlaws = composeDescription(t, chipValues(FULL_ATTRS, FULL_PARTS));
  assert.match(withFlaws, /Note:\nSmall stain on the left sleeve\./, 'label kept when flaws exist');
});

test('mixed constant+chip line: empty chips clean up their separators', () => {
  const line = 'Condition: [condition_rating], [condition_note]';
  assert.strictEqual(
    composeDescription(line, { condition_rating: 'Gently used', condition_note: '' }),
    'Condition: Gently used'
  );
  assert.strictEqual(
    composeDescription(line, { condition_rating: '', condition_note: 'light fading' }),
    'Condition: light fading'
  );
  assert.strictEqual(composeDescription(line, {}), '', 'all chips empty → whole line (label included) gone');
});

test('chip guardrails: unconfident/unclear brand and Unclear rating are empty', () => {
  const v1 = chipValues({ resembles_brand: 'Nike', brand_confidence: 0.4 }, {});
  assert.strictEqual(v1.brand, '', 'low-confidence brand never stated');
  const v2 = chipValues({ resembles_brand: 'unclear', brand_confidence: 0.9, condition_rating: 'Unclear' }, {});
  assert.strictEqual(v2.brand, '');
  assert.strictEqual(v2.condition_rating, '', '"Unclear" is an AI state, not listing copy');
  // legacy desc_parts: condition_note falls back to the old `condition` key
  const v3 = chipValues({}, { condition: 'Good used condition.' });
  assert.strictEqual(v3.condition_note, 'Good used condition.');
});

test('resolveStyles: user styles override built-ins by name; corrupt JSON → defaults', () => {
  const raw = JSON.stringify({
    active: 'Mine',
    styles: [
      { name: 'Mine', template: '[overview]\n\nCustom closer.' },
      { name: 'Minimal', template: '[overview]\nEdited minimal.' },
    ],
  });
  const r = resolveStyles(raw);
  assert.strictEqual(r.active, 'Mine');
  assert.strictEqual(r.styles.find((s) => s.name === 'Minimal').template, '[overview]\nEdited minimal.');
  assert.ok(r.styles.find((s) => s.name === 'Minimal').builtin, 'overridden built-in stays marked builtin');
  assert.ok(r.styles.find((s) => s.name === 'Standard'), 'untouched built-ins still present');
  assert.strictEqual(styleFooter(r.styles.find((s) => s.name === 'Mine').template), 'Custom closer.');

  const bad = resolveStyles('{not json');
  assert.strictEqual(bad.active, 'Standard');
  assert.strictEqual(bad.styles.length, BUILTIN_STYLES.length);
});

test('unknown [tokens] are constant text, not chips', () => {
  const body = composeDescription('[overview]\nships [worldwide]', { overview: 'A tee.' });
  assert.strictEqual(body, 'A tee.\nships [worldwide]');
});

test('multi-line footers are extracted and enforced whole', () => {
  const t = '[overview]\n\nBundle for a deal.\nOpen to offers.';
  assert.strictEqual(styleFooter(t), 'Bundle for a deal.\nOpen to offers.');
  const body = finalizeDescription('Edited by hand.', t);
  assert.ok(body.endsWith('Bundle for a deal.\nOpen to offers.'));
});
