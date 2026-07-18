/*
 * Comp-path hardening (PRD §8.1). Wraps any PriceCompProvider with:
 *   - Disk cache of raw comps keyed by (index + query), TTL'd — so repeat/near-repeat
 *     lookups don't re-hit Grailed. Range is recomputed per item from cached comps
 *     (range depends on the item's condition/size, comps don't).
 *   - Rate limiting: a minimum human-paced interval between LIVE calls, persisted to
 *     disk so it holds across separate CLI runs, with jitter. Query patterns should
 *     look nothing like bulk scraping.
 *   - Circuit breaker: if the account is flagged, drop `data/CIRCUIT_OPEN` (or set
 *     RESALE_CIRCUIT_OPEN=1) and every live scrape refuses immediately — fall back to
 *     manual, rather than continuing to probe the boundary.
 *
 * Cache hits bypass BOTH the rate limit and the circuit breaker (no network touched).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { computeRange } = require('./range');
const { buildQueryText } = require('./priceProvider');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_CACHE_DIR = process.env.COMP_CACHE_DIR || path.join(DATA_DIR, 'comp-cache');
const CIRCUIT_FILE = process.env.COMP_CIRCUIT_FILE || path.join(DATA_DIR, 'CIRCUIT_OPEN');
const LAST_CALL_FILE = path.join(DATA_DIR, '.comp-last-call');

const DEFAULT_TTL_MS = Number(process.env.COMP_CACHE_TTL_MS || 24 * 60 * 60 * 1000); // 24h
const DEFAULT_MIN_INTERVAL_MS = Number(process.env.COMP_MIN_INTERVAL_MS || 4000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isCircuitOpen() {
  return process.env.RESALE_CIRCUIT_OPEN === '1' || fs.existsSync(CIRCUIT_FILE);
}
function tripCircuit(reason = 'manual') {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CIRCUIT_FILE, `${new Date().toISOString()} ${reason}\n`);
}
function resetCircuit() {
  try { fs.unlinkSync(CIRCUIT_FILE); } catch {}
}

class GuardedCompProvider {
  constructor(inner, config = {}) {
    this.inner = inner;
    this.cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  _cacheKey(attributes) {
    const idx = this.inner.index || 'default';
    const q = buildQueryText(attributes).toLowerCase();
    const h = crypto.createHash('sha1').update(`${idx}|${q}`).digest('hex').slice(0, 16);
    return { q, path: path.join(this.cacheDir, `${h}.json`) };
  }

  _readCache(file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - raw.fetchedAt <= this.ttlMs) return raw;
    } catch {}
    return null;
  }

  async _throttle() {
    let last = 0;
    try { last = Number(fs.readFileSync(LAST_CALL_FILE, 'utf8')) || 0; } catch {}
    const since = Date.now() - last;
    if (since < this.minIntervalMs) {
      // True randomness, not derived from the previous timestamp — a
      // deterministic "jitter" defeats the human-pacing intent (§8.1).
      const jitter = Math.floor(Math.random() * this.minIntervalMs * 0.4);
      await sleep(this.minIntervalMs - since + jitter);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LAST_CALL_FILE, String(Date.now()));
  }

  async getComps(attributes = {}) {
    const { q, path: cacheFile } = this._cacheKey(attributes);

    const cached = this._readCache(cacheFile);
    if (cached) {
      return { comps: cached.comps, range: computeRange(cached.comps, attributes), cached: true, query: q };
    }

    if (isCircuitOpen()) {
      throw new Error(
        'Comp circuit breaker is OPEN — live scraping disabled (see PRD §8.1). ' +
          'Remove data/CIRCUIT_OPEN (or unset RESALE_CIRCUIT_OPEN) to re-enable.'
      );
    }

    await this._throttle();
    const { comps } = await this.inner.getComps(attributes);
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), query: q, comps }));
    } catch {}
    return { comps, range: computeRange(comps, attributes), cached: false, query: q };
  }
}

module.exports = { GuardedCompProvider, isCircuitOpen, tripCircuit, resetCircuit, CIRCUIT_FILE };
