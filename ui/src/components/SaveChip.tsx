import { cn } from '@/lib/utils';

/*
 * Auto-save state chip (M-6): the DraftEditor / ConfirmScreen twins, unified.
 * The editor passes a "Saved 12s ago" label; the confirm pass keeps its plain
 * "Saved" (no ago label — deliberate, manifest R10).
 */

export type SaveState = 'idle' | 'saving' | 'saved';

interface Props {
  state: SaveState;
  /** Text once saved; defaults to plain "Saved". */
  savedLabel?: string;
}

export function SaveChip({ state, savedLabel = 'Saved' }: Props) {
  if (state === 'idle') return null;
  return (
    <span
      className={cn(
        'rounded-md border px-2 py-0.5 text-xs transition-colors duration-300',
        state === 'saving' ? 'border-success/50 bg-transparent text-muted-foreground' : 'border-success bg-success/20 text-success'
      )}
    >
      {state === 'saving' ? 'Saving…' : savedLabel}
    </span>
  );
}
