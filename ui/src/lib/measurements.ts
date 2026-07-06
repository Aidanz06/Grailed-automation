/*
 * Category-specific measurement templates (real-run feedback 2026-07-04:
 * "the app gives me the same four blanks for every garment"). The template
 * only changes WHICH blanks are offered — values are always user-entered,
 * never guessed (CLAUDE.md: nothing is filled the user didn't type).
 */

import type { ExtractedAttributes, Measurements } from '@/types';

export interface MeasureField {
  key: string;
  label: string;
  /** Input placeholder — unit hint ("in") or example for non-length fields. */
  placeholder: string;
}

const IN = 'in';
const F = (key: string, label: string, placeholder = IN): MeasureField => ({ key, label, placeholder });

export type MeasureKind = 'tops' | 'bottoms' | 'dresses' | 'footwear' | 'accessories';

const TEMPLATES: Record<MeasureKind, MeasureField[]> = {
  tops: [F('pitToPit', 'pit to pit'), F('length', 'length'), F('shoulder', 'shoulders'), F('sleeve', 'sleeve')],
  bottoms: [F('waist', 'waist'), F('inseam', 'inseam'), F('rise', 'rise'), F('legOpening', 'leg opening')],
  dresses: [F('pitToPit', 'pit to pit'), F('waist', 'waist'), F('length', 'length')],
  footwear: [F('taggedSize', 'tagged size', 'e.g. US 10'), F('outsole', 'outsole length')],
  accessories: [F('length', 'length'), F('width', 'width')],
};

// Legacy items saved chest/length/sleeve/shoulder before templates existed.
const LEGACY_LABELS: Record<string, string> = {
  chest: 'chest',
  pitToPit: 'pit to pit',
  length: 'length',
  sleeve: 'sleeve',
  shoulder: 'shoulders',
  waist: 'waist',
  inseam: 'inseam',
  rise: 'rise',
  legOpening: 'leg opening',
  taggedSize: 'tagged size',
  outsole: 'outsole length',
  width: 'width',
};

/** Best-effort garment kind from the (free-text or Grailed) category fields. */
export function measureKind(attrs: ExtractedAttributes): MeasureKind {
  const text = [attrs.grailed_category, attrs.category, attrs.subcategory].filter(Boolean).join(' ').toLowerCase();
  if (/(footwear|shoe|sneaker|boot|loafer|sandal|heel|mule|clog)/.test(text)) return 'footwear';
  if (/(dress|gown)/.test(text)) return 'dresses';
  if (/(bottom|pant|jean|trouser|short|skirt|denim|chino|cargo|sweatpant|legging)/.test(text)) return 'bottoms';
  if (/(accessor|bag|belt|hat|cap|beanie|scarf|jewelry|wallet|luggage)/.test(text)) return 'accessories';
  return 'tops'; // tops/outerwear/tailoring/knits — and the safe default
}

/**
 * Fields to show for an item: the category template, plus any extra keys that
 * already hold a value (legacy chest/… data or a template switch mid-edit) so
 * saved numbers never silently disappear.
 */
export function measureFields(attrs: ExtractedAttributes, existing?: Measurements | null): MeasureField[] {
  const fields = [...TEMPLATES[measureKind(attrs)]];
  const known = new Set(fields.map((f) => f.key));
  for (const [k, v] of Object.entries(existing ?? {})) {
    if (v && !known.has(k)) {
      fields.push(F(k, LEGACY_LABELS[k] ?? k));
      known.add(k);
    }
  }
  return fields;
}

/** "Pit to pit: 22 in" lines for the copied/assembled listing text. */
export function measurementLines(attrs: ExtractedAttributes, m: Measurements | null | undefined): string[] {
  if (!m) return [];
  return measureFields(attrs, m)
    .filter((f) => m[f.key])
    .map((f) => {
      const label = f.label[0].toUpperCase() + f.label.slice(1);
      const unit = f.placeholder === IN ? ' in' : '';
      return `${label}: ${m[f.key]}${unit}`;
    });
}
