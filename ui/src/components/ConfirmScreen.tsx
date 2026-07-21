import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardCheck } from 'lucide-react';
import type { Item } from '@/types';
import { api, type AutofillOptions } from '@/lib/api';
import { readiness } from '@/lib/readiness';
import { matchShortcut } from '@/lib/shortcuts';
import { cn, errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SaveChip } from '@/components/SaveChip';
import { CoverThumb } from '@/components/CoverThumb';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ConfirmCard } from '@/components/ConfirmCard';

interface Props {
  /** Drafts waiting to post — the pass walks the ones with gaps. */
  drafts: Item[];
  toast: (msg: string) => void;
  /** Escape hatch for gaps the card can't fix inline (photos, comps). */
  onOpenItem: (id: number) => void;
  /** Leave the pass (App reloads items so editors/sidebar see the fixes). */
  onDone: () => void;
}

/**
 * Confirm-drafts pass (refinement plan §D2 — replaces the R2 FinishScreen,
 * whose gap-only queue it absorbs): one draft at a time as a Structured
 * Confirm Card, walked with the keyboard (J/K/arrows prev-next,
 * Cmd/Ctrl+Enter save-and-next — same bindings as the workspace, from
 * lib/shortcuts.ts). Drafts that were already complete never appear.
 * Debounced autosave down the same saveItem path; values are always the
 * seller's own; the staged category gate is unchanged; nothing here touches
 * Grailed.
 */
export function ConfirmScreen({ drafts, toast, onOpenItem, onDone }: Props) {
  // Frozen at mount: fixing a draft flips its dot to done instead of yanking
  // it out from under the pass.
  const queue = useMemo(() => drafts.filter((d) => !readiness(d).ready).map((d) => structuredClone(d)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Record<number, Item>>(() => Object.fromEntries(queue.map((d) => [d.id, d])));
  const [idx, setIdx] = useState(0);
  const [dirty, setDirty] = useState<Set<number>>(() => new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // UX audit #9 twin of DraftEditor: failed saves re-attempt on this nonce
  // (retry click + 5s auto-retry) instead of fading into looks-like-saved.
  const [saveRetryNonce, setSaveRetryNonce] = useState(0);
  const [recomputing, setRecomputing] = useState<Set<number>>(() => new Set());
  // Pending Department||Category picks, staged until Confirm (A1 gate).
  const [pendingCat, setPendingCat] = useState<Record<number, string>>({});
  const [fillOptions, setFillOptions] = useState<AutofillOptions>({ colors: [], styles: [], categoryTree: {} });
  useEffect(() => {
    api.getAutofillOptions().then(setFillOptions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty.size) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      const ids = [...dirty];
      Promise.all(
        ids.map((id) => {
          const v = values[id];
          // Photos/descParts aren't edited here — omitted fields stay unchanged.
          return api.saveItem(id, { content: v.content, attributes: v.attributes, range: v.range });
        })
      )
        .then(() => {
          setDirty(new Set());
          setSaveState('saved');
        })
        .catch((err) => {
          console.error('[confirm] save failed', err);
          setSaveState('failed'); // persistent chip — dirty ids stay queued for the retry
          toast(`Save failed: ${errorMessage(err)}`);
        });
    }, 800);
    return () => clearTimeout(t);
  }, [values, dirty, toast, saveRetryNonce]);

  // Auto-retry while failed (the dirty set still holds the unsaved ids).
  useEffect(() => {
    if (saveState !== 'failed') return;
    const t = setTimeout(() => setSaveRetryNonce((n) => n + 1), 5000);
    return () => clearTimeout(t);
  }, [saveState, saveRetryNonce]);

  const edit = (id: number, recipe: (d: Item) => void) => {
    setValues((prev) => {
      const draft = structuredClone(prev[id]);
      recipe(draft);
      return { ...prev, [id]: draft };
    });
    setDirty((prev) => new Set(prev).add(id));
  };

  const recompute = (id: number) => {
    setRecomputing((prev) => new Set(prev).add(id));
    api
      .recomputeComps(values[id].attributes)
      .then(({ range, providerName }) => {
        edit(id, (d) => {
          d.range = range;
        });
        toast(`Recomputed from ${providerName}: ${range.low != null ? `$${range.low}–$${range.high}` : 'no range'}.`);
      })
      .catch((err) => toast(`Recompute failed: ${errorMessage(err)}`))
      .finally(() =>
        setRecomputing((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        })
      );
  };

  const cur = queue[idx] ? values[queue[idx].id] : null;
  const remaining = queue.filter((d) => !readiness(values[d.id]).ready).length;
  const go = (dir: 1 | -1) => setIdx((i) => Math.min(queue.length - 1, Math.max(0, i + dir)));

  // Same bindings as the workspace (lib/shortcuts.ts is the single source):
  // J/K/arrows walk the queue, Cmd/Ctrl+Enter advances even mid-typing (the
  // debounced autosave has the edit already). No fill from here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e);
      if (id === 'nextDraft' || id === 'saveAndNext') {
        e.preventDefault();
        go(1);
      } else if (id === 'prevDraft') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={onDone}>
          <ArrowLeft /> Done
        </Button>
        <ClipboardCheck className="h-4 w-4 text-primary" />
        {/* §F serif discipline: Instrument Serif stays reserved for the
            wordmark + the big price — screen titles are plain UI type. */}
        <span className="text-sm font-semibold">Confirm drafts</span>
        <span className="ml-2 text-sm text-muted-foreground">
          {queue.length === 0
            ? 'nothing needs attention'
            : remaining === 0
              ? `all ${queue.length} confirmed`
              : `${remaining} of ${queue.length} still need${remaining === 1 ? 's' : ''} attention`}
        </span>
        <span className="flex-1" />
        <SaveChip state={saveState} onRetry={() => setSaveRetryNonce((n) => n + 1)} />
        <ThemeToggle />
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {queue.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Every draft is ready — nothing needs attention.
            </div>
          ) : (
            <>
              {/* Queue strip: one thumb per draft, done-state dot, click to jump. */}
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                {queue.map((d, i) => {
                  const v = values[d.id];
                  const done = readiness(v).ready;
                  return (
                    <button
                      key={d.id}
                      title={v.content?.title ?? `item #${d.id}`}
                      className={cn(
                        'relative h-11 w-9 overflow-hidden rounded border transition-all',
                        i === idx ? 'border-primary ring-1 ring-primary' : 'border-border opacity-70 hover:opacity-100'
                      )}
                      onClick={() => setIdx(i)}
                    >
                      <CoverThumb photo={v.photos[0]} className="absolute inset-0" />
                      <span
                        className={cn('absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full', done ? 'bg-success' : 'bg-warning')}
                      />
                    </button>
                  );
                })}
              </div>

              {cur && (
                <ConfirmCard
                  item={cur}
                  fillOptions={fillOptions}
                  pendingCatKey={pendingCat[cur.id] ?? ''}
                  onPendingCat={(key) => setPendingCat((prev) => ({ ...prev, [cur.id]: key }))}
                  recomputing={recomputing.has(cur.id)}
                  edit={(recipe) => edit(cur.id, recipe)}
                  onRecompute={() => recompute(cur.id)}
                  onOpenEditor={() => onOpenItem(cur.id)}
                />
              )}

              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={idx === 0} onClick={() => go(-1)}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Prev
                </Button>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {idx + 1} of {queue.length}
                </span>
                {idx < queue.length - 1 ? (
                  <Button size="sm" onClick={() => go(1)} title="Also: J / ↓ or Cmd/Ctrl+Enter">
                    Next draft <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" onClick={onDone}>
                    Done
                  </Button>
                )}
                <span className="flex-1" />
                <span className="text-xs text-muted-foreground">Everything saves automatically. Nothing here touches Grailed.</span>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
