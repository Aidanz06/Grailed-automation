import type { DescProfile, DescSectionKey, Item, PresetName } from '@/types';

// Overview is always included; these are the toggleable text sections (mapped to
// descParts). "measurements" is a separate structured group, not body text.
export const TEXT_SECTIONS: Exclude<DescSectionKey, 'measurements'>[] = [
  'materials',
  'condition',
  'fit',
  'flaws',
  'care',
];
export const ALL_SECTIONS: DescSectionKey[] = [...TEXT_SECTIONS, 'measurements'];

export const SECTION_LABELS: Record<DescSectionKey, string> = {
  materials: 'Materials',
  condition: 'Condition',
  fit: 'Fit',
  flaws: 'Flaws',
  care: 'Care/shipping',
  measurements: 'Measurements',
};

export const PRESETS: Record<'Minimal' | 'Standard' | 'Detailed', Record<DescSectionKey, boolean>> = {
  Minimal: { materials: false, condition: true, fit: false, flaws: false, care: false, measurements: false },
  Standard: { materials: true, condition: true, fit: false, flaws: false, care: false, measurements: true },
  Detailed: { materials: true, condition: true, fit: true, flaws: true, care: true, measurements: true },
};

export const DEFAULT_PROFILE: DescProfile = { preset: 'Standard', sections: { ...PRESETS.Standard } };

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
