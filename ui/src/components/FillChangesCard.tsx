import { MoveRight, X } from 'lucide-react';
import type { FillChange } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AnimatedCheck, LiveDot, PendingDot } from '@/components/motion';
import { FIELD_LABEL, type FillRunState } from '@/components/FillProgressCard';

/* Changes-since-last-fill card: after an item has been autofilled once, edits
 * in the app show up here as was → now rows so the user can see exactly what
 * "Fill changes" will re-type. Statuses come from the same live progress
 * stream as FillProgressCard. Photos are not tracked (owner decision
 * 2026-07-06): photo changes are made directly on the Grailed form. */

function fmt(v: unknown): string {
  if (v == null || v === '') return 'empty';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > 36 ? s.slice(0, 35) + '…' : s;
}

const STATUS_WORD: Record<string, string> = {
  filling: 'filling…',
  ok: 'filled',
  failed: 'failed',
  skipped: 'skipped',
};

interface Props {
  changes: FillChange[];
  lastFillAt: string | null;
  run: FillRunState;
  filling: boolean;
}

export function FillChangesCard({ changes, lastFillAt, run, filling }: Props) {
  if (!lastFillAt || changes.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Changed since last fill</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{changes.length}</span>
      </div>
      <ul className="space-y-2.5">
        {changes.map((c) => {
          // A row's presence already means "not filled yet" — on success the
          // snapshot advances and the row disappears at the next refetch. So
          // the run stream is consulted live during a fill, and afterwards
          // only for failures (those rows persist); an older run's ok/skipped
          // would mislabel a fresh edit as "filled".
          const raw = run.fields[c.field]?.status;
          const st = filling ? raw : raw === 'failed' ? raw : undefined;
          return (
            <li key={c.field} className="flex items-start gap-2.5">
              <span className="pt-0.5">
                {st === 'ok' ? (
                  <AnimatedCheck />
                ) : st === 'filling' ? (
                  <LiveDot />
                ) : st === 'failed' ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                ) : (
                  <PendingDot />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-medium">{FIELD_LABEL[c.field] ?? c.field}</span>
                  <span
                    className={cn(
                      'shrink-0 text-[11px]',
                      st === 'failed' ? 'text-destructive' : st === 'ok' ? 'text-success' : 'text-muted-foreground'
                    )}
                  >
                    {STATUS_WORD[st ?? ''] ?? 'will fill'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                  <span className="truncate text-muted-foreground line-through decoration-muted-foreground/40">
                    {fmt(c.from)}
                  </span>
                  <MoveRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground/90">{fmt(c.to)}</span>
                </div>
                {st === 'failed' && run.fields[c.field]?.reason && (
                  <div className="mt-0.5 text-xs text-destructive">{run.fields[c.field].reason}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!filling && (
        <p className="mt-3 border-t pt-2.5 text-xs text-muted-foreground">
          “Fill changes” re-types just these fields — the rest of the form stays as you filled it. Photos aren’t
          tracked; adjust those directly on the Grailed form.
        </p>
      )}
    </section>
  );
}
