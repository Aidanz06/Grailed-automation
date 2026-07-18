import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Two-step delete (M-6): arm → "Sure?" → delete, auto-disarming after 3.5s.
 * One component so the destructive-action UX can never drift between the
 * Home list rows and the board card overlay. Deliberately a SIBLING of the
 * clickable row/card (a button can't nest in a button) — the card variant
 * overlays its group-hover card, hence the stopPropagation.
 */

export const DISARM_MS = 3500;

const VARIANT = {
  /** Standalone squarish button beside a list row. */
  row: {
    base: 'flex w-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition-colors',
    armed: 'border-destructive bg-destructive/15 text-destructive',
    idle: 'bg-card hover:border-destructive hover:text-destructive',
    sure: 'px-1 text-[10px] font-semibold uppercase',
    icon: 'h-4 w-4',
  },
  /** Hover-revealed overlay pinned to a card's top-right corner. */
  card: {
    base: 'absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md border transition-all',
    armed: 'border-destructive bg-destructive/90 text-white opacity-100',
    idle: 'border-border bg-card/90 text-muted-foreground opacity-0 backdrop-blur-sm hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100',
    sure: 'text-[9px] font-semibold uppercase',
    icon: 'h-3.5 w-3.5',
  },
} as const;

interface Props {
  /** What's being deleted, for the aria-label ("delete <title>"). */
  title: string;
  onDelete: () => void;
  variant: keyof typeof VARIANT;
}

export function TwoStepDelete({ title, onDelete, variant }: Props) {
  const [armed, setArmed] = useState(false);
  const v = VARIANT[variant];
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      aria-label={armed ? `confirm delete ${title}` : `delete ${title}`}
      title={armed ? 'Click again to permanently delete (app only — Grailed is untouched)' : 'Delete this listing from the app'}
      className={cn(v.base, armed ? v.armed : v.idle)}
      onClick={(e) => {
        e.stopPropagation();
        if (!armed) return setArmed(true);
        setArmed(false);
        onDelete();
      }}
    >
      {armed ? <span className={v.sure}>Sure?</span> : <Trash2 className={v.icon} />}
    </button>
  );
}
