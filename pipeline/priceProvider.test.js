/*
 * Deterministic unit tests for the narrow-first comp query and the exact-match
 * range tier (docs/VISION-MATCHING-CHANGES §B/§C). No network, no API key.
 * Run:  node --test pipeline/priceProvider.test.js   (or  npm run test:unit)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { buildQueryText, buildNarrowQueryText, getCompsTiered } = require('./priceProvider');
const { computeRange, exactMatchTier } = require('./range');

// ---- buildNarrowQueryText ----

test('narrow query = brand + model when both are known', () => {
  assert.strictEqual(
    buildNarrowQueryText({ resembles_brand: 'Nike', model: 'Dunk Low', comp_query: 'nike sneakers' }),
    'Nike Dunk Low'
  );
});

test('narrow query dedupes brand repeated inside the model name', () => {
  assert.strictEqual(
    buildNarrowQueryText({ resembles_brand: 'Carhartt', model: 'Carhartt Detroit Jacket' }),
    'Carhartt Detroit Jacket'
  );
});

test('niche brand: unclear brand + visible_text → the literal text is the query', () => {
  assert.strictEqual(
    buildNarrowQueryText({ resembles_brand: 'unclear', visible_text: 'ISOKNOCK', subcategory: 'hoodie' }),
    'ISOKNOCK hoodie'
  );
});

test('long verbatim visible_text is capped so Algolia AND-matching still hits', () => {
  const q = buildNarrowQueryText({
    resembles_brand: 'unclear',
    visible_text: 'WORLD TOUR 1994 NEW YORK LONDON PARIS TOKYO BERLIN',
  });
  assert.ok(q.split(' ').length <= 6, `capped, got "${q}"`);
});

test('collab brand string narrows under the primary label only', () => {
  assert.strictEqual(
    buildNarrowQueryText({ resembles_brand: 'Supreme x Comme des Garçons', model: 'Box Logo' }),
    'Supreme Box Logo'
  );
});

test('brand + visible_text beyond the brand name itself → brand + those words', () => {
  assert.strictEqual(
    buildNarrowQueryText({ resembles_brand: 'Stussy', visible_text: 'STUSSY 8 Ball' }),
    'Stussy 8 Ball'
  );
});

test('no model / text / distinctive → null (broad tier only)', () => {
  assert.strictEqual(buildNarrowQueryText({ resembles_brand: 'Nike', subcategory: 'sneakers' }), null);
  assert.strictEqual(buildNarrowQueryText({ resembles_brand: 'unclear' }), null);
  assert.strictEqual(buildNarrowQueryText({}), null);
});

test('buildQueryText honors an explicit narrow query (guard cache key + provider agree)', () => {
  assert.strictEqual(
    buildQueryText({ _narrowQuery: 'Nike Dunk Low', comp_query: 'nike sneakers' }),
    'Nike Dunk Low'
  );
  assert.strictEqual(buildQueryText({ comp_query: 'nike sneakers' }), 'nike sneakers');
});

// ---- getCompsTiered ----

function fakeProvider(byQuery) {
  const calls = [];
  return {
    calls,
    async getComps(attributes) {
      const q = buildQueryText(attributes);
      calls.push({ q, narrow: Boolean(attributes._narrowQuery) });
      const comps = byQuery[q] || [];
      return { comps, range: computeRange(comps, attributes) };
    },
  };
}

const sold = (price, title) => ({ price, sold: true, title, soldDate: '2026-06-01T00:00:00.000Z', source: 'grailed', url: null });

test('tiered: narrow query with enough sold hits wins — broad never runs', async () => {
  const attrs = { resembles_brand: 'Nike', model: 'Dunk Low', comp_query: 'nike sneakers' };
  const provider = fakeProvider({
    'Nike Dunk Low': [sold(90, 'Nike Dunk Low panda'), sold(95, 'Nike Dunk Low'), sold(88, 'Nike dunk low gum')],
    'nike sneakers': [sold(40, 'random sneaker')],
  });
  const res = await getCompsTiered(provider, attrs);
  assert.strictEqual(res.tier, 'narrow');
  assert.strictEqual(res.narrowQuery, 'Nike Dunk Low');
  assert.strictEqual(res.comps.length, 3);
  assert.strictEqual(provider.calls.length, 1, 'broad query not run when narrow is rich');
  assert.ok(provider.calls[0].narrow, 'narrow flag reached the provider');
  assert.strictEqual(res.range.compTier, 'narrow');
});

test('tiered: thin narrow result falls back to broad', async () => {
  const attrs = { resembles_brand: 'Nike', model: 'Dunk Low', comp_query: 'nike sneakers' };
  const provider = fakeProvider({
    'Nike Dunk Low': [sold(90, 'Nike Dunk Low')], // 1 < K
    'nike sneakers': [sold(40, 'a'), sold(50, 'b'), sold(60, 'c'), sold(70, 'd')],
  });
  const res = await getCompsTiered(provider, attrs);
  assert.strictEqual(res.tier, 'broad');
  assert.strictEqual(res.comps.length, 4);
  assert.strictEqual(provider.calls.length, 2);
  assert.ok(!provider.calls[1].narrow, 'fallback ran the plain broad query');
});

test('tiered: no narrow signal → single broad query', async () => {
  const attrs = { resembles_brand: 'unclear', comp_query: 'brown hoodie' };
  const provider = fakeProvider({ 'brown hoodie': [sold(40, 'a'), sold(50, 'b'), sold(60, 'c')] });
  const res = await getCompsTiered(provider, attrs);
  assert.strictEqual(res.tier, 'broad');
  assert.strictEqual(provider.calls.length, 1);
});

// ---- exactMatchTier + range weighting ----

test('exactMatchTier: brand + ALL model tokens in the title', () => {
  const attrs = { resembles_brand: 'Nike', model: 'Dunk Low' };
  assert.ok(exactMatchTier('Nike Dunk Low Panda size 10', attrs));
  assert.ok(!exactMatchTier('Nike Dunk High Syracuse', attrs), 'High is a different piece');
  assert.ok(!exactMatchTier('Nike Air Force 1', attrs));
  assert.ok(!exactMatchTier('Adidas Dunk Low lookalike', attrs), 'brand token required');
});

test('exactMatchTier: niche visible_text path when brand is unclear', () => {
  const attrs = { resembles_brand: 'unclear', visible_text: 'ISOKNOCK' };
  assert.ok(exactMatchTier('Isoknock knit hoodie brown', attrs));
  assert.ok(!exactMatchTier('brown knit hoodie', attrs));
  // no substantial word → never matches
  assert.ok(!exactMatchTier('the one', { resembles_brand: 'unclear', visible_text: 'the one' }));
});

test('exactMatchTier: no model and no visible text → never exact', () => {
  assert.ok(!exactMatchTier('Nike hoodie', { resembles_brand: 'Nike' }));
});

test('exact comps drive the median and set confidence high', () => {
  const now = Date.parse('2026-07-01T00:00:00.000Z');
  const recent = '2026-06-20T00:00:00.000Z';
  const attrs = { resembles_brand: 'Nike', model: 'Dunk Low', condition_rating: 'Gently used' };
  // 3 identical sales ~$95 buried in 12 loose cheap comps at $40–60.
  const comps = [
    sold(92, 'Nike Dunk Low panda'),
    sold(95, 'Nike Dunk Low'),
    sold(98, 'Nike dunk low gum sole'),
    ...Array.from({ length: 12 }, (_, i) => sold(40 + i * 2, `generic brown sneaker ${i}`)),
  ].map((c) => ({ ...c, soldDate: recent }));

  const withTier = computeRange(comps, attrs, { now });
  assert.strictEqual(withTier.exactMatchCount, 3);
  assert.ok(
    withTier.soldMedian >= 85,
    `exact sales dominate the sold median, got ${withTier.soldMedian}`
  );
  assert.strictEqual(withTier.confidence.level, 'high');
  assert.strictEqual(withTier.confidence.exactMatches, 3);
  assert.match(withTier.confidence.explanation, /3 sales of this exact piece/);
  assert.ok(
    withTier.mostRelevantComps.filter((c) => c.exact).length >= 3,
    'exact comps surface in mostRelevantComps'
  );

  // Control: same comps, no model captured → the old diluted behavior.
  const withoutTier = computeRange(comps, { ...attrs, model: '' }, { now });
  assert.strictEqual(withoutTier.exactMatchCount, 0);
  assert.ok(
    withoutTier.soldMedian < withTier.soldMedian,
    `without the tier the loose comps drag the median (${withoutTier.soldMedian} < ${withTier.soldMedian})`
  );
});

test('NWT logic intact: new item over mostly-used comps still demotes confidence', () => {
  const now = Date.parse('2026-07-01T00:00:00.000Z');
  const attrs = { resembles_brand: 'Stussy', model: '8 Ball Tee', condition_rating: 'New with tags' };
  const comps = [
    { ...sold(60, 'Stussy 8 Ball Tee'), condition: 'is_used', soldDate: '2026-06-01T00:00:00.000Z' },
    { ...sold(65, 'Stussy 8 ball tee white'), condition: 'is_used', soldDate: '2026-06-01T00:00:00.000Z' },
    { ...sold(70, 'Stussy 8 ball tee L'), condition: 'is_used', soldDate: '2026-06-01T00:00:00.000Z' },
  ];
  const r = computeRange(comps, attrs, { now });
  assert.strictEqual(r.newCompCount, 0);
  assert.notStrictEqual(r.confidence.level, 'high', 'nwtThin demotion still applies over exact matches');
  assert.match(r.confidence.explanation, /new-condition comps/);
});
