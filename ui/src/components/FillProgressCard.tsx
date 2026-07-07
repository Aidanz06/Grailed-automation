import { Minus, X } from 'lucide-react';
import type { FillProgress } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AnimatedCheck, LiveDot, PendingDot, ProgressBar } from '@/components/motion';

/* S3 live fill checklist: renders the driver's per-field progress stream while
 * "Fill listing in Chrome" runs (~20s, human-paced). Rows appear from the
 * up-front plan event and tick off as each field is actually filled — the
 * driver never submits; this only mirrors what it did. */

export interface FieldState {
  status: 'pending' | 'filling' | 'ok' | 'failed' | 'skipped';
  done?: number;
  total?: number;
  reason?: string;
}

export type FillRunState = { plan: string[]; fields: Record<string, FieldState> };

export const emptyFillRun = (): FillRunState => ({ plan: [], fields: {} });

/** Fold one progress event into the run state (pure — call from a reducer/setState). */
export function applyFillProgress(run: FillRunState, p: FillProgress): FillRunState {
  if (p.kind === 'plan') {
    return { plan: p.fields, fields: Object.fromEntries(p.fields.map((f) => [f, { status: 'pending' as const }])) };
  }
  const prev = run.fields[p.field] ?? { status: 'pending' };
  return {
    ...run,
    fields: {
      ...run.fields,
      [p.field]: {
        status: p.status,
        done: p.done ?? prev.done,
        total: p.total ?? prev.total,
        reason: p.reason,
      },
    },
  };
}

export const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  price: 'Price',
  condition: 'Condition',
  color: 'Color',
  style: 'Style',
  countryOfOrigin: 'Country of origin',
  category: 'Category',
  size: 'Size',
  subcategory: 'Sub-category',
  designer: 'Designer',
  photos: 'Photos',
};

function RowIcon({ s }: { s: FieldState['status'] }) {
  if (s === 'ok') return <AnimatedCheck />;
  if (s === 'failed')
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <X className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  if (s === 'skipped')
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Minus className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  if (s === 'filling') return <LiveDot />;
  return <PendingDot />;
}

interface Props {
  run: FillRunState;
  filling: boolean;
}

export function FillProgressCard({ run, filling }: Props) {
  if (!run.plan.length) return null;
  const settled = run.plan.filter((f) => {
    const s = run.fields[f]?.status;
    return s === 'ok' || s === 'failed' || s === 'skipped';
  }).length;
  const pct = Math.round((settled / run.plan.length) * 100);
  const failed = run.plan.filter((f) => run.fields[f]?.status === 'failed');

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {filling ? 'Filling in Chrome…' : 'Last fill'}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {settled}/{run.plan.length}
        </span>
      </div>
      <ProgressBar pct={pct} live={filling} warn={failed.length > 0} className="mb-3" />
      {filling && (
        <p className="mb-2 text-xs text-muted-foreground">
          Filling into the Chrome tab on the Sell form — nothing is submitted.
        </p>
      )}
      <ul className="space-y-1.5">
        {run.plan.map((f) => {
          const st = run.fields[f] ?? { status: 'pending' as const };
          const label =
            f === 'photos' && st.total
              ? `Photos (${st.done ?? 0}/${st.total})`
              : FIELD_LABEL[f] ?? f;
          return (
            <li key={f} className="flex items-start gap-2 text-[13px]">
              <RowIcon s={st.status} />
              <span className="min-w-0 flex-1 pt-0.5">
                <span className={cn(st.status === 'pending' && 'text-muted-foreground', st.status === 'failed' && 'text-destructive')}>
                  {label}
                </span>
                {st.status === 'failed' && st.reason && (
                  <span className="block text-xs text-muted-foreground">{st.reason}</span>
                )}
                {st.status === 'skipped' && st.reason && (
                  <span className="block text-xs text-muted-foreground">{st.reason}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {!filling && failed.length > 0 && (
        <p className="mt-2 text-xs text-warning">
          {failed.length} field{failed.length > 1 ? 's' : ''} didn’t fill — set {failed.length > 1 ? 'them' : 'it'} manually in Chrome.
        </p>
      )}
    </section>
  );
}
