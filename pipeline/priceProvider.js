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
    const params = new URLSearchParams({
      query,
      hitsPerPage: String(this.hitsPerPage),
      // If the full query matches nothing, retry with all words optional so an
      // over-specific query still returns the closest comps instead of zero.
      removeWordsIfNoResults: 'allOptional',
    }).toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let json;
    try {
      const res = await fetch(`https://${this.host}/1/indexes/*/queries`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-Algolia-Application-Id': this.appId,
          'X-Algolia-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{ indexName: this.index, params }],
        }),
      });
      if (!res.ok) {
        throw new Error(`Grailed/Algolia search HTTP ${res.status} ${res.statusText}`);
      }
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

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

module.exports = { PriceCompProvider, GrailedScrapeProvider, MockCompProvider, buildQueryText };
