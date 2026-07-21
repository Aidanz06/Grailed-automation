import { cn } from '@/lib/utils';

/*
 * Auto-save state chip (M-6): the DraftEditor / ConfirmScreen twins, unified.
 * The editor passes a "Saved 12s ago" label; the confirm pass keeps its plain
 * "Saved" (no ago label — deliberate, manifest R10).
 *
 * 'failed' (UX audit #9): a failed save must stay VISIBLE until a save
 * succeeds — the chip becomes a persistent clickable "Not saved — retry"
 * instead of unmounting (silence that looked like success). The owners of the
 * save effect also auto-retry (~5s) while the item stays dirty.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface Props {
  state: SaveState;
  /** Text once saved; defaults to plain "Saved". */
  savedLabel?: string;
  /** Retry the save now (failed state only — the chip is a button there). */
  onRetry?: () => void;
}

export function SaveChip({ state, savedLabel = 'Saved', onRetry }: Props) {
  if (state === 'idle') return null;
  if (state === 'failed') {
    return (
      <button
        onClick={onRetry}
        className="rounded-md border border-destructive bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/25"
      >
        Not saved — retry
      </button>
    );
  }
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
