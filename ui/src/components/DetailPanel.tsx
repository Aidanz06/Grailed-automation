import type { DescProfile, DescSectionKey, Item } from '@/types';
import {
  ALL_SECTIONS,
  PRESETS,
  SECTION_LABELS,
  assembleDescription,
  effectiveProfile,
  presetName,
  sameProfile,
} from '@/lib/description';
import { cn } from '@/lib/utils';

interface Props {
  item: Item;
  defaultProfile: DescProfile;
  setDefaultProfile: (p: DescProfile) => void;
  update: (recipe: (draft: Item) => void) => void;
}

export function DetailPanel({ item, defaultProfile, setDefaultProfile, update }: Props) {
  const eff = effectiveProfile(item, defaultProfile);
  const active = presetName(eff.sections);

  const applySections = (sections: Record<DescSectionKey, boolean>) =>
    update((d) => {
      const prof: DescProfile = { preset: presetName(sections), sections };
      d.descProfile = sameProfile(prof, defaultProfile) ? null : prof;
      if (d.descParts && d.content) d.content.description = assembleDescription(d, prof);
      d.dirty = true;
    });

  return (
    <div className="mb-2.5 rounded-md border bg-secondary/40 p-3">
      <div className="mb-2 flex items-baseline gap-2.5">
        <span className="text-xs font-medium text-muted-foreground">Description details</span>
        {item.descProfile ? (
          <span className="text-[11.5px] text-muted-foreground">
            custom for this item{' · '}
            <button
              className="text-primary hover:underline"
              onClick={() => {
                setDefaultProfile(structuredClone(eff));
                update((d) => {
                  d.descProfile = null;
                });
              }}
            >
              set as default
            </button>
            {' · '}
            <button
              className="text-primary hover:underline"
              onClick={() =>
                update((d) => {
                  d.descProfile = null;
                  if (d.descParts && d.content) d.content.description = assembleDescription(d, defaultProfile);
                  d.dirty = true;
                })
              }
            >
              reset to default
            </button>
          </span>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">using default style</span>
        )}
      </div>

      <div className="mb-2 inline-flex overflow-hidden rounded-md border">
        {(['Minimal', 'Standard', 'Detailed'] as const).map((name) => (
          <button
            key={name}
            onClick={() => applySections({ ...PRESETS[name] })}
            className={cn(
              'border-r px-3.5 py-1.5 text-xs transition-colors last:border-r-0 hover:bg-accent',
              active === name && 'bg-primary text-primary-foreground hover:bg-primary'
            )}
          >
            {name}
          </button>
        ))}
        {active === 'Custom' && <span className="bg-warning px-3.5 py-1.5 text-xs text-warning-foreground">Custom</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ALL_SECTIONS.filter(
          // Text sections with no generated content can't add anything — hide
          // them so they aren't dead toggles.
          (k) => !!(item.descParts && (item.descParts as unknown as Record<string, string | undefined>)[k]?.trim())
        ).map((k) => {
          const on = !!eff.sections[k];
          return (
            <button
              key={k}
              onClick={() => applySections({ ...eff.sections, [k]: !eff.sections[k] })}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground',
                on && 'border-primary bg-primary/10 text-primary'
              )}
            >
              {(on ? '✓ ' : '+ ') + SECTION_LABELS[k]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
