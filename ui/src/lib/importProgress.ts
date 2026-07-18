/*
 * Single source for the import-progress weighting (QW-5): photo prep 0–15%,
 * AI grouping 15–55%, per-group pipeline 55–100%. Both bars — ImportScreen's
 * detailed one and the thin App-level BatchProgressBar — read THIS mapping so
 * they can never show different numbers again.
 *
 * `creep` marks the single batched vision call (`analyzing`): it has no
 * denominator, so `pct` is a creep TARGET, not a measurement. How to render
 * that is each bar's own call (manifest U7): ImportScreen creeps toward it on
 * a slow CSS transition; the thin bar shows an indeterminate sweep.
 */

import type { BatchProgress } from '@/lib/api';

export interface ImportProgressPoint {
  /** Weighted overall percent, 0–100. */
  pct: number;
  /** True while `pct` is a target for the opaque vision call, not a count. */
  creep: boolean;
}

export function importProgress(p: Pick<BatchProgress, 'stage' | 'done' | 'total'>): ImportProgressPoint {
  const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  switch (p.stage) {
    case 'grouping':
      return { pct: 2, creep: false };
    case 'preparing':
      return { pct: 2 + 13 * frac, creep: false };
    case 'analyzing':
      return { pct: 50, creep: true };
    case 'describing':
      // Per-photo fallback path of the grouping step — real counts.
      return { pct: 15 + 40 * frac, creep: false };
    case 'grouped':
      return { pct: 55, creep: false };
    case 'processing':
      return { pct: 55 + 45 * frac, creep: false };
    case 'done':
    case 'error':
      return { pct: 100, creep: false };
  }
}
