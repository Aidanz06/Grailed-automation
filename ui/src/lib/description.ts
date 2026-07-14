import type { DescProfile, DescSectionKey, Item, PresetName } from '@/types';

// Overview is always included; these are the toggleable text sections (mapped
// to descParts). Measurements are GONE from the app entirely (owner decision
// 2026-07-14): on Grailed they go through Grailed's own measurements system,
// never the description. Legacy saved descProfiles may still carry a
// `measurements` key — ALL_SECTIONS-driven code simply ignores it.
export const TEXT_SECTIONS: DescSectionKey[] = ['materials', 'condition', 'fit', 'flaws', 'care'];
export const ALL_SECTIONS: DescSectionKey[] = [...TEXT_SECTIONS];

export const SECTION_LABELS: Record<DescSectionKey, string> = {
  materials: 'Materials',
  condition: 'Condition',
  fit: 'Fit',
  flaws: 'Flaws',
  care: 'Care/shipping',
};

export const PRESETS: Record<'Minimal' | 'Standard' | 'Detailed', Record<DescSectionKey, boolean>> = {
  Minimal: { materials: false, condition: true, fit: false, flaws: false, care: false },
  Standard: { materials: true, condition: true, fit: false, flaws: false, care: false },
  Detailed: { materials: true, condition: true, fit: true, flaws: true, care: true },
};

// Plan §B (tester feedback): drafts default to Minimal — overview + a short
// condition line, measurements off. The presets themselves are untouched so
// the Minimal/Standard/Detailed toggles still work per item.
export const DEFAULT_PROFILE: DescProfile = { preset: 'Minimal', sections: { ...PRESETS.Minimal } };

export function presetName(sections: Record<DescSectionKey, boolean>): PresetName {
  for (const name of ['Minimal', 'Standard', 'Detailed'] as const) {
    if (ALL_SECTIONS.every((k) => !!PRESETS[name][k] === !!sections[k])) return name;
  }
  return 'Custom';
}

export function sameProfile(a: DescProfile, b: DescProfile): boolean {
  return ALL_SECTIONS.every((k) => !!a.sections[k] === !!b.sections[k]);
}

export function assembleDescription(item: Item, profile: DescProfile): string {
  if (!item.descParts) return item.content?.description ?? '';
  const parts: string[] = [item.descParts.overview];
  for (const k of TEXT_SECTIONS) {
    if (profile.sections[k] && item.descParts[k]) parts.push(item.descParts[k]);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function effectiveProfile(item: Item, def: DescProfile): DescProfile {
  return item.descProfile ?? def;
}
