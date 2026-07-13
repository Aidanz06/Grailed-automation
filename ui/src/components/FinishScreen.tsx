import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardCheck, RefreshCw } from 'lucide-react';
import type { Item } from '@/types';
import { api, type AutofillOptions } from '@/lib/api';
import { readiness } from '@/lib/readiness';
import { suggestGrailedCategory } from '@/lib/grailedCategory';
import { cn, errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AnimatedCheck } from '@/components/motion';
import { CONDITIONS } from '@/components/DraftEditor';

interface Props {
  /** Drafts waiting to post — the Finish pass walks the ones with gaps. */
  drafts: Item[];
  toast: (msg: string) => void;
  /** Escape hatch for gaps this screen can't fix inline (e.g. photos). */
  onOpenItem: (id: number) => void;
  /** Leave the pass (App reloads items so editors/sidebar see the fixes). */
  onDone: () => void;
}

/**
 * "Finish drafts" attention queue (UX streamlining R2): one pass over the
 * batch that shows ONLY the unresolved required fields of each draft — a
 * seller resolves every gap without opening a single full editor. Modeled on
 * MeasureScreen: debounced autosave down the same saveItem path, values are
 * always the seller's own (nothing is guessed), and the category keeps its
 * staged confirmation — a suggestion fills nothing until Confirm is clicked.
 */
export function FinishScreen({ drafts, toast, onOpenItem, onDone }: Props) {
  // Drafts that were already complete never appear (spec: zero interaction
  // for correct drafts). The queue is frozen at mount; fixing a draft shows a
  // ✓ instead of yanking the card away mid-pass.
  const queue = useMemo(() => drafts.filter((d) => !readiness(d).ready).map((d) => structuredClone(d)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Record<number, Item>>(() => Object.fromEntries(queue.map((d) => [d.id, d])));
  const [dirty, setDirty] = useState<Set<number>>(() => new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [recomputing, setRecomputing] = useState<Set<number>>(() => new Set());
  // Combined Department › Category picks per item, pending until Confirm —
  // the A1 staged gate is unchanged (never blind-filled from a suggestion).
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
          // Photos/descParts/measurements aren't edited here — omitting them
          // leaves them unchanged in the store.
          return api.saveItem(id, { content: v.content, attributes: v.attributes, range: v.range });
        })
      )
        .then(() => {
          setDirty(new Set());
          setSaveState('saved');
        })
        .catch((err) => {
          console.error('[finish] save failed', err);
          setSaveState('idle');
          toast(`Save failed: ${errorMessage(err)}`);
        });
    }, 800);
    return () => clearTimeout(t);
  }, [values, dirty, toast]);

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

  const catPairs = Object.entries(fillOptions.categoryTree).flatMap(([dept, cats]) => cats.map((cat) => ({ dept, cat })));
  const remaining = queue.filter((d) => !readiness(values[d.id]).ready).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={onDone}>
          <ArrowLeft /> Done
        </Button>
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <span className="font-display text-lg tracking-tight">Finish drafts</span>
        <span className="ml-2 text-sm text-muted-foreground">
          {remaining === 0
            ? `All ${drafts.length} drafts are ready`
            : `${remaining} of ${drafts.length} draft${drafts.length === 1 ? '' : 's'} still need${remaining === 1 ? 's' : ''} attention`}
        </span>
        <span className="flex-1" />
        {saveState !== 'idle' && (
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 text-xs transition-colors duration-300',
              saveState === 'saving' ? 'border-success/50 text-muted-foreground' : 'border-success bg-success/20 text-success'
            )}
          >
            {saveState === 'saving' ? 'Saving…' : 'Saved'}
          </span>
        )}
        <ThemeToggle />
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <p className="mb-5 text-sm text-muted-foreground">
            Only the gaps are shown — drafts that were already complete are skipped, and everything you type saves
            automatically. Nothing is guessed for you, and nothing here touches Grailed.
          </p>
          {queue.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Every draft is ready — nothing needs attention.
            </div>
          ) : (
            <ul className="space-y-3">
              {queue.map((orig) => {
                const it = values[orig.id];
                const r = readiness(it);
                const gaps = new Set(r.rows.filter((row) => row.state !== 'done').map((row) => row.key));
                const attrs = it.attributes;
                const suggestion = suggestGrailedCategory(attrs);
                const pendingKey =
                  pendingCat[it.id] ?? (suggestion ? `${suggestion.department}||${suggestion.category}` : '');
                const busy = recomputing.has(it.id);
                return (
                  <li key={it.id} className={cn('rounded-lg border bg-card p-3', r.ready && 'opacity-80')}>
                    <div className="mb-2.5 flex items-center gap-3">
                      <span
                        className="relative h-12 w-10 shrink-0 overflow-hidden rounded"
                        style={{ background: it.photos[0]?.tint ?? '#333' }}
                      >
                        {it.photos[0]?.src && (
                          <img
                            src={it.photos[0].src}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.content?.title || `(untitled — item #${it.id})`}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.ready ? 'ready to fill' : `${r.doneCount}/${r.requiredCount} required fields done`}
                        </div>
                      </div>
                      {r.ready ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                          <AnimatedCheck /> Ready
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => onOpenItem(it.id)} title="Open the full editor for this draft">
                          Open <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>

                    {!r.ready && (
                      <div className="space-y-2.5">
                        {gaps.has('photos') && (
                          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                            <span className="min-w-0 flex-1">No photos in this group — that needs the full editor.</span>
                            <Button variant="outline" size="sm" onClick={() => onOpenItem(it.id)}>
                              Open editor
                            </Button>
                          </div>
                        )}
                        {gaps.has('title') && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Title</span>
                            <Input
                              value={it.content?.title ?? ''}
                              placeholder="write a title"
                              onChange={(e) =>
                                edit(it.id, (d) => {
                                  if (d.content) d.content.title = e.target.value;
                                })
                              }
                            />
                          </div>
                        )}
                        {gaps.has('description') && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Description</span>
                            <Textarea
                              value={it.content?.description ?? ''}
                              placeholder="write a description"
                              className="min-h-[80px] font-mono text-[13px]"
                              onChange={(e) =>
                                edit(it.id, (d) => {
                                  if (d.content) d.content.description = e.target.value;
                                })
                              }
                            />
                          </div>
                        )}
                        {gaps.has('brand') && (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-[200px] flex-col gap-1">
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Brand — low confidence, check the tags
                              </span>
                              <Input
                                value={attrs.resembles_brand}
                                placeholder="brand on the tag"
                                onChange={(e) =>
                                  edit(it.id, (d) => {
                                    d.attributes.resembles_brand = e.target.value;
                                  })
                                }
                              />
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              title="Records that you checked the physical tag — the low-confidence warning goes away."
                              onClick={() =>
                                edit(it.id, (d) => {
                                  d.attributes.brand_confidence = 1;
                                })
                              }
                            >
                              I checked — it’s right
                            </Button>
                          </div>
                        )}
                        {gaps.has('category') && (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-[240px] flex-col gap-1">
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Grailed category{suggestion ? ` — suggested from “${suggestion.basedOn}”` : ''}
                              </span>
                              <Select
                                value={pendingKey || undefined}
                                onValueChange={(v) => setPendingCat((prev) => ({ ...prev, [it.id]: v }))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="choose category" />
                                </SelectTrigger>
                                <SelectContent>
                                  {catPairs.map(({ dept, cat }) => (
                                    <SelectItem key={`${dept}||${cat}`} value={`${dept}||${cat}`}>
                                      {dept} › {cat}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              size="sm"
                              disabled={!pendingKey}
                              title="Nothing is filled until you confirm — a wrong category cascades into wrong sizes on Grailed."
                              onClick={() => {
                                const [dept, cat] = pendingKey.split('||');
                                if (!dept || !cat) return;
                                edit(it.id, (d) => {
                                  d.attributes.grailed_department = dept;
                                  d.attributes.grailed_category = cat;
                                });
                              }}
                            >
                              Confirm
                            </Button>
                          </div>
                        )}
                        {gaps.has('size') && (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-[140px] flex-col gap-1">
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Size{attrs.size_unclear ? ' — guessed, check the tag' : ''}
                              </span>
                              <Input
                                value={attrs.size}
                                placeholder="e.g. L"
                                className={cn(!attrs.size && 'border-dashed')}
                                onChange={(e) =>
                                  edit(it.id, (d) => {
                                    d.attributes.size = e.target.value;
                                  })
                                }
                              />
                            </div>
                            {attrs.size_unclear && attrs.size && (
                              <Button
                                variant="outline"
                                size="sm"
                                title="Records that you checked the physical tag — the guessed-size warning goes away."
                                onClick={() =>
                                  edit(it.id, (d) => {
                                    d.attributes.size_unclear = false;
                                  })
                                }
                              >
                                Verified from tag
                              </Button>
                            )}
                          </div>
                        )}
                        {gaps.has('condition') && (
                          <div className="flex min-w-[200px] max-w-[280px] flex-col gap-1">
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Condition</span>
                            <Select
                              value={attrs.condition_rating && attrs.condition_rating !== 'Unclear' ? attrs.condition_rating : undefined}
                              onValueChange={(v) =>
                                edit(it.id, (d) => {
                                  d.attributes.condition_rating = v;
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={attrs.condition_rating === 'Unclear' ? 'unclear from photos — judge it' : 'pick a condition'} />
                              </SelectTrigger>
                              <SelectContent>
                                {CONDITIONS.filter((c) => c !== 'Unclear').map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {gaps.has('price') && (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-[120px] flex-col gap-1">
                              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Price ($)</span>
                              <Input
                                value={it.range?.median ?? ''}
                                inputMode="numeric"
                                placeholder="your price"
                                className={cn(it.range?.median == null && 'border-dashed')}
                                onChange={(e) =>
                                  edit(it.id, (d) => {
                                    const v = e.target.value;
                                    const median = v === '' ? null : Number(v);
                                    if (d.range) d.range.median = median;
                                    else if (median != null)
                                      d.range = { currency: 'USD', low: null, median, high: null, mostRelevantComps: [] };
                                  })
                                }
                              />
                            </div>
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => recompute(it.id)}>
                              <RefreshCw className={busy ? 'animate-spin' : ''} />
                              {busy ? 'recomputing…' : 'Recompute from comps'}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
