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
 *   - Measurements are NOT known from photos, so the description carries a
 *     measurements section with blank placeholders for the seller to fill —
 *     never invent numbers.
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
        'Grailed-style listing title, ~40–60 chars. Lead with the most price-relevant facts ' +
        '(brand + item + era/notable feature). Sentence/Title case, no emojis, no keyword spam, no ALL CAPS.',
    },
    title_alternatives: {
      type: 'array',
      items: { type: 'string' },
      description: '1–2 alternate title options the seller can pick instead.',
    },
    description: {
      type: 'string',
      description:
        'Listing body in plain text with short lines/line breaks. Include, in order: a one-line ' +
        'overview; notable features/materials; an honest condition line derived from the condition ' +
        'fields; then a "Measurements (verify before listing):" section with LABELED BLANK ' +
        'placeholders appropriate to the item (e.g. "Pit to pit: __ in", "Length: __ in") — do NOT ' +
        'invent measurement values. No price. No authenticity guarantees AND no authenticity ' +
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
        'The SAME description content split into toggleable sections, so the seller can show/hide ' +
        'parts in the sidebar. Each is a short standalone snippet (no headers). Use "" (empty string) ' +
        'where a section does not apply. Do NOT put measurements here — those are separate blanks.',
      properties: {
        overview: { type: 'string', description: 'One-line item overview. Always present.' },
        materials: { type: 'string', description: 'Materials/fabric line. "" if unknown.' },
        condition: { type: 'string', description: 'Honest condition line derived from the condition fields.' },
        fit: { type: 'string', description: 'Fit/sizing line. "" if nothing to say.' },
        flaws: { type: 'string', description: 'Notable flaws/wear. "" if none.' },
        care: { type: 'string', description: 'Care/shipping line. "" if nothing to say.' },
      },
      required: ['overview', 'materials', 'condition', 'fit', 'flaws', 'care'],
    },
  },
  required: ['title', 'title_alternatives', 'description', 'tags', 'disclaimers', 'desc_parts'],
};

const SYSTEM_PROMPT = [
  'You write listings for the resale marketplace Grailed from a structured description of one item.',
  'Follow Grailed conventions: short scannable titles, measurement-forward descriptions, brand/era/silhouette-first tags.',
  'Hard rules:',
  '(1) NEVER mention authenticity in the listing text at all — no claims ("authentic", "guaranteed real", "100% legit") AND no disclaimers ("authenticity not verified", "cannot guarantee authenticity"). Authenticity caveats go ONLY in the `disclaimers` array, which the seller sees privately.',
  '(2) If the brand is "unclear" or brand_confidence is low (< ~0.6), do NOT state the brand as fact — describe it generically or hedge ("appears to be", "unbranded/unknown").',
  '(3) You do NOT know measurements — never invent them; leave labeled blank placeholders for the seller to fill.',
  '(4) Base every claim on the provided attributes; do not fabricate features, materials, or provenance.',
  'Everything you produce is an editable draft the seller reviews before posting.',
].join(' ');

/**
 * Generate listing content for one item from its extracted attributes.
 * @param {object} attributes - output of vision.extractAttributes
 * @param {object} [opts] - { client, model, instructions }
 *   opts.instructions: optional steer for regeneration (e.g. "make the title punchier").
 * @returns {Promise<object>} { title, title_alternatives, description, tags, disclaimers }
 */
async function generateContent(attributes, opts = {}) {
  if (!attributes || typeof attributes !== 'object') {
    throw new Error('generateContent requires an attributes object');
  }
  const client = opts.client || new Anthropic();
  const model = opts.model || DEFAULT_MODEL;

  const userText =
    'Write the listing for this item.\n\nAttributes:\n' +
    JSON.stringify(attributes, null, 2) +
    (opts.instructions ? `\n\nAdditional instruction: ${opts.instructions}` : '');

  const resp = await client.messages.create({
    model,
    max_tokens: 3000,
    ...thinkingConfig(model), // adaptive on Opus/Sonnet; omitted on Haiku (400s)
    output_config: outputConfig(model, CONTENT_SCHEMA, 'medium'),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Content generation was refused by the safety system.');
  }
  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in model response.');
  return stripAuthenticityLines(JSON.parse(textBlock.text));
}

// Hard backstop for rule (1): despite the prompt, models sometimes slip an
// "authenticity not verified" line into the listing body (seen in the first
// real batch). Drop any line mentioning authenticity from the buyer-facing
// text; the seller-facing `disclaimers` array is left untouched.
function stripAuthenticityLines(content) {
  const scrub = (s) =>
    String(s)
      // Remove whole sentences mentioning authenticity (keeps the rest of a
      // mixed line like "Good condition; authenticity not verified.").
      .replace(/[^.!?;\n]*authentic[^.!?\n]*[.!?]?/gi, '')
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

module.exports = { generateContent, stripAuthenticityLines, CONTENT_SCHEMA, DEFAULT_MODEL };
