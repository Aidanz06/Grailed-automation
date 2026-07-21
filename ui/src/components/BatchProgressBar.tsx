import { useEffect, useRef, useState } from 'react';
import { api, type BatchProgress } from '@/lib/api';
import { importProgress } from '@/lib/importProgress';

/*
 * Global batch progress bar (integration plan P1.4 — background processing).
 *
 * A batch import runs in the main process and keeps going even if the user
 * navigates away from the Import screen to fill in a listing. This bar subscribes
 * to `batch:progress` at the App level (always mounted), so a running import shows
 * a thin, persistent strip at the top of every other screen. On the Import screen
 * itself we pass `hidden` because that screen renders its own detailed bar.
 */

// Weighted overall percent — shared with ImportScreen via lib/importProgress
// (QW-5). This bar keeps rendering the denominator-less `analyzing` stage
// (creep=true) as an indeterminate sweep rather than a fake number (U7).
function overallPercent(p: BatchProgress): number | null {
  if (p.stage === 'error') return null; // error renders its own full bar
  const { pct, creep } = importProgress(p);
  return creep ? null : pct;
}

interface Props {
  /** Suppress while the Import screen (which has its own detailed bar) is visible. */
  hidden?: boolean;
}

export function BatchProgressBar({ hidden = false }: Props) {
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = api.onBatchProgress((p) => {
      if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
      setProgress(p);
      // Auto-dismiss after terminal stages (quick on success, lingering on error).
      if (p.stage === 'done' || p.stage === 'error') {
        clearTimer.current = setTimeout(() => setProgress(null), p.stage === 'done' ? 1500 : 6000);
      }
    });
    return () => { off(); if (clearTimer.current) clearTimeout(clearTimer.current); };
  }, []);

  if (!progress || hidden) return null;

  const isError = progress.stage === 'error';
  const pct = overallPercent(progress);
  const indeterminate = pct == null && !isError;

  return (
    <div className="border-b bg-card px-4 py-1.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs leading-normal">
        <span className={isError ? 'font-medium text-destructive' : 'font-medium text-foreground'}>
          {isError ? 'Import failed' : 'Importing photos'}
        </span>
        <span className="truncate text-muted-foreground">{progress.label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {pct != null && !isError && <span className="tabular-nums text-muted-foreground">{Math.round(pct)}%</span>}
          {/* Stop from anywhere (audit #4) — the import runs app-wide, so the
              escape hatch must too. Cancel lands at the next boundary. */}
          {!isError && progress.stage !== 'done' && (
            <button
              className="rounded border border-input px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
              onClick={() => api.cancelBatch().catch(() => {})}
            >
              Stop
            </button>
          )}
        </span>
      </div>
      <div className={`mt-1 h-1 w-full overflow-hidden rounded bg-muted ${!isError ? 'shimmer' : ''}`}>
        {isError ? (
          <div className="h-full w-full bg-destructive/70" />
        ) : indeterminate ? (
          <div className="bar-live h-full w-1/3 rounded" />
        ) : (
          <div
            className="bar-live h-full rounded transition-[width] duration-500"
            style={{ width: `${pct ?? 0}%` }}
          />
        )}
      </div>
    </div>
  );
}
