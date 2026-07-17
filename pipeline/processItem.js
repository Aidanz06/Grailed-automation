/*
 * Per-item pipeline (shared by the single-item CLI and the batch runner).
 * photos of ONE item → { attributes, content, range, comps }.
 *
 * Keeping this in one place means the single-item flow and the batch flow can't
 * drift. The batch runner passes in a SHARED comp provider so one cache +
 * rate-limiter + circuit-breaker spans the whole batch.
 */

const { extractAttributes } = require('./vision');
const { GrailedScrapeProvider, MockCompProvider, getCompsTiered } = require('./priceProvider');
const { GuardedCompProvider } = require('./compGuard');
const { generateContent } = require('./content');

// Choose + construct a comp provider. Live Grailed is guarded (cache/rate-limit/
// breaker); falls back to mock (with a warning) when the search key is absent.
function makeCompProvider(opts = {}, log = console.error) {
  if (opts.mock || opts.comps === 'mock') return { provider: new MockCompProvider(), providerName: 'mock' };
  if (!process.env.GRAILED_ALGOLIA_KEY) {
    log('[warn] GRAILED_ALGOLIA_KEY not set — using MockCompProvider. Set the key or pass --mock.');
    return { provider: new MockCompProvider(), providerName: 'mock (fallback)' };
  }
  return { provider: new GuardedCompProvider(new GrailedScrapeProvider()), providerName: 'grailed (guarded)' };
}

async function processItem(photos, opts = {}) {
  const log = opts.log || ((m) => console.error(m));
  const tag = opts.label ? `${opts.label} ` : '';

  log(`${tag}extracting attributes (${photos.length} photo(s))…`);
  const attributes = await extractAttributes(photos, { model: opts.model });

  const { provider, providerName } = opts.provider
    ? { provider: opts.provider, providerName: opts.providerName || 'grailed (guarded)' }
    : makeCompProvider(opts, log);

  log(`${tag}fetching comps (${providerName})…`);
  let comps = [];
  let range = null;
  try {
    // Narrow-first (§B): target an identical sale before broadening. Both
    // tiers go through the same (guarded) provider — cache/pacing/breaker hold.
    const res = await getCompsTiered(provider, attributes);
    ({ comps, range } = res);
    if (res.tier === 'narrow') log(`${tag}narrow comp match: "${res.narrowQuery}" (${comps.length} hits)`);
  } catch (err) {
    log(`${tag}[warn] comp lookup failed: ${err.message}`);
    range = { low: null, median: null, high: null, sampleSize: 0, note: 'comp lookup failed' };
  }

  let content = null;
  if (opts.content !== false) {
    log(`${tag}generating content…`);
    try {
      content = await generateContent(attributes, {
        model: opts.model,
        instructions: opts.note,
      });
    } catch (err) {
      log(`${tag}[warn] content generation failed: ${err.message}`);
    }
  }

  return { photos, compProvider: providerName, attributes, content, range, comps };
}

module.exports = { processItem, makeCompProvider };
