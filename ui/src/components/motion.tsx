import { cn } from '@/lib/utils';

/*
 * Shared motion primitives (studio-blend theme, 2026-07-04): the drawn-in
 * checkmark, glowing status dot, teal→brass progress bar, and the photo-
 * shuffle batch loader. All animation lives in index.css utilities and
 * respects prefers-reduced-motion.
 */

/** Checkmark that draws its stroke in when it mounts (state flips to done). */
export function AnimatedCheck({ className, tone = 'success' }: { className?: string; tone?: 'success' | 'primary' }) {
  const color = tone === 'primary' ? 'text-primary bg-primary/15' : 'text-success bg-success/15';
  return (
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', color, className)}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path
          d="M3.5 8.4 6.5 11.2 12.5 4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="draw-check"
        />
      </svg>
    </span>
  );
}

/** Pulsing glow dot — the "this is live right now" marker. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', className)}>
      <span className="glow-dot h-2 w-2 rounded-full bg-primary" />
    </span>
  );
}

/** Hollow pending circle, matching the check/dot footprint. */
export function PendingDot({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', className)}>
      <span className="h-2 w-2 rounded-full border border-muted-foreground/40" />
    </span>
  );
}

/** Teal→brass progress bar. `live` adds the glow + shimmer sweep. */
export function ProgressBar({
  pct,
  live = false,
  warn = false,
  className,
  transition,
}: {
  pct: number;
  live?: boolean;
  warn?: boolean;
  className?: string;
  /** Optional CSS transition override for the fill width (e.g. slow creep). */
  transition?: string;
}) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-secondary', live && 'shimmer', className)}>
      <div
        className={cn('h-full rounded-full', warn ? 'bg-warning' : live ? 'bar-live' : 'bg-primary')}
        style={{ width: `${pct}%`, transition: transition ?? 'width 500ms ease' }}
      />
    </div>
  );
}

/** Batch-grouping loader: photo cards shuffling themselves into a stack. */
export function PhotoShuffler({ className }: { className?: string }) {
  const card = 'absolute left-1/2 top-1 -ml-3 h-9 w-6 rounded-[3px] border';
  return (
    <div className={cn('relative mx-auto h-12 w-16', className)} aria-hidden>
      <span className={cn(card, 'shuffle-l border-primary/70 bg-primary/10 shadow-[0_0_10px_hsl(var(--primary)/0.25)]')} />
      <span className={cn(card, 'shuffle-r border-muted-foreground/40 bg-secondary')} />
      <span className={cn(card, 'border-muted-foreground/60 bg-accent')} />
    </div>
  );
}
