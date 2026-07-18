/*
 * PriceCompProvider (PRD §5.3, §6).
 *
 *   getComps(attributes) -> { comps: [{price, soldDate, source, url}], range: {low, median, high} }
 *
 * GrailedScrapeProvider uses plain HTTP against Grailed's public, unauthenticated
 * search (Algolia — the same index Grailed's own web frontend queries). This is
 * COMPLETELY SEPARATE infrastructure from phase0b.js / the CDP browser session —
 * it opens its own HTTP requests and shares nothing with the authenticated Chrome.
 *
 * ⚠️ Scraping is an accepted ToS trade-off for personal use (PRD §8.1): rate-limit,
 * cache, keep it human-paced, and honor the §8.1 circuit breaker.
 *
 * The Algolia app id / index / key are configuration, not secrets baked into code
 * (the public search key is embedded in Grailed's frontend JS). Supply them via env;
 * see getComps for how to obtain the current key. Because these can change and can't
 * be verified here, MockCompProvider is provided as a guaranteed-working path for
 * exercising the rest of the pipeline (range logic, CLI, end-to-end shape).
 */

const { computeRange } = require('./range');

class PriceCompProvider {
  // eslint-disable-next-line no-unused-vars
  async getComps(attributes) {
    throw new Error('getComps() not implemented');
  }
}

// Keep the query SHORT and high-signal. Algolia ANDs query words by default, so a
// long multi-phrase query matches nothing. We use the model's single best keyword
// phrase (or brand + subcategory as fallback) and pair it with
// removeWordsIfNoResults=allOptional (set in getComps) so an over-specific query
// degrades gracefully instead of returning zero.
function buildQueryText(attributes = {}) {
  // Narrow-first tier (docs/VISION-MATCHING-CHANGES §B): an explicit narrow
  // query rides in on the attributes (set ONLY by getCompsTiered) so the
  // guard's cache key and the scrape provider agree on what was searched —
  // narrow and broad results cache separately for free.
  if (attributes._narrowQuery && String(attributes._narrowQuery).trim()) {
    return String(attributes._narrowQuery).trim();
  }
  // Prefer the model's dedicated broad comp query (best recall for pricing).
  if (attributes.comp_query && String(attributes.comp_query).trim()) {
    return String(attributes.comp_query).trim();
  }
  const kws = attributes.search_keywords;
  if (Array.isArray(kws) && kws.length && kws[0]) return String(kws[0]).trim();

  const parts = [];
  if (attributes.resembles_brand && attributes.resembles_brand !== 'unclear') {
    parts.push(attributes.resembles_brand);
  }
  if (attributes.subcategory) parts.push(attributes.subcategory);
  else if (attributes.category) parts.push(attributes.category);
  return parts.join(' ').trim();
}

// ---- narrow exact-identity query (docs/VISION-MATCHING-CHANGES §B) ----
// The broad comp_query is deliberately generic ("many comparable sales"), so an
// IDENTICAL sold listing is never targeted. This builds the exact-match query
// from the identity fields vision now extracts: brand + model, or — the niche-
// brand lever — the literal text seen on the item ("ISOKNOCK"). Returns null
// when extraction didn't capture enough identity to be meaningfully narrower
// than the broad query; callers then go straight to the broad tier.
function buildNarrowQueryText(attributes = {}) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const words = (s) => clean(s).split(' ').filter(Boolean);
  // Keep first occurrence of each word (case-insensitive) so "Carhartt" +
  // "Carhartt Detroit Jacket" doesn't double up.
  const dedupe = (toks) => {
    const seen = new Set();
    return toks.filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  // Twin of ui/main.js primaryBrand(): legacy/hand-typed collab strings still
  // carry "A x B" — search under the primary label only.
  const brandRaw = clean(attributes.resembles_brand).split(/\s+[x×]\s+/i)[0].trim();
  const brand = /^unclear$/i.test(brandRaw) ? '' : brandRaw;
  const model = clean(attributes.model);
  // Cap verbatim tag/graphic text — Algolia ANDs query words, so a long
  // transcription would match nothing and defeat the tier.
  const visible = words(attributes.visible_text).slice(0, 6);
  const distinctive = clean(
    Array.isArray(attributes.distinctive_features) ? attributes.distinctive_features[0] : ''
  );
  const subcat = clean(attributes.subcategory);

  // Niche-brand path: no recognized brand, but literal text on the item — the
  // words on the tag ARE the search term (the Isoknock case).
  if (!brand) {
    if (!visible.length) return null;
    return dedupe([...visible, ...words(subcat)]).join(' ');
  }

  if (model) return dedupe([...words(brand), ...words(model)]).join(' ');

  // Visible text that says more than the brand name itself (a style/graphic
  // name printed on the piece) → brand + those words.
  const brandWords = new Set(words(brand).map((w) => w.toLowerCase()));
  const extraText = visible.filter((w) => !brandWords.has(w.toLowerCase()));
  if (extraText.length) return dedupe([...words(brand), ...extraText]).join(' ');

  if (distinctive) return dedupe([...words(brand), ...words(subcat), ...words(distinctive)]).join(' ');

  return null; // brand alone ≈ the broad tier already
}

// Narrow-first comp lookup (§B): run the exact-identity query WITHOUT Algolia's
// removeWordsIfNoResults broadening; if it returns ≥ minSold sold hits, those
// near-identical sales ARE the comps (range.js's exact-match tier then prices
// off them). Otherwise fall back to the current broad query. Works through any
// provider — pass the GUARDED provider so both tiers get the cache, the
// rate-limit pacing, and the §8.1 circuit breaker (never call around it).
const NARROW_MIN_SOLD = 3;
async function getCompsTiered(provider, attributes = {}, opts = {}) {
  const minSold = opts.minSold ?? NARROW_MIN_SOLD;
  const narrowQuery = buildNarrowQueryText(attributes);
  if (narrowQuery) {
    const res = await provider.getComps({ ...attributes, _narrowQuery: narrowQuery });
    const sold = (res.comps || []).filter((c) => c && c.sold !== false && c.price > 0);
    if (sold.length >= minSold) {
      return {
        ...res,
        tier: 'narrow',
        narrowQuery,
        range: res.range ? { ...res.range, compTier: 'narrow', narrowQuery } : res.range,
      };
    }
  }
  const broad = await provider.getComps(attributes);
  return {
    ...broad,
    tier: 'broad',
    narrowQuery,
    range: broad.range ? { ...broad.range, compTier: 'broad' } : broad.range,
  };
}

// One bounded retry with backoff for the scrape fetch (security review
// 2026-07-17, flaw #2): a transient 5xx/DNS/timeout blip should not silently
// leave an item with no comps and no price. Retries network errors and 5xx
// only — a 4xx (bad key, bad request) is deterministic and returned as-is.
// `fetchImpl` is injectable so the retry logic is unit-testable offline.
async function fetchWithRetry(url, opts = {}, { retries = 1, backoffMs = 800, fetchImpl = fetch } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(url, opts);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

class GrailedScrapeProvider extends PriceCompProvider {
  constructor(config = {}) {
    super();
    this.appId = config.appId || process.env.GRAILED_ALGOLIA_APP_ID || 'MNRWEFSS2Q';
    this.apiKey = config.apiKey || process.env.GRAILED_ALGOLIA_KEY || null;
    // Index name and host are Grailed-frontend details that can change; override via env.
    // Listing_sold_production is the SOLD-listings index (verified) — the right source
    // for price comps. Listing_production / Listing_by_date_added_production are the
    // ACTIVE-listing indexes (asking prices, not sold).
    this.index = config.index || process.env.GRAILED_ALGOLIA_INDEX || 'Listing_sold_production';
    this.host = config.host || process.env.GRAILED_ALGOLIA_HOST || `${this.appId.toLowerCase()}-dsn.algolia.net`;
    this.hitsPerPage = config.hitsPerPage || 40;
    this.timeoutMs = config.timeoutMs || 12_000;
  }

  async getComps(attributes = {}) {
    if (!this.apiKey) {
      throw new Error(
        'GRAILED_ALGOLIA_KEY is not set. Grailed uses Algolia for search; the public ' +
          'search key is in the frontend. To get it: open grailed.com, run a search, and in ' +
          'DevTools → Network find the request to *.algolia.net and copy the x-algolia-api-key ' +
          'header. Then export GRAILED_ALGOLIA_KEY=<key>. (Or use MockCompProvider to test the pipeline.)'
      );
    }
    const query = buildQueryText(attributes);
    // The narrow tier must stay EXACT: zero hits means "no identical sale
    // found — fall back to broad", not "quietly broaden the words" (which is
    // what made identical sales unfindable in the first place).
    const narrow = Boolean(attributes._narrowQuery);
    const params = new URLSearchParams({
      query,
      hitsPerPage: String(this.hitsPerPage),
      // Broad tier: if the full query matches nothing, retry with all words
      // optional so an over-specific query still returns the closest comps.
      ...(narrow ? {} : { removeWordsIfNoResults: 'allOptional' }),
    }).toString();

    // Per-attempt timeout: each retry gets its own AbortController so a
    // timed-out first attempt doesn't poison the retry's signal.
    const timedFetch = (u, o) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      return fetch(u, { ...o, signal: controller.signal }).finally(() => clearTimeout(timer));
    };
    const res = await fetchWithRetry(
      `https://${this.host}/1/indexes/*/queries`,
      {
        method: 'POST',
        headers: {
          'X-Algolia-Application-Id': this.appId,
          'X-Algolia-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{ indexName: this.index, params }],
        }),
      },
      { fetchImpl: timedFetch }
    );
    if (!res.ok) {
      throw new Error(`Grailed/Algolia search HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();

    const hits = (json.results && json.results[0] && json.results[0].hits) || [];
    // Verified against a live Listing_sold_production response: sold_price (USD),
    // sold_at (ISO) / sold_at_i (epoch seconds), id, sold.
    const toIso = (v) => {
      if (v == null) return null;
      const ms = typeof v === 'number' ? v * 1000 : Date.parse(v);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    };
    const comps = hits
      .map((h) => {
        const price = Number(h.sold_price || h.price || 0);
        const soldDate =
          toIso(h.sold_at) || toIso(h.sold_at_i) || toIso(h.created_at) || toIso(h.created_at_i);
        const id = h.id ?? h.objectID;
        return {
          price,
          soldDate,
          source: 'grailed',
          url: id ? `https://www.grailed.com/listings/${id}` : null,
          sold: Boolean(h.sold ?? (h.sold_price > 0)),
          title: h.title || undefined,
          condition: h.condition || undefined, // is_new | is_gently_used | is_used
          size: h.size || undefined,
        };
      })
      .filter((c) => Number.isFinite(c.price) && c.price > 0);

    return { comps, range: computeRange(comps, attributes) };
  }
}

// Deterministic synthetic comps for testing the pipeline without the live scrape.
// Derives a plausible base price from category and jitters it reproducibly.
class MockCompProvider extends PriceCompProvider {
  constructor(config = {}) {
    super();
    this.count = config.count || 24;
  }

  async getComps(attributes = {}) {
    const base =
      {
        outerwear: 180,
        footwear: 140,
        tops: 70,
        bottoms: 90,
        accessories: 60,
        tailoring: 150,
      }[String(attributes.category || '').toLowerCase()] || 100;

    // reproducible pseudo-random from a string seed (no Math.random → stable output)
    const seedStr = buildQueryText(attributes) || 'item';
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const now = Date.now();
    const comps = [];
    for (let i = 0; i < this.count; i++) {
      const mult = 0.55 + rand() * 1.1; // 0.55x – 1.65x spread
      const price = Math.round(base * mult);
      const ageDays = Math.round(rand() * 300);
      comps.push({
        price,
        soldDate: new Date(now - ageDays * 86_400_000).toISOString(),
        source: 'mock',
        url: `https://example.invalid/mock/${i}`,
        sold: true,
      });
    }
    // inject a couple of outliers to exercise the IQR filter
    comps.push({ price: Math.round(base * 6), soldDate: new Date(now).toISOString(), source: 'mock', url: null, sold: true });

    return { comps, range: computeRange(comps, attributes) };
  }
}

module.exports = {
  PriceCompProvider,
  GrailedScrapeProvider,
  MockCompProvider,
  buildQueryText,
  buildNarrowQueryText,
  getCompsTiered,
  fetchWithRetry,
  NARROW_MIN_SOLD,
};
