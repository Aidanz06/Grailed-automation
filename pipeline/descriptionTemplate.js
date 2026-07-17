/*
 * Description Styles — deterministic template engine (Phase 1,
 * docs/DESIGN-description-styles.md). A style is a plain-text template mixing:
 *
 *   CONSTANT text  — typed verbatim: the footer, labels like "Condition:".
 *                    Deterministic, never AI-produced. Always survives.
 *   [data chips]   — substituted from the item's attributes; empty → the line drops.
 *   [prose chips]  — written by the AI (desc_parts) under the existing hard
 *                    rules; empty → the line drops.
 *
 * Line rules (all deterministic, unit-tested in descriptionTemplate.test.js):
 *   - A line containing chips is DROPPED when every chip on it is empty.
 *   - Within a kept line, an empty chip vanishes along with its dangling
 *     separator ("Condition: Used, " → "Condition: Used").
 *   - A constant-only line ending in ":" is a LABEL for the lines that follow
 *     it (until a blank line): if all of those dropped, the label drops too
 *     ("Note:" disappears when [flaws] is empty).
 *   - 3+ blank lines collapse to one blank line.
 *
 * finalizeDescription() guarantees the style's constant footer is the exact
 * last text of the description — the shared backstop called at every
 * finalization site (generation, fill payload, copy-listing). This is the
 * "footer doesn't stick" fix: constants are code-appended AFTER the content
 * scrubs, never trusted to the model.
 *
 * TWIN: ui/src/lib/description.ts carries the same engine for the renderer
 * (live preview, regenerate, copy) — keep the logic in lockstep. This CJS copy
 * is the one main.js and the unit tests load.
 */

// The insertable variables. `source` documents where the value comes from —
// chipValues() below implements it.
const CHIP_DEFS = [
  { key: 'overview', label: 'Overview', kind: 'prose', hint: 'AI one-line item overview' },
  { key: 'brand', label: 'Brand', kind: 'data', hint: 'resembled brand (only when confident)' },
  { key: 'color', label: 'Color', kind: 'data', hint: 'primary color' },
  { key: 'material', label: 'Material', kind: 'data', hint: 'visible materials' },
  { key: 'era', label: 'Era/style', kind: 'data', hint: 'era or style the piece resembles' },
  { key: 'style_code', label: 'Style code / tag text', kind: 'data', hint: 'verbatim text seen on tags or graphics' },
  { key: 'fit_note', label: 'Fit note', kind: 'data', hint: 'a size/fit nuance, not a bare size' },
  { key: 'condition_rating', label: 'Condition rating', kind: 'data', hint: 'the seller-facing rating' },
  { key: 'condition_note', label: 'Condition note', kind: 'prose', hint: 'AI specifics behind the rating' },
  { key: 'flaws', label: 'Flaws', kind: 'prose', hint: 'sale-relevant flaws only; drops when none' },
];
const CHIP_KEYS = CHIP_DEFS.map((c) => c.key);

const DEFAULT_FOOTER = 'Open to offers, feel free to message.';

// Built-in presets. "Standard" is the owner-structure DEFAULT (overview +
// condition + flaws-with-label + footer); optional detail chips (material /
// style_code / fit_note) are off by default = present only in "Detailed".
const BUILTIN_STYLES = [
  {
    name: 'Standard',
    builtin: true,
    template: [
      '[overview]',
      '',
      'Condition: [condition_rating], [condition_note]',
      'Note:',
      '[flaws]',
      '',
      DEFAULT_FOOTER,
    ].join('\n'),
  },
  {
    name: 'Minimal',
    builtin: true,
    template: ['[overview]', '', 'Condition: [condition_rating], [condition_note]', '', DEFAULT_FOOTER].join('\n'),
  },
  {
    name: 'Detailed',
    builtin: true,
    template: [
      '[overview]',
      '[material]',
      '[style_code]',
      '[fit_note]',
      '',
      'Condition: [condition_rating], [condition_note]',
      'Note:',
      '[flaws]',
      '',
      DEFAULT_FOOTER,
    ].join('\n'),
  },
];
const DEFAULT_ACTIVE = 'Standard';

/**
 * Parse the persisted `descriptionStyles` settings value (JSON string or null)
 * into { active, styles[] }. Built-ins are always present (user-saved styles
 * override a built-in by name and add new names); unset/corrupt input → the
 * built-ins with "Standard" active — the clean default, never a throw.
 */
function resolveStyles(raw) {
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  const byName = new Map(BUILTIN_STYLES.map((s) => [s.name, { ...s }]));
  if (saved && Array.isArray(saved.styles)) {
    for (const s of saved.styles) {
      if (!s || typeof s.name !== 'string' || typeof s.template !== 'string') continue;
      const name = s.name.trim();
      if (!name) continue;
      const base = byName.get(name);
      byName.set(name, { name, template: s.template, builtin: !!(base && base.builtin) });
    }
  }
  const styles = [...byName.values()];
  const active = saved && typeof saved.active === 'string' && byName.has(saved.active) ? saved.active : DEFAULT_ACTIVE;
  return { active, styles };
}

/** The active style's template for a raw settings value (never throws). */
function activeTemplate(raw) {
  const { active, styles } = resolveStyles(raw);
  const s = styles.find((x) => x.name === active);
  return s ? s.template : BUILTIN_STYLES[0].template;
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Chip values for one item. Empty string = "not known" → the chip's line
 * drops. Never invents: every value is verbatim from attributes / AI parts.
 */
function chipValues(attributes = {}, descParts = {}) {
  const a = attributes || {};
  const p = descParts || {};
  const brandOk =
    a.resembles_brand && !/^\s*unclear\s*$/i.test(a.resembles_brand) && Number(a.brand_confidence ?? 0) >= 0.6;
  const rating = clean(a.condition_rating);
  return {
    overview: clean(p.overview),
    brand: brandOk ? clean(a.resembles_brand) : '',
    color: clean(a.primary_color),
    material: Array.isArray(a.materials) ? clean(a.materials.filter(Boolean).join(', ')) : '',
    era: clean(a.era_style),
    style_code: clean(a.visible_text),
    fit_note: clean(p.fit),
    condition_rating: /^unclear$/i.test(rating) ? '' : rating,
    // New generations carry condition_note; legacy items stored the whole
    // condition line under `condition` — accept both so old drafts compose.
    condition_note: clean(p.condition_note ?? p.condition),
    flaws: clean(p.flaws),
  };
}

const CHIP_RE = /\[([a-z_]+)\]/g;
const isChipKey = (k) => CHIP_KEYS.includes(k);

/**
 * Compose a description body from a template and chip values, top-to-bottom.
 * Deterministic — see the line rules in the header comment.
 */
function composeDescription(template, values = {}) {
  const lines = String(template ?? '').split('\n');
  const kept = []; // { text, isLabel, isBlank }

  for (const line of lines) {
    let hadChip = false;
    let hadValue = false;
    let out = line.replace(CHIP_RE, (m, key) => {
      if (!isChipKey(key)) return m; // unknown token: constant text, verbatim
      hadChip = true;
      const v = clean(values[key]);
      if (v) hadValue = true;
      return v;
    });
    if (hadChip && !hadValue) continue; // every chip empty → drop the line

    // Tidy separators left by empty chips on a kept mixed line:
    // "Condition: Used, " → "Condition: Used"; "Condition: , note" → "Condition: note".
    if (hadChip) {
      out = out
        .replace(/:\s*[,;·]\s*/g, ': ') // empty chip right after a label colon
        .replace(/^\s*[,;·]\s*/, '') // empty first chip left a leading separator
        .replace(/\s*[,;·]\s*(?=[,;·])/g, '') // separator runs from adjacent empty chips
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s*[,;·]\s*$/, '') // empty last chip left a trailing separator
        .trimEnd();
    }
    const isBlank = out.trim() === '';
    const isLabel = !hadChip && !isBlank && /:$/.test(out.trim());
    kept.push({ text: out, isBlank, isLabel, hadContent: hadChip ? hadValue : !isBlank });
  }

  // Label rule: a constant "Something:" line whose following lines (up to the
  // next blank) all dropped has nothing to introduce — drop it too.
  const result = [];
  for (let i = 0; i < kept.length; i++) {
    const l = kept[i];
    if (l.isLabel) {
      const next = kept[i + 1];
      if (!next || next.isBlank) continue; // nothing under the label survived
    }
    result.push(l.text);
  }

  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}

/**
 * The style's constant footer: the trailing chip-free, non-label text block of
 * the template. "" when the template ends with a chip line.
 */
function styleFooter(template) {
  const lines = String(template ?? '').split('\n');
  const tail = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === '') { if (tail.length) break; continue; }
    CHIP_RE.lastIndex = 0;
    let hasChip = false;
    let m;
    while ((m = CHIP_RE.exec(line))) { if (isChipKey(m[1])) { hasChip = true; break; } }
    if (hasChip) break;
    tail.unshift(line);
  }
  return tail.join('\n').trim();
}

/**
 * Guarantee the style's constant footer is the exact last text of the body.
 * Idempotent; called at every finalization site (generation output, the fill
 * payload, copy-listing) AFTER the content scrubs — the footer fix.
 */
function finalizeDescription(body, template) {
  const text = String(body ?? '').replace(/\s+$/g, '');
  const footer = styleFooter(template);
  if (!footer) return text;
  if (text.endsWith(footer)) return text;
  return text ? `${text}\n\n${footer}` : footer;
}

module.exports = {
  CHIP_DEFS,
  BUILTIN_STYLES,
  DEFAULT_ACTIVE,
  DEFAULT_FOOTER,
  resolveStyles,
  activeTemplate,
  chipValues,
  composeDescription,
  styleFooter,
  finalizeDescription,
};
