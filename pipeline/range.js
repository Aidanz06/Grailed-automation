/*
 * Price-range logic (PRD §5.3, stage 2 post-processing).
 * Pure functions — no I/O, no network.
 *
 * A broad comp query returns many sales spanning the whole category (old seasons,
 * other players, youth sizes, worn condition) — its raw median under-prices a
 * specific, desirable variant. So instead of treating every comp equally, we
 * RELEVANCE-WEIGHT each comp by how well it matches THIS item:
 *
 *   weight = recency × conditionProximity × sizeFactor × titleOverlap
 *
 * then take weighted 25/50/75 percentiles (after an IQR outlier drop). Comps that
 * look like the item dominate the estimate; off-target comps fade out.
 *
 * Always a range with the comps behind it, never a lone confident number
 * (PRD §5.3, §8.7).
 */

const DAY_MS = 86_400_000;
const RECENCY_HALF_LIFE_DAYS = 180; // seasonal resale — softer decay than 90d

function round(n) {
  return n == null ? null : Math.round(n);
}

// ---- tokenization for title/era/player overlap ----
// Terms shared by every comp in a query (brand/team/garment) carry no
// discriminative signal WITHIN the result set, so we drop them and keep the
// distinguishing tokens: season/year, player, edition.
const STOPWORDS = new Set([
  'fc', 'cf', 'the', 'and', 'of', 'size', 'sz', 'jersey', 'shirt', 'kit', 'tee',
  'football', 'soccer', 'home', 'away', 'third', 'authentic', 'official', 'original',
  'vintage', 'rare', 'og', 'mens', 'men', 'women', 'womens', 'youth', 'kids', 'boys',
  'nike', 'adidas', 'puma', 'dri', 'fit', 'drifit', 'new', 'used', 'x',
]);

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && (t.length >= 2 || /^\d$/.test(t)) && !STOPWORDS.has(t));
}

// Distinctive tokens describing the item (season/player/edition), from the
// descriptive attribute fields (NOT comp_query, which is intentionally broad/common).
function itemTokens(attributes = {}) {
  const src = [
    ...(Array.isArray(attributes.search_keywords) ? attributes.search_keywords : []),
    attributes.era_style,
    attributes.subcategory,
  ].join(' ');
  return [...new Set(tokenize(src))];
}

// ---- condition proximity ----
const COMP_COND_ORD = { is_new: 2, is_gently_used: 1, is_used: 0 };
function itemConditionOrd(rating) {
  const r = String(rating || '').toLowerCase();
  if (['new', 'like new', 'excellent'].includes(r)) return 2;
  if (r === 'very good') return 1.5;
  if (r === 'good') return 1;
  if (r === 'fair') return 0.5;
  if (r === 'poor') return 0;
  return 1; // unclear
}
function conditionProximity(compCondition, itemOrd) {
  const compOrd = COMP_COND_ORD[compCondition];
  if (compOrd == null) return 0.7; // unknown comp condition → neutral
  const prox = 1 - Math.abs(itemOrd - compOrd) / 2;
  return 0.4 + 0.6 * Math.max(0, prox); // 0.4 (opposite) … 1.0 (same tier)
}

// ---- size proximity ----
const ADULT_SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];
function normSize(s) {
  const v = String(s || '').toLowerCase().trim();
  if (!v) return { known: false };
  if (/(youth|kids|boys|girls|toddler|^y[ms l]|^\d{1,2}(-\d{1,2})?$)/.test(v)) {
    return { known: true, youth: true };
  }
  const idx = ADULT_SIZES.indexOf(v.replace(/[^a-z]/g, ''));
  return idx >= 0 ? { known: true, youth: false, idx } : { known: true, youth: false };
}
function sizeFactor(itemSizeStr, compSizeStr) {
  const item = normSize(itemSizeStr);
  const comp = normSize(compSizeStr);
  if (!item.known) return 0.75; // item size unknown → mild, non-discriminating
  if (!comp.known) return 0.7;
  if (item.youth !== comp.youth) return 0.35; // adult vs youth mismatch
  if (item.idx != null && comp.idx != null) {
    const d = Math.abs(item.idx - comp.idx);
    return d === 0 ? 1.0 : d === 1 ? 0.8 : d === 2 ? 0.6 : 0.45;
  }
  return 0.75;
}

function titleOverlapFactor(compTitle, iTokens) {
  if (!iTokens.length) return 0.7; // nothing to match on → neutral
  const t = new Set(tokenize(compTitle));
  let matches = 0;
  for (const tok of iTokens) if (t.has(tok)) matches++;
  // 0 matches → 0.35, ramps to 1.0 at 3+ distinctive matches
  return 0.35 + 0.65 * Math.min(1, matches / 3);
}

function recencyWeight(soldDate, now) {
  const t = soldDate ? Date.parse(soldDate) : NaN;
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (now - t) / DAY_MS);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

function dropOutliers(prices) {
  if (prices.length < 4) return { kept: prices.slice(), dropped: [] };
  const sorted = [...prices].sort((a, b) => a - b);
  const q = (p) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const kept = [];
  const dropped = [];
  for (const p of prices) (p >= lowFence && p <= highFence ? kept : dropped).push(p);
  return { kept: kept.length ? kept : prices.slice(), dropped };
}

function weightedQuantile(items, q) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  if (total <= 0) return null;
  const target = q * total;
  let cum = 0;
  for (let i = 0; i < items.length; i++) {
    cum += items[i].weight;
    if (cum >= target) {
      if (i === 0) return items[0].price;
      const prev = items[i - 1];
      const over = cum - target;
      const frac = 1 - over / items[i].weight;
      return prev.price + (items[i].price - prev.price) * frac;
    }
  }
  return items[items.length - 1].price;
}

function computeRange(comps = [], attributes = {}, opts = {}) {
  const now = opts.now || Date.now();

  const priced = comps.filter((c) => c && Number.isFinite(c.price) && c.price > 0);
  if (priced.length === 0) {
    return {
      currency: 'USD',
      low: null, median: null, high: null,
      sampleSize: 0, outliersDropped: 0,
      note: 'no usable comps',
    };
  }

  const { kept, dropped } = dropOutliers(priced.map((c) => c.price));
  const keptSet = new Set(kept);

  const iTokens = itemTokens(attributes);
  const itemOrd = itemConditionOrd(attributes.condition_rating);
  const itemSize = attributes.size;

  const weighted = priced
    .filter((c) => keptSet.has(c.price))
    .map((c) => {
      const relevance =
        conditionProximity(c.condition, itemOrd) *
        sizeFactor(itemSize, c.size) *
        titleOverlapFactor(c.title, iTokens);
      const weight = recencyWeight(c.soldDate, now) * relevance;
      return { ...c, weight, relevance };
    })
    .sort((a, b) => a.price - b.price);

  const topComps = [...weighted]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((c) => ({
      price: c.price,
      soldDate: (c.soldDate || '').slice(0, 10),
      weight: Number(c.weight.toFixed(3)),
      title: (c.title || '').slice(0, 60),
      // Keep the listing URL — the UI's comp rows open it (dropping it here
      // made every real comp render as an unlinked row, found 2026-07-04).
      url: c.url || null,
    }));

  const q25 = weightedQuantile(weighted, 0.25);
  const median = weightedQuantile(weighted, 0.5);
  const q75 = weightedQuantile(weighted, 0.75);

  return {
    currency: 'USD',
    low: round(q25),
    median: round(median),
    high: round(q75),
    sampleSize: weighted.length,
    outliersDropped: dropped.length,
    basis: 'relevance-weighted (condition × size × title/era overlap × recency) 25/50/75 percentiles',
    mostRelevantComps: topComps,
    confidence: confidenceFor(weighted, { q25, median, q75 }),
  };
}

/*
 * Estimate confidence (owner request 2026-07-05): the low–high band alone
 * hides HOW comparable the comps were. Duplicate sold listings of the same
 * item → the median is trustworthy; only loosely-similar sales → it's a
 * guess. Two ingredients, both from data already computed:
 *   match quality — relevance (condition × size × title overlap) per comp;
 *     ≥0.75 needs a real title match AND close size AND close condition,
 *     which in practice means "the same item sold before".
 *   spread — weighted IQR→σ around the median (cv), plus Kish effective
 *     sample size (Σw)²/Σw² so ten barely-relevant comps don't masquerade
 *     as a big sample.
 * ci95 is a normal-approx interval on the MEDIAN estimate (σ/√nEff), i.e.
 * "where the true going rate likely sits", not the min–max of sales.
 */
const STRONG_RELEVANCE = 0.75;
const MODERATE_RELEVANCE = 0.55;
function confidenceFor(weighted, { q25, median, q75 }) {
  if (!weighted.length || median == null || median <= 0) return null;
  const strong = weighted.filter((c) => c.relevance >= STRONG_RELEVANCE).length;
  const moderate = weighted.filter((c) => c.relevance >= MODERATE_RELEVANCE && c.relevance < STRONG_RELEVANCE).length;

  const sumW = weighted.reduce((s, c) => s + c.weight, 0);
  const sumW2 = weighted.reduce((s, c) => s + c.weight * c.weight, 0);
  const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;

  const sigma = Math.max(0, (q75 - q25)) / 1.349; // IQR → σ under normality
  const cv = sigma / median;
  const halfCi = 1.96 * (sigma / Math.sqrt(Math.max(1, effectiveN)));

  // Level: matches set the base, spread/sample can only pull it DOWN.
  let level = strong >= 3 ? 'high' : strong >= 1 || moderate >= 4 ? 'medium' : 'low';
  const demote = () => { level = level === 'high' ? 'medium' : 'low'; };
  if (cv > 0.45) demote();
  // 2.5, not 3: one strong comp dominating the weights shouldn't by itself
  // turn "a close match + corroborating sales" into low.
  if (effectiveN < 2.5 || weighted.length < 3) demote();

  const matchPart =
    strong >= 3
      ? `${strong} near-identical sold listings`
      : strong >= 1
        ? `${strong} close match${strong === 1 ? '' : 'es'}, rest loosely similar`
        : 'no close matches — based on loosely similar sales';
  const spreadPart = cv <= 0.25 ? 'tight price spread' : cv <= 0.45 ? 'moderate price spread' : 'wide price spread';

  return {
    level,
    ci95: [round(Math.max(0, median - halfCi)), round(median + halfCi)],
    strongMatches: strong,
    moderateMatches: moderate,
    effectiveN: Number(effectiveN.toFixed(1)),
    spreadCv: Number(cv.toFixed(2)),
    explanation: `${matchPart}; ${spreadPart}`,
  };
}

module.exports = {
  computeRange,
  dropOutliers,
  tokenize,
  itemTokens,
  sizeFactor,
  conditionProximity,
};
