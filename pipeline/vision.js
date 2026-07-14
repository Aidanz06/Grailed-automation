/*
 * Vision attribute extraction (PRD §5.3, stage 1).
 * One Claude vision call per item — all of the item's photos in a single
 * message (not pairwise), for cost/latency control.
 *
 * Everything is framed as "resembles / appears", never a confirmed
 * identification (PRD §8.8). The structured schema enforces that framing.
 *
 * Uses the official Anthropic SDK, model claude-opus-4-8 (override with
 * ATTRIBUTE_MODEL), adaptive thinking, and structured outputs so the response
 * is guaranteed-valid JSON.
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = process.env.ATTRIBUTE_MODEL || 'claude-opus-4-8';
// Build output_config so the `effort` knob is omitted for models that reject it
// (Haiku 4.5 → 400). Lets ATTRIBUTE_MODEL be set to a cheaper model without breaking.
const { outputConfig, thinkingConfig } = require('./cluster');

// Grailed's fixed "Style" dropdown options come from grailed-selectors.json
// (the selectors file stays the single source — never hardcode them here).
// "None" is a form choice, not an estimate; "Unclear" is the model's out.
const GRAILED_STYLE_OPTIONS = (() => {
  try {
    const sel = require('../grailed-selectors.json');
    const opts = (sel.dropdowns?.style?.options || []).filter((o) => o !== 'None');
    if (opts.length) return opts;
  } catch {}
  return ['Luxury', 'Vintage', 'Avant-Garde', 'Streetwear', 'Workwear', 'Gorpcore', 'Sportswear', 'Basics', 'Western'];
})();

const MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Structured-output schema. All fields required + additionalProperties:false
// (structured-output requirement). No numeric min/max constraints — unsupported.
const ATTRIBUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resembles_brand: {
      type: 'string',
      description:
        'Brand the item most resembles, or "unclear". Phrase as resemblance, never confirmed identity.',
    },
    brand_confidence: {
      type: 'number',
      description: 'Confidence 0.0–1.0 that the resembled brand is correct.',
    },
    category: {
      type: 'string',
      description: 'Top-level Grailed category, e.g. outerwear, tops, bottoms, footwear.',
    },
    subcategory: {
      type: 'string',
      description: 'More specific type, e.g. "denim jacket", "hoodie". "" if unclear.',
    },
    primary_color: { type: 'string' },
    secondary_colors: { type: 'array', items: { type: 'string' } },
    materials: {
      type: 'array',
      items: { type: 'string' },
      description: 'Materials the item appears to be made of (best guess from visual texture).',
    },
    era_style: {
      type: 'string',
      description: 'Era / style the piece resembles, e.g. "y2k", "90s workwear", "modern minimal".',
    },
    grailed_style_estimate: {
      type: 'string',
      enum: [...GRAILED_STYLE_OPTIONS, 'Unclear'],
      description:
        'Which of Grailed\'s fixed "Style" categories the piece best fits, judged from the photos ' +
        '(silhouette, branding, fabric, styling cues). Pick the single best fit; choose "Unclear" ' +
        'when none clearly applies — never force a weak match.',
    },
    condition_rating: {
      type: 'string',
      enum: ['New with tags', 'Gently used', 'Used', 'Unclear'],
      description:
        'Overall visible condition, decided by these rules (plan §D — a new garment mis-rated "Used" ' +
        'drags both the copy and the price): choose "New with tags" when retail/hang tags are visibly ' +
        'ATTACHED, or the garment is clearly unworn/deadstock (crisp folds, pristine fabric, no wear ' +
        'anywhere). Choose "Used" ONLY when the photos show actual wear evidence (fading, pilling, ' +
        'stains, stretched cuffs, sole wear…). "Gently used" = worn but near-new with only trivial ' +
        'signs. If the photos are genuinely ambiguous, choose "Unclear" — NEVER default to "Used" ' +
        'just because the item is second-hand listing stock.',
    },
    condition_markers: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Specific visible condition evidence — BOTH directions: wear (fading, pilling, stains, holes, ' +
        'scuffs) AND newness signals (hang tags attached, size sticker, deadstock crispness). ' +
        'Empty if none visible.',
    },
    size: {
      type: 'string',
      description:
        'The size if legible on a tag or clearly indicated (e.g. "M", "L", "XL", "32", "10.5"). ' +
        'Use "" if not visible. Do not guess from fit.',
    },
    search_keywords: {
      type: 'array',
      items: { type: 'string' },
      description: '3–6 concise terms to search comparable listings (brand, category, era, distinctive features).',
    },
    comp_query: {
      type: 'string',
      description:
        'A SHORT search query (3–5 words) for finding comparable SOLD listings to price this item. ' +
        'Include the price-defining essentials: brand + team/model/line + item type + any variant/edition ' +
        'that materially changes price (e.g. kit type "home"/"away" for jerseys, colorway/"OG" for sneakers). ' +
        'Examples: "Nike FC Barcelona home jersey", "Nike Air Max 90 infrared", "Carhartt Detroit jacket". ' +
        'EXCLUDE qualifiers that shrink the result set without moving price much: specific year/season, player ' +
        'name/number, size, and condition. Aim for many comparable sales, not an exact match.',
    },
    notes: {
      type: 'string',
      description: 'Brief caveats: what is uncertain, what is not visible, anything a human should verify.',
    },
  },
  required: [
    'resembles_brand',
    'brand_confidence',
    'category',
    'subcategory',
    'primary_color',
    'secondary_colors',
    'materials',
    'era_style',
    'grailed_style_estimate',
    'condition_rating',
    'condition_markers',
    'size',
    'search_keywords',
    'comp_query',
    'notes',
  ],
};

const SYSTEM_PROMPT = [
  'You are a resale cataloging assistant analyzing photos of a single second-hand clothing item.',
  'Describe only what is visibly evidenced in the photos. Never assert a confirmed brand or authenticity —',
  'always frame brand as what the item RESEMBLES, and set brand_confidence accordingly (low when a logo/tag is not clearly legible).',
  'If you cannot tell, use "unclear" rather than guessing confidently.',
  'Condition is evidence-based, not assumed: attached retail tags or a clearly unworn garment → "New with tags";',
  '"Used" requires VISIBLE wear; when ambiguous say "Unclear" — never default to "Used".',
  'You are identifying probable style/brand for pricing research, not authenticating.',
].join(' ');

function imageBlock(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image type "${ext}" for ${filePath} (use jpg/png/webp/gif)`);
  }
  const data = fs.readFileSync(filePath).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

/**
 * Extract structured attributes for ONE item from its photo(s).
 * @param {string[]} photoPaths - absolute or relative paths to the item's images
 * @param {object} [opts] - { client, model }
 * @returns {Promise<object>} validated attributes matching ATTRIBUTE_SCHEMA
 */
async function extractAttributes(photoPaths, opts = {}) {
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) {
    throw new Error('extractAttributes requires at least one photo path');
  }
  const client = opts.client || new Anthropic(); // reads ANTHROPIC_API_KEY
  const model = opts.model || DEFAULT_MODEL;

  // Full-res phone photos 413 the API (~5 MB/image, ~32 MB/request caps) — the
  // grouping call downscales but this one didn't, so a real shoot's first
  // auto-accepted group blew up here. Reuse the same adaptive ladder, starting
  // at 1568px (the API's optimal long edge) so tag/label text stays legible.
  // Lazy require: groupingStrategy ↔ cluster already form a load cycle.
  const { prepareBatchImages } = require('./groupingStrategy');
  const { temps } = await prepareBatchImages(photoPaths, { maxEdge: 1568, quality: 82 });
  try {
    const content = [
      ...temps.map(imageBlock),
      {
        type: 'text',
        text:
          'These are photos of one item. Extract its attributes for resale pricing research. ' +
          'Remember: resemblance, not confirmed identity. Fill every field.',
      },
    ];

    const resp = await client.messages.create({
      model,
      max_tokens: 4000,
      ...thinkingConfig(model), // adaptive on Opus/Sonnet; omitted on Haiku (400s)
      output_config: outputConfig(model, ATTRIBUTE_SCHEMA, 'medium'),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    if (resp.stop_reason === 'refusal') {
      throw new Error('Attribute extraction was refused by the safety system.');
    }
    const textBlock = resp.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text block in model response.');
    return JSON.parse(textBlock.text);
  } finally {
    for (const t of temps) { try { fs.unlinkSync(t); } catch {} }
  }
}

module.exports = { extractAttributes, ATTRIBUTE_SCHEMA, DEFAULT_MODEL };
