import type { DescParts, ExtractedAttributes, Item } from '@/types';

/*
 * Description Styles — renderer template engine (Phase 1,
 * docs/DESIGN-description-styles.md). A style is a plain-text template mixing
 * CONSTANT text (footer, "Condition:" labels — verbatim, never AI-produced),
 * [data chips] substituted from attributes, and [prose chips] written by the
 * AI (desc_parts). A chip whose source is empty drops its whole line.
 *
 * TWIN of pipeline/descriptionTemplate.js (CJS — main.js composes at
 * generation time and the unit tests run there). Keep the logic in lockstep.
 * This copy drives the live preview, Regenerate, and the copy-listing footer
 * backstop. The old Minimal/Standard/Detailed per-item toggles are superseded
 * by styles (the design doc: "the toggles become one preset") — legacy
 * Item.descProfile data is simply ignored.
 */

export type ChipKind = 'data' | 'prose';
export interface ChipDef {
  key: string;
  label: string;
  kind: ChipKind;
  hint: string;
}
export interface DescriptionStyle {
  name: string;
  template: string;
  builtin: boolean;
}
export interface ResolvedStyles {
  active: string;
  styles: DescriptionStyle[];
}

export const CHIP_DEFS: ChipDef[] = [
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

export const DEFAULT_FOOTER = 'Open to offers, feel free to message.';

export const BUILTIN_STYLES: DescriptionStyle[] = [
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
export const DEFAULT_ACTIVE = 'Standard';

/** Parse the persisted `descriptionStyles` setting (JSON string or null).
 * Built-ins always present; user styles override by name / add new names;
 * unset or corrupt → built-ins with "Standard" active. Never throws. */
export function resolveStyles(raw: string | null | undefined): ResolvedStyles {
  let saved: { active?: unknown; styles?: unknown } | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const byName = new Map(BUILTIN_STYLES.map((s) => [s.name, { ...s }]));
  if (saved && Array.isArray(saved.styles)) {
    for (const s of saved.styles as Array<{ name?: unknown; template?: unknown }>) {
      if (!s || typeof s.name !== 'string' || typeof s.template !== 'string') continue;
      const name = s.name.trim();
      if (!name) continue;
      const base = byName.get(name);
      byName.set(name, { name, template: s.template, builtin: !!(base && base.builtin) });
    }
  }
  const styles = [...byName.values()];
  const active =
    saved && typeof saved.active === 'string' && byName.has(saved.active) ? saved.active : DEFAULT_ACTIVE;
  return { active, styles };
}

/** Serialize back to the settings value: only non-builtin styles and builtin
 * OVERRIDES (template differs) are persisted — pristine built-ins stay code. */
export function serializeStyles(resolved: ResolvedStyles): string {
  const styles = resolved.styles.filter((s) => {
    const base = BUILTIN_STYLES.find((b) => b.name === s.name);
    return !base || base.template !== s.template;
  });
  return JSON.stringify({ active: resolved.active, styles: styles.map(({ name, template }) => ({ name, template })) });
}

export function activeTemplate(raw: string | null | undefined): string {
  const { active, styles } = resolveStyles(raw);
  return styles.find((x) => x.name === active)?.template ?? BUILTIN_STYLES[0].template;
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Chip values for one item — empty string means "not known" and drops the
 * line. Verbatim from attributes / AI parts; never invents. */
export function chipValues(
  attributes: Partial<ExtractedAttributes> | null | undefined,
  descParts: Partial<DescParts> | null | undefined
): Record<string, string> {
  const a = attributes ?? {};
  const p = descParts ?? {};
  const brandOk =
    !!a.resembles_brand && !/^\s*unclear\s*$/i.test(a.resembles_brand) && Number(a.brand_confidence ?? 0) >= 0.6;
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
    // legacy items stored the whole condition line under `condition`
    condition_note: clean(p.condition_note ?? p.condition),
    flaws: clean(p.flaws),
  };
}

const CHIP_RE = /\[([a-z_]+)\]/g;
const isChipKey = (k: string) => CHIP_KEYS.includes(k);

/** Compose a description from a template + chip values, top-to-bottom.
 * Deterministic: all-chips-empty lines drop, separators tidy, a constant
 * "Label:" line drops when everything under it dropped. */
export function composeDescription(template: string, values: Record<string, string>): string {
  const lines = String(template ?? '').split('\n');
  const kept: Array<{ text: string; isBlank: boolean; isLabel: boolean }> = [];

  for (const line of lines) {
    let hadChip = false;
    let hadValue = false;
    let out = line.replace(CHIP_RE, (m, key: string) => {
      if (!isChipKey(key)) return m; // unknown token: constant text, verbatim
      hadChip = true;
      const v = clean(values[key]);
      if (v) hadValue = true;
      return v;
    });
    if (hadChip && !hadValue) continue;

    if (hadChip) {
      out = out
        .replace(/:\s*[,;·]\s*/g, ': ')
        .replace(/^\s*[,;·]\s*/, '')
        .replace(/\s*[,;·]\s*(?=[,;·])/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s*[,;·]\s*$/, '')
        .trimEnd();
    }
    const isBlank = out.trim() === '';
    const isLabel = !hadChip && !isBlank && /:$/.test(out.trim());
    kept.push({ text: out, isBlank, isLabel });
  }

  const result: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const l = kept[i];
    if (l.isLabel) {
      const next = kept[i + 1];
      if (!next || next.isBlank) continue;
    }
    result.push(l.text);
  }

  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();
}

/** The style's constant footer — the trailing chip-free text block. */
export function styleFooter(template: string): string {
  const lines = String(template ?? '').split('\n');
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === '') {
      if (tail.length) break;
      continue;
    }
    CHIP_RE.lastIndex = 0;
    let hasChip = false;
    let m: RegExpExecArray | null;
    while ((m = CHIP_RE.exec(line))) {
      if (isChipKey(m[1])) {
        hasChip = true;
        break;
      }
    }
    if (hasChip) break;
    tail.unshift(line);
  }
  return tail.join('\n').trim();
}

/** Guarantee the style's constant footer is the exact last text. Idempotent —
 * the shared backstop for copy-listing (main.js applies it to the fill payload). */
export function finalizeDescription(body: string | null | undefined, template: string): string {
  const text = String(body ?? '').replace(/\s+$/g, '');
  const footer = styleFooter(template);
  if (!footer) return text;
  if (text.endsWith(footer)) return text;
  return text ? `${text}\n\n${footer}` : footer;
}

/** Item-level convenience: compose this item's description from the ACTIVE
 * style. Falls back to the stored body (plus footer) when the item has no
 * usable parts (legacy drafts before desc_parts existed). */
export function assembleDescription(item: Item, stylesRaw: string | null | undefined): string {
  const t = activeTemplate(stylesRaw);
  const body = composeDescription(t, chipValues(item.attributes, item.descParts));
  return finalizeDescription(body || (item.content?.description ?? '').trim(), t);
}
