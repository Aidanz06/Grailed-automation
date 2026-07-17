/*
 * Listing content generation (PRD §5.2).
 * Turns extracted attributes into a Grailed-style title, a measurement-forward
 * description, and up to 10 tags. Output is a SUGGESTION for the sidebar to edit
 * (PRD §4/§5.4) — never written to Grailed directly.
 *
 * Guardrails (PRD §8.8, CLAUDE.md):
 *   - Never claim or imply authenticity ("100% authentic", "guaranteed real", etc.).
 *   - If brand is "unclear" or brand_confidence is low, do NOT state the brand as
 *     fact — describe generically or hedge.
 *   - Measurements are NOT known from photos — never invent numbers, and the
 *     body carries NO measurements section at all (owner decisions 2026-07-12/
 *     14: measurements go through Grailed's own listing fields, never the
 *     description; the app doesn't collect them).
 *
 * Uses the Anthropic SDK, model claude-opus-4-8 (override via CONTENT_MODEL),
 * adaptive thinking, and structured outputs.
 */

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = process.env.CONTENT_MODEL || 'claude-opus-4-8';
// Conditional output_config so `effort` is omitted for models that reject it
// (Haiku 4.5 → 400), letting CONTENT_MODEL point at a cheaper model.
const { outputConfig, thinkingConfig } = require('./cluster');

const CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description:
        'Grailed-style listing title, SHORT (under 7 words): the item + era/notable feature/model, ' +
        'WITHOUT the designer/brand name — the brand goes in Grailed\'s designer field, so repeating ' +
        'it in the title is redundant (e.g. "Denim Jacket" or "Boxy Denim Jacket, FW18", NOT ' +
        '"Acne Studios Denim Jacket"). Sentence/Title case, no emojis, no keyword spam, no ALL CAPS.',
    },
    title_alternatives: {
      type: 'array',
      items: { type: 'string' },
      description:
        '1–2 alternate title options the seller can pick instead. Same rules: under 7 words, ' +
        'NO designer/brand name.',
    },
    description: {
      type: 'string',
      description:
        'Listing body in plain text with short lines/line breaks — SHORT and simple: a one-line ' +
        'overview, then a rating-based condition line (e.g. "Gently used condition."). Nothing ' +
        'else. Do NOT include a measurements section or blank placeholders — measurements live in ' +
        'Grailed\'s own listing fields, never the description. No price. No authenticity guarantees AND no authenticity ' +
        'disclaimers — never write "authenticity not verified" or similar in the listing body; ' +
        'that caveat belongs ONLY in the seller-facing `disclaimers` array.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Up to 10 lowercase tags, no "#". Brand/era/silhouette-first, then style/category/color. ' +
        'Only tags supported by the attributes — no invented specifics.',
    },
    disclaimers: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Short caveats the seller should verify before posting (e.g. brand uncertainty, authenticity ' +
        'not verified, add real measurements). Empty array if genuinely none.',
    },
    desc_parts: {
      type: 'object',
      additionalProperties: false,
      description:
        'The PROSE pieces the description template composes from (Description Styles Phase 1). You ' +
        'write ONLY these — constant text (footers, "Condition:" labels) is inserted by code, never ' +
        'by you. Each is a short standalone snippet (no headers, no labels). Use "" (empty string) ' +
        'where there is nothing factual to say — an empty part simply drops from the composed listing.',
      properties: {
        overview: { type: 'string', description: 'One-line item overview. Always present.' },
        condition_note: {
          type: 'string',
          description:
            'The SPECIFICS behind the condition rating as a short lowercase phrase that reads after ' +
            '"Condition: <rating>, " — e.g. "light fading at the cuffs", "unworn with tags attached". ' +
            'Do NOT repeat the rating itself. "" when there is nothing beyond the rating.',
        },
        fit: { type: 'string', description: 'A size/fit nuance worth stating (runs large, boxy cut). NOT a bare size. "" if nothing to say.' },
        flaws: {
          type: 'string',
          description:
            'Sale-relevant flaws ONLY (holes, stains, tears, broken hardware, significant ' +
            'fading/discoloration). NEVER trivia like lint, fuzz, stray threads, light creasing, ' +
            'or minor surface wear. "" if none.',
        },
      },
      required: ['overview', 'condition_note', 'fit', 'flaws'],
    },
  },
  required: ['title', 'title_alternatives', 'description', 'tags', 'disclaimers', 'desc_parts'],
};

const SYSTEM_PROMPT = [
  'You write listings for the resale marketplace Grailed from a structured description of one item.',
  'Follow Grailed conventions: short scannable titles, short objective descriptions, brand/era/silhouette-first tags.',
  'Hard rules:',
  '(1) NEVER mention authenticity in the listing text at all — no claims ("authentic", "guaranteed real", "100% legit") AND no disclaimers ("authenticity not verified", "cannot guarantee authenticity"). Authenticity caveats go ONLY in the `disclaimers` array, which the seller sees privately.',
  '(2) If the brand is "unclear" or brand_confidence is low (< ~0.6), do NOT state the brand as fact — describe it generically or hedge ("appears to be", "unbranded/unknown").',
  '(3) You do NOT know measurements — never invent them, and never include a measurements section or blank placeholders anywhere; measurements are handled through Grailed\'s own measurements fields on the listing, never the description.',
  '(4) State ONLY facts present in the input attributes. NEVER introduce a color, colorway, material, collaboration, era, or feature that is not given — if an attribute is unknown or low-confidence, omit it entirely; never guess. The item\'s color is exactly what `primary_color`/`secondary_colors` say (a black item must never be described as red/white).',
  '(5) The title contains NO designer/brand name — the brand fills Grailed\'s separate designer field. Title = item + era/notable feature/model, under 7 words. Same for every title alternative.',
  '(6) Objective tone only — this is plain product description, not marketing. BANNED: hype and subjective filler such as "modern streetwear classic", "timeless", "must-have", "grail", "iconic", "versatile", "clean", "elevate your wardrobe", "wardrobe staple", "statement piece", "sought-after", "coveted", "effortless", and anything similar.',
  '(7) No cosmetic/wear adjectives in overview, materials, or fit (no "faded", "worn-in", "distressed" unless it is a GIVEN design attribute of the item). Real, sale-relevant flaws go ONLY in the `flaws` section; the condition line is rating-based ("Good used condition"), not a wear inventory.',
  '(8) Skip trivial cosmetic minutiae EVERYWHERE, including `flaws`: minor lint, fuzz, pilling, stray threads, light creasing, faint fading, small scuffs are NOT worth mentioning. Mention only defects a buyer would care about (holes, stains, tears, broken zips/hardware, heavy fading). When in doubt, leave it out — the condition rating already covers general wear.',
  'Everything you produce is an editable draft the seller reviews before posting.',
].join(' ');

/**
 * Generate listing content for one item from its extracted attributes.
 * @param {object} attributes - output of vision.extractAttributes
 * @param {object} [opts] - { client, model, instructions, styleExample }
 *   opts.instructions: optional steer for regeneration (e.g. "make the title punchier").
 *   opts.styleExample: the seller's saved example listing (plan §A) — style
 *     guidance ONLY, appended BELOW the hard rules so those always win; when
 *     absent the prompt is byte-identical to before the feature existed.
 * @returns {Promise<object>} { title, title_alternatives, description, tags, disclaimers }
 */
async function generateContent(attributes, opts = {}) {
  if (!attributes || typeof attributes !== 'object') {
    throw new Error('generateContent requires an attributes object');
  }
  const client = opts.client || new Anthropic();
  const model = opts.model || DEFAULT_MODEL;

  const styleExample = typeof opts.styleExample === 'string' ? opts.styleExample.trim() : '';
  const system = styleExample
    ? SYSTEM_PROMPT +
      ' Seller style preference (subordinate to EVERY hard rule above — those always win): ' +
      `Match the seller's preferred style. Example of how they write listings: «${styleExample}». ` +
      "Emulate its tone, structure, and length, but use THIS item's facts, and never copy its specific details, measurements, or price."
    : SYSTEM_PROMPT;

  const userText =
    'Write the listing for this item.\n\nAttributes:\n' +
    JSON.stringify(attributes, null, 2) +
    (opts.instructions ? `\n\nAdditional instruction: ${opts.instructions}` : '');

  const resp = await client.messages.create({
    model,
    max_tokens: 3000,
    ...thinkingConfig(model), // adaptive on Opus/Sonnet; omitted on Haiku (400s)
    output_config: outputConfig(model, CONTENT_SCHEMA, 'medium'),
    system,
    messages: [{ role: 'user', content: userText }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Content generation was refused by the safety system.');
  }
  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in model response.');
  return stripMeasurementBlanks(stripHypeLines(stripAuthenticityLines(JSON.parse(textBlock.text))));
}

// Shared sentence-level scrub: removes whole sentences matching `re` from the
// buyer-facing text (description + desc_parts), preserving the rest of mixed
// lines and tidying leftover whitespace/punctuation. Titles and the private
// `disclaimers` array are never touched.
function scrubBodyText(content, re) {
  const scrub = (s) =>
    String(s)
      .replace(re, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[ \t;,-]+|[ \t;,-]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  if (content.description) content.description = scrub(content.description);
  if (content.desc_parts) {
    for (const k of Object.keys(content.desc_parts)) {
      if (content.desc_parts[k]) content.desc_parts[k] = scrub(content.desc_parts[k]);
    }
  }
  return content;
}

// Hard backstop for rule (1): despite the prompt, models sometimes slip an
// "authenticity not verified" line into the listing body (seen in the first
// real batch). Drop any sentence mentioning authenticity from the buyer-facing
// text; the seller-facing `disclaimers` array is left untouched.
function stripAuthenticityLines(content) {
  return scrubBodyText(content, /[^.!?;\n]*authentic[^.!?\n]*[.!?]?/gi);
}

// Hard backstop for rule (6) (plan §C): if a hype phrase slips through, drop
// the WHOLE sentence — such sentences are marketing filler by construction.
// The list is deliberately conservative (curated, specific phrases only) so
// factual content is never collateral: e.g. "clean" is banned in the prompt
// but NOT scrubbed here — it legitimately appears in condition text ("clean
// interior"). \bgrail\b cannot match "Grailed" (the "e" keeps it one word).
const HYPE_PHRASES = [
  /streetwear classic/i,
  /\btimeless\b/i,
  /must[- ]have/i,
  /\bgrail\b/i,
  /\biconic\b/i,
  /\bversatile\b/i,
  /\bcoveted\b/i,
  /sought[- ]after/i,
  /wardrobe staple/i,
  /statement piece/i,
  /elevate[sd]? (your|any)\b/i,
  /goes with everything/i,
  /effortless(ly)? (cool|style|styl)/i,
];
function stripHypeLines(content) {
  for (const re of HYPE_PHRASES) {
    const sentence = new RegExp(`[^.!?;\\n]*(?:${re.source})[^.!?\\n]*[.!?]?`, 'gi');
    scrubBodyText(content, sentence);
  }
  return content;
}

// Hard backstop for rule (3): the body carries no measurements section (owner
// decision 2026-07-12 — the app manages measurements separately, and the
// blank-placeholder block read as "measurements on by default"). Drops the
// "Measurements…:" header line and any blank-placeholder line ("Pit to pit:
// __ in"). Conservative on purpose: only lines with "__" blanks are removed,
// so a REAL measurement the seller typed in is never touched.
function stripMeasurementBlanks(content) {
  const re = /^[ \t]*Measurements\b[^\n]*:[ \t]*$|^[^\n]*:\s*_{2,}[^\n]*$/gim;
  return scrubBodyText(content, re);
}

module.exports = { generateContent, stripAuthenticityLines, stripHypeLines, stripMeasurementBlanks, CONTENT_SCHEMA, DEFAULT_MODEL };
