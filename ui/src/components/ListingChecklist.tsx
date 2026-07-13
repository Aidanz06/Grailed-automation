import type { Item } from '@/types';
import { buildRows } from '@/lib/readiness';
import { AnimatedCheck, PendingDot, ProgressBar } from '@/components/motion';

// Right-rail readiness checklist (UI redesign 2026-07-04): every row is
// computed from the item itself and clicking a row scrolls to the section
// that fixes it. Required rows drive the n/N counter; tagged rows (verify /
// optional) inform without inflating the count. This is guidance only — it
// gates nothing, and the final review + publish always happens manually in
// Chrome. Row derivation lives in lib/readiness.ts, shared with the sidebar
// triage chips and the Finish-drafts queue (R1/R2).

export function ListingChecklist({ item }: { item: Item }) {
  const rows = buildRows(item);
  const req = rows.filter((r) => r.required);
  const done = req.filter((r) => r.state === 'done').length;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-baseline">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Listing checklist</span>
        <span className="ml-auto font-mono text-sm font-medium tabular-nums">
          {done} / {req.length}
        </span>
      </div>
      <ProgressBar pct={(done / req.length) * 100} className="mb-3" />
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => jump(r.jumpTo)}
              title="Jump to this section"
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/60"
            >
              {r.state === 'done' ? (
                <AnimatedCheck />
              ) : r.state === 'warn' ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-[11px] font-bold text-warning">
                  !
                </span>
              ) : (
                <PendingDot />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-tight">
                  {r.label}
                  {r.tag && (
                    <span className="ml-1.5 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                      {r.tag}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 border-t pt-2.5 text-xs text-muted-foreground">
        The last step is always yours: review and publish in the Chrome window — the app never submits.
      </p>
    </section>
  );
}
