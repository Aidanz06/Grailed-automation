import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, FolderOpen } from 'lucide-react';
import { api, type BatchProgress, type BatchResult } from '@/lib/api';
import { cn, errorMessage } from '@/lib/utils';
import { importProgress } from '@/lib/importProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnimatedCheck, LiveDot, PendingDot, PhotoShuffler, ProgressBar } from '@/components/motion';

interface Props {
  toast: (msg: string) => void;
  /** Called after a successful import so the caller can reload items —
   * navigation happens from the summary screen's own buttons. */
  onImported: (result: BatchResult) => void;
  /** Open an item from the batch summary (selects it in the workspace). */
  onOpenItem: (id: number) => void;
  /** Land on the batch board scoped to this import (refinement plan §C —
   * the batch, not the first item, is the unit of the review pass). */
  onOpenBoard: (result: BatchResult) => void;
  /** "New batch" wants the OS folder picker opened on entry, skipping the
   * drop-zone click (audit §2.4). Fired once, only when idle with no summary. */
  autoPick?: boolean;
  onAutoPickConsumed?: () => void;
}

// Survives unmount/remount: an import finishing while the user is elsewhere
// still gets its summary when they come back to the Import screen.
let lastResult: BatchResult | null = null;

export function ImportScreen({ toast, onImported, onOpenItem, onOpenBoard, autoPick, onAutoPickConsumed }: Props) {
  const [busy, setBusy] = useState(false);
  // Summary of the just-finished batch (real-run feedback 2026-07-04): shown in
  // place of the folder picker until "Import another folder".
  const [result, setResult] = useState<BatchResult | null>(lastResult);
  // Live batch progress (integration plan P1.4): grouping is one long vision
  // call, then each group runs the full pipeline — show stage + counts instead
  // of a frozen spinner. Events are NOT gated on this instance having started
  // the batch: an import keeps running in the main process while the user
  // navigates away, so a remounted Import screen re-attaches to the stream
  // instead of showing an idle picker over a live batch.
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  // "N group(s) from M photo(s)" — kept once known so the drafts step can show
  // it even after later events replace `progress`.
  const [groupedLabel, setGroupedLabel] = useState<string | null>(null);
  // Streamed drafts: the first draft saved mid-batch — editing can start on it
  // while the rest of the groups are still pricing/writing.
  const [earlyDraft, setEarlyDraft] = useState<{ id: number; title: string | null } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const busyRef = useRef(false);
  useEffect(() => {
    const off = api.onBatchProgress((p) => {
      setProgress(p);
      if (p.stage === 'grouped') setGroupedLabel(p.label);
      if (p.item) {
        setSavedCount((n) => n + 1);
        if (p.item.status === 'draft' && p.item.itemId != null) {
          const id = p.item.itemId;
          const title = p.item.title ?? null;
          setEarlyDraft((cur) => cur ?? { id, title });
        }
      }
      // Terminal event for a batch this instance didn't await (started before
      // a remount): show the final state briefly, then return to the picker.
      // The initiator path clears immediately in its own finally block.
      if ((p.stage === 'done' || p.stage === 'error') && !busyRef.current) {
        setTimeout(
          () => setProgress((cur) => (cur && (cur.stage === 'done' || cur.stage === 'error') ? null : cur)),
          2500
        );
      }
    });
    return off;
  }, []);

  // A batch is in flight — either one we started (busy) or one inherited from
  // before a remount (non-terminal progress). Blocks starting a second batch.
  const running = busy || (progress != null && progress.stage !== 'done' && progress.stage !== 'error');

  const onClick = async () => {
    if (running) return;
    try {
      const folder = await api.pickBatchFolder();
      if (!folder) return; // canceled
      setBusy(true);
      busyRef.current = true;
      setGroupedLabel(null);
      setEarlyDraft(null);
      setSavedCount(0);
      setResult(null);
      lastResult = null;
      setProgress({ stage: 'grouping', done: 0, total: 0, label: 'Starting…' });
      const res = await api.processBatch(folder);
      lastResult = res;
      setResult(res);
      // Toast still matters for a BACKGROUND completion (user is on another
      // screen and can't see the summary); on-screen it just echoes it.
      toast(
        `Imported ${res.photoCount} photo(s) → ${res.drafts} draft(s), ${res.review} to review.` +
          (res.groupingNotice ? ` ${res.groupingNotice}` : '') +
          (res.processingNotice ? ` ${res.processingNotice}` : '')
      );
      onImported(res);
    } catch (e) {
      console.error('[batch] import failed', e);
      const msg = errorMessage(e);
      // Beta Part D/E: a keyless build fails here first — route that to the
      // friendly setup message instead of a raw pipeline error.
      const cfg = await api.getConfigStatus().catch(() => null);
      if (cfg && !cfg.hasAnthropicKey) {
        toast(
          'This copy isn’t finished setting up (it’s missing an API key), so importing can’t work yet — reach out to whoever shared it with you.'
        );
      } else {
        toast(msg.includes('grouping failed') ? `The import didn’t finish — ${msg}` : `The import didn’t finish — ${msg}. Try the folder again; nothing was posted to Grailed.`);
      }
    } finally {
      setBusy(false);
      busyRef.current = false;
      setProgress(null);
    }
  };

  // Audit §2.4: "New batch" opens the folder picker on entry. Fire once, only
  // when idle and not showing a summary — never interrupt a running batch or a
  // just-finished summary the user navigated back to.
  useEffect(() => {
    if (!autoPick) return;
    onAutoPickConsumed?.();
    if (!running && !result) onClick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPick]);

  // Weighted overall bar — the numbers live in lib/importProgress (QW-5),
  // shared with the thin BatchProgressBar. This screen renders `creep` (the
  // single denominator-less vision call) as a slow CSS transition toward the
  // target (~ the call's typical duration) instead of freezing.
  const { pct, creep } = progress ? importProgress(progress) : { pct: 0, creep: false };

  // Step checklist derived from the latest event. describing (per-photo
  // fallback path) belongs to the AI-grouping step, with real counts.
  const stepOf: Record<NonNullable<typeof progress>['stage'], number> = {
    grouping: 0,
    preparing: 0,
    describing: 1,
    analyzing: 1,
    grouped: 2,
    processing: 2,
    done: 3,
    error: 3,
  };
  const current = progress ? stepOf[progress.stage] : 0;
  const steps = [
    {
      name: 'Prepare photos',
      sub:
        current > 0
          ? 'ready'
          : progress?.stage === 'preparing'
            ? `${progress.done}/${progress.total}`
            : 'scanning folder…',
    },
    {
      name: 'AI grouping',
      sub:
        current > 1
          ? groupedLabel ?? 'grouped'
          : progress?.stage === 'describing'
            ? `photo ${progress.done}/${progress.total}`
            : progress?.stage === 'analyzing'
              ? 'all photos in one pass…'
              : 'waiting',
    },
    {
      name: 'Price + write drafts',
      sub:
        current > 2
          ? 'complete'
          : progress?.stage === 'processing' || progress?.stage === 'grouped'
            ? `group ${Math.min(progress.done + 1, progress.total)}/${progress.total}`
            : 'waiting',
    },
  ];

  // Post-import summary: what the batch produced, each group openable. Shown
  // until the user starts another folder (survives navigating away and back).
  if (result && !running) {
    const rows = result.processed;
    return (
      <div className="flex h-full items-start justify-center overflow-y-auto p-6">
        <div className="rise-in w-full max-w-2xl">
          <div className="mb-1 flex items-center gap-2.5">
            <AnimatedCheck />
            <h2 className="text-lg font-semibold">Import complete</h2>
          </div>
          <div className="mb-4 font-mono text-xs text-muted-foreground">
            {result.photoCount} photos → {result.groups} groups · {result.drafts} drafted · {result.review} to review
          </div>
          {(result.groupingNotice || result.processingNotice) && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-l-[3px] border-l-warning bg-secondary/40 p-3 text-sm- text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                {result.groupingNotice} {result.processingNotice}
              </span>
            </div>
          )}
          <ul className="mb-5 space-y-1.5">
            {rows.map((p) => {
              const isDraft = p.status === 'draft';
              return (
                <li
                  key={p.groupId}
                  className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 border-transparent px-2 py-0 text-2xs uppercase tracking-wide',
                      isDraft ? 'bg-primary/15 text-primary' : 'bg-warning/15 text-warning'
                    )}
                  >
                    {isDraft ? 'draft' : 'review'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {p.title || p.signature || `Group ${p.groupId}`}
                    </div>
                    {p.error && <div className="truncate text-xs text-destructive">{p.error}</div>}
                  </div>
                  {p.itemId != null && (
                    <Button variant="outline" size="sm" onClick={() => onOpenItem(p.itemId!)}>
                      Open <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2.5">
            <Button
              className="glow-primary"
              title="See the whole batch as cards — what's ready, what needs attention, and the next thing to fix on each."
              onClick={() => onOpenBoard(result)}
            >
              Review the batch <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                lastResult = null;
                setResult(null);
              }}
            >
              Import another folder
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg">
      <button
        onClick={onClick}
        disabled={running}
        className="w-full rounded-2xl border-2 border-dashed border-border p-12 text-center text-muted-foreground transition-colors hover:border-primary disabled:cursor-not-allowed"
      >
        {running ? (
          <PhotoShuffler />
        ) : (
          <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground/70" strokeWidth={1.5} />
        )}
        <div className="mt-2 text-lg font-semibold text-foreground">
          {running ? 'Processing photos…' : 'Choose a photo folder'}
        </div>

        {progress ? (
          <div className="mx-auto mt-4 max-w-md text-left">
            <ProgressBar
              pct={Math.max(3, pct)}
              live={progress.stage !== 'done' && progress.stage !== 'error'}
              warn={progress.stage === 'error'}
              className="h-2"
              // Slow creep during the single opaque vision call; snappy otherwise.
              transition={`width ${creep ? 25000 : 400}ms ${creep ? 'ease-out' : 'ease'}`}
            />
            {/* Stage checklist — each step with live counts where a real denominator exists. */}
            <ul className="mt-3 space-y-1.5">
              {steps.map((s, i) => {
                const state = progress.stage === 'error' ? 'error' : i < current ? 'done' : i === current ? 'active' : 'pending';
                return (
                  <li key={s.name} className="flex items-center gap-2.5 text-sm">
                    {state === 'done' ? <AnimatedCheck /> : state === 'active' ? <LiveDot /> : <PendingDot />}
                    <span className={state === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>{s.name}</span>
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{s.sub}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2.5 text-xs text-muted-foreground">{progress.label}</div>
          </div>
        ) : (
          <>
            <div className="mt-1 text-sm">Click to browse for a batch folder</div>
            <div className="mx-auto mt-4 max-w-md text-xs text-muted-foreground/80">
              Tailor groups the photos by item, then prices and writes a draft for each group it’s confident about —
              anything uncertain is set aside for your review instead of guessed. Nothing is posted to Grailed.
            </div>
          </>
        )}
      </button>
      {/* Streamed drafts: don't make the user wait for the whole batch —
          the first saved draft is editable the moment it exists. The import
          keeps running in the background (persistent top strip + summary). */}
      {running && earlyDraft && (
        <div className="rise-in mt-3 flex items-center gap-3 rounded-lg border bg-card p-3">
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium">{earlyDraft.title ?? 'First draft ready'}</div>
            <div className="text-xs text-muted-foreground">
              {savedCount} saved so far — the rest keep processing while you edit.
            </div>
          </div>
          <Button size="sm" className="glow-primary shrink-0" onClick={() => onOpenItem(earlyDraft.id)}>
            Start editing <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}
