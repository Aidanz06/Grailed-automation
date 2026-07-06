/*
 * Batch photo intake & sorting (PRD §5.1).
 * A folder of photos from one shoot (several items, many angles) → per-item groups.
 *
 * Two-stage, cost-controlled:
 *   1. describePhoto(): ONE cheap vision call per photo → a compact descriptor
 *      (garment type, colors, visible text/brand, signature, multi-item flag).
 *      Not pairwise — O(n) calls, not O(n^2).
 *   2. clusterPhotos(): PURE code. Combines timestamp adjacency (sequential shots of
 *      one item cluster cheaply) with visual similarity of the descriptors (catches
 *      out-of-order shots). Greedy, deterministic.
 *
 * High-confidence groups auto-accept; low-confidence groups are flagged for review;
 * photos that appear to contain multiple garments are flagged individually rather
 * than forced into a cluster.
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = process.env.CLUSTER_MODEL || 'claude-opus-4-8';
const MEDIA_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const JOIN_THRESHOLD = 0.5; // min similarity to join an existing group
const LOW_CONFIDENCE = 0.6; // group mean-similarity below this → flag for review
const TIME_GAP_S = 180; // shots within this gap get a small "same session" boost

const DESCRIPTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_clothing: { type: 'boolean', description: 'Whether the photo shows a wearable clothing/footwear/accessory item.' },
    garment_type: { type: 'string', description: 'Short type, e.g. "hoodie", "soccer jersey", "sneaker", "denim jacket". "" if unclear.' },
    colors: { type: 'array', items: { type: 'string' }, description: '1–3 dominant colors.' },
    visible_text: { type: 'string', description: 'Any legible brand/graphic/text on the item (e.g. "Supreme", "DHL", "Barcelona"). "" if none.' },
    signature: { type: 'string', description: 'One short distinctive phrase identifying THIS specific item (e.g. "black ASSC DHL hoodie", "Barcelona Lewandowski home jersey").' },
    contains_multiple_items: { type: 'boolean', description: 'True if the photo clearly shows more than one distinct garment.' },
  },
  required: ['is_clothing', 'garment_type', 'colors', 'visible_text', 'signature', 'contains_multiple_items'],
};

const SYSTEM = 'You produce a terse visual descriptor of one resale photo, used only to group photos of the same item together. Describe what you see; do not identify brands you cannot read.';

function imageBlock(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`Unsupported image type "${ext}" for ${filePath}`);
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: fs.readFileSync(filePath).toString('base64') } };
}

// The `effort` output-config knob is an Opus/Sonnet feature; Haiku 4.5 rejects it
// (400 invalid_request_error). Build output_config so it's omitted for models that
// don't support it, letting the same descriptor call run on Haiku for cost/latency.
function supportsEffort(model) { return !/haiku/i.test(String(model || '')); }
function outputConfig(model, schema, effort) {
  const oc = { format: { type: 'json_schema', schema } };
  if (supportsEffort(model) && effort) oc.effort = effort;
  return oc;
}
// Haiku 4.5 likewise 400s on `thinking: { type: 'adaptive' }` ("adaptive
// thinking is not supported on this model" — probed live 2026-07-04). Callers
// spread thinkingConfig(model) into the request instead of hardcoding it.
function supportsThinking(model) { return !/haiku/i.test(String(model || '')); }
function thinkingConfig(model) { return supportsThinking(model) ? { thinking: { type: 'adaptive' } } : {}; }

async function describePhoto(filePath, opts = {}) {
  const client = opts.client || new Anthropic();
  const model = opts.model || DEFAULT_MODEL;
  // Anthropic caps each image at ~5 MB of base64 — a single full-res phone photo
  // can exceed that alone (413). Downscale only oversized files so the
  // benchmarked path is byte-identical for normal ones. Lazy require: avoids the
  // cluster ↔ groupingStrategy load cycle.
  let sendPath = filePath;
  let tmp = null;
  if ((fs.statSync(filePath).size * 4) / 3 > 4.5e6) {
    const { downscaleToTemp } = require('./groupingStrategy');
    tmp = await downscaleToTemp(filePath, { maxEdge: 1568, quality: 82 });
    sendPath = tmp;
  }
  let resp;
  try {
    resp = await client.messages.create({
      model,
      max_tokens: 1200,
      output_config: outputConfig(model, DESCRIPTOR_SCHEMA, 'low'),
      system: SYSTEM,
      messages: [{ role: 'user', content: [imageBlock(sendPath), { type: 'text', text: 'Describe this photo for grouping.' }] }],
    });
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch {} }
  }
  const t = resp.content.find((b) => b.type === 'text');
  const d = JSON.parse(t.text);
  d.file_path = filePath;
  let mtime = 0;
  try { mtime = fs.statSync(filePath).mtimeMs; } catch {}
  d.timestamp = mtime;
  // Carry token usage so the harness can report real $/batch (non-enumerable-ish helper field).
  d.__usage = { input_tokens: resp.usage?.input_tokens || 0, output_tokens: resp.usage?.output_tokens || 0 };
  return d;
}

// concurrency-limited map so we don't fan out unbounded API calls
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const tok = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1));
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function similarity(a, b) {
  const garment = a.garment_type && b.garment_type && a.garment_type.toLowerCase() === b.garment_type.toLowerCase() ? 1 : 0;
  const colorSim = jaccard(tok(a.colors.join(' ')), tok(b.colors.join(' ')));
  const textSim = jaccard(tok(`${a.visible_text} ${a.signature}`), tok(`${b.visible_text} ${b.signature}`));
  let sim = 0.5 * garment + 0.2 * colorSim + 0.3 * textSim;
  if (a.timestamp && b.timestamp && Math.abs(a.timestamp - b.timestamp) / 1000 <= TIME_GAP_S) sim += 0.1; // same-session boost
  return Math.min(1, sim);
}

/**
 * Pure clustering over descriptors. Returns groups with a confidence and flags.
 */
function clusterPhotos(descriptors) {
  const ordered = [...descriptors].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const groups = [];

  for (const d of ordered) {
    // A photo showing multiple garments can't define a single item — its own flagged group.
    if (d.contains_multiple_items) {
      groups.push({ members: [d], confidence: 0, flags: ['multi_item_photo'] });
      continue;
    }
    let best = null;
    let bestSim = 0;
    for (const g of groups) {
      if (g.flags.includes('multi_item_photo')) continue;
      const sim = Math.max(...g.members.map((m) => similarity(d, m)));
      if (sim > bestSim) { bestSim = sim; best = g; }
    }
    if (best && bestSim >= JOIN_THRESHOLD) best.members.push(d);
    else groups.push({ members: [d], confidence: 1, flags: [] });
  }

  // score each group by mean pairwise similarity, flag weak ones
  for (const g of groups) {
    if (g.flags.includes('multi_item_photo')) continue;
    if (g.members.length === 1) { g.confidence = 0.75; continue; } // singletons: plausible but unconfirmed
    let sum = 0, n = 0;
    for (let i = 0; i < g.members.length; i++)
      for (let j = i + 1; j < g.members.length; j++) { sum += similarity(g.members[i], g.members[j]); n++; }
    g.confidence = n ? Number((sum / n).toFixed(3)) : 1;
    if (g.confidence < LOW_CONFIDENCE) g.flags.push('low_confidence_group');
  }

  return groups.map((g, i) => ({
    groupId: i + 1,
    photos: g.members.map((m) => m.file_path),
    signature: g.members[0].signature,
    confidence: g.confidence,
    autoAccept: g.flags.length === 0 && g.confidence >= LOW_CONFIDENCE,
    flags: g.flags,
  }));
}

// Default clustering strategy for groupBatch. Measured winner on the live 36-photo /
// 9-item benchmark (see docs/clustering-optimization-results.md): batched-vision scored
// P=1.00, R=1.00, 9/9 items exact, 0 wrong auto-accepts, one API call, ~4x cheaper than
// per-photo descriptors. 'descriptor-improved' is the safe fallback (perfect precision but
// fragments on real descriptors, R~0.59). Override per-call with opts.strategyName /
// opts.strategy, or globally with $GROUPING_STRATEGY.
const DEFAULT_STRATEGY = process.env.GROUPING_STRATEGY || 'batched-vision';

async function groupBatch(folder, opts = {}) {
  const files = fs
    .readdirSync(folder)
    .filter((f) => MEDIA_TYPES[path.extname(f).toLowerCase()])
    .map((f) => path.join(folder, f));
  if (!files.length) throw new Error(`No images found in ${folder}`);

  const stratName = opts.strategyName || DEFAULT_STRATEGY;
  // Best-effort progress hook (UI progress bar) — listener errors never break grouping.
  const notify = (p) => { if (typeof opts.onProgress === 'function') { try { opts.onProgress(p); } catch {} } };

  // Fast path: the original baseline needs no strategy module and behaves identically.
  if (!opts.strategy && (stratName === 'baseline' || stratName === 'descriptor-baseline')) {
    let described = 0;
    const descriptors = await mapLimit(files, opts.concurrency || 4, async (f) => {
      const d = await describePhoto(f, opts);
      notify({ phase: 'describe', done: ++described, total: files.length });
      return d;
    });
    return { photoCount: files.length, groups: clusterPhotos(descriptors), descriptors };
  }

  // Otherwise delegate to a GroupingStrategy provider (lazy require avoids a load cycle).
  const { makeGroupingStrategy } = require('./groupingStrategy');
  const strategy =
    opts.strategy && typeof opts.strategy.group === 'function'
      ? opts.strategy
      : makeGroupingStrategy(stratName, opts);

  // Automatic fallback (integration plan P0.2/P0.3): batched-vision can fail as a
  // unit — API error, 413 on a huge shoot, malformed JSON, SHOOT_TOO_LARGE guard.
  // Rather than surfacing an unhandled rejection to the app, retry once with the
  // per-photo fallback strategy (no single-request cap, no new keys). meta records
  // that the fallback ran so the UI can say so. Disable with fallbackStrategyName:false.
  const fbName = opts.fallbackStrategyName === undefined ? 'descriptor-improved' : opts.fallbackStrategyName;
  let result;
  try {
    result = await strategy.group(files, opts);
  } catch (primaryErr) {
    const canFallback = fbName && !opts.strategy && stratName.toLowerCase() !== String(fbName).toLowerCase();
    if (!canFallback) throw primaryErr;
    (opts.log || console.error)(
      `[cluster] ${stratName} failed (${primaryErr.message}) — falling back to ${fbName}`
    );
    notify({ phase: 'fallback', from: stratName, to: fbName });
    try {
      result = await makeGroupingStrategy(fbName, opts).group(files, opts);
      result.meta = { ...(result.meta || {}), fallbackFrom: stratName, fallbackReason: primaryErr.message };
    } catch (fallbackErr) {
      throw new Error(
        `Photo grouping failed: ${stratName} (${primaryErr.message}); fallback ${fbName} (${fallbackErr.message})`
      );
    }
  }
  const { groups, features, meta } = result;
  return { photoCount: files.length, groups, descriptors: features, meta };
}

module.exports = {
  describePhoto, clusterPhotos, groupBatch, similarity, DESCRIPTOR_SCHEMA,
  // shared primitives reused by the GroupingStrategy providers + harness
  imageBlock, mapLimit, MEDIA_TYPES, jaccard, tok,
  supportsEffort, outputConfig, supportsThinking, thinkingConfig,
  JOIN_THRESHOLD, LOW_CONFIDENCE, TIME_GAP_S, DEFAULT_STRATEGY,
};
