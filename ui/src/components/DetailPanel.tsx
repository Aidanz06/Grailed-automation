import { Pencil } from 'lucide-react';
import { resolveStyles } from '@/lib/description';

/*
 * Description Styles Phase 1: the per-item Minimal/Standard/Detailed toggles
 * are superseded by the global style templates (docs/DESIGN-description-
 * styles.md — "the toggles become one preset"). This panel is now a slim
 * pointer: which style composes new descriptions, and the door to editing it.
 * Legacy Item.descProfile data is ignored.
 */

interface Props {
  stylesRaw: string | null;
  onEditStyles: () => void;
}

export function DetailPanel({ stylesRaw, onEditStyles }: Props) {
  const { active } = resolveStyles(stylesRaw);
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">
        New descriptions compose with the <span className="font-medium text-foreground">{active}</span> style — its
        constant footer always stays the last line. Regenerate applies the current template to this draft.
      </span>
      <button
        className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
        onClick={onEditStyles}
        title="Edit the description style templates"
      >
        <Pencil className="h-3 w-3" /> Edit styles
      </button>
    </div>
  );
}
