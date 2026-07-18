import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import type { Comp, Item, PriceRange } from '@/types';
import { api } from '@/lib/api';
import { cn, errorMessage, money } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Estimate-confidence pill (owner request 2026-07-05; restyled to the
// owner's 2026-07-14 mock — outlined, rounded-full). Level and the 95% CI
// on the median come from pipeline/range.js; details live in the tooltip.
const CONF_CLASS: Record<string, string> = {
  high: 'border-success/60 text-success',
  medium: 'border-warning/60 text-warning',
  low: 'border-input text-muted-foreground',
};

// Suggested-price card for the right rail (owner mock 2026-07-14): editable
// serif price + range + confidence pill on one row, a range bar whose
// geometry is the REAL data (track = full comp span, brass segment = the
// comp range, marker = your price), comps count + CI95 under it, then the
// top comps. Same data + recompute behavior as before.

interface Props {
  item: Item;
  update: (recipe: (draft: Item) => void) => void;
  toast: (msg: string) => void;
}

/** Where the range and your price sit inside everything that actually sold.
 * Track = min→max of the comp prices (padded); brass segment = the comps
 * range (low–high); bright marker = the editable price. Pure CSS, real
 * numbers — every position is a computed percentage of the price domain. */
function RangeBar({ r, comps }: { r: PriceRange; comps: Comp[] }) {
  if (r.low == null || r.high == null) return null;
  const prices = comps.map((c) => c.price).filter((p) => p > 0);
  const dMin = Math.min(r.low, ...(prices.length ? prices : [r.low]));
  const dMax = Math.max(r.high, ...(prices.length ? prices : [r.high]));
  const pad = (dMax - dMin || dMax || 1) * 0.06;
  const min = Math.max(0, dMin - pad);
  const span = dMax + pad - min || 1;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  return (
    <div
      className="relative mt-3 h-1.5 w-full rounded-full bg-secondary/80"
      title={`Sold comps span ${money(Math.round(dMin))}–${money(Math.round(dMax))} · weighted range ${money(r.low)}–${money(r.high)}${r.median != null ? ` · your price ${money(r.median)}` : ''}`}
    >
      <div
        className="absolute inset-y-0 rounded-full bg-gradient-to-r from-primary/35 via-primary/90 to-primary/35"
        style={{ left: pct(r.low) + '%', width: Math.max(2, pct(r.high) - pct(r.low)) + '%' }}
      />
      {r.median != null && (
        <div
          className="absolute -bottom-0.5 -top-0.5 w-[3px] rounded-full bg-primary"
          style={{ left: `calc(${pct(r.median)}% - 1.5px)`, boxShadow: '0 0 6px hsl(var(--primary))' }}
        />
      )}
    </div>
  );
}

export function PricePanel({ item, update, toast }: Props) {
  const r = item.range;
  const [recomputing, setRecomputing] = useState(false);
  const [open, setOpen] = useState(false);
  // Plan §D: NWT is a strong price signal — badge it, and warn when the
  // estimate had few same-condition sales behind it (likely conservative).
  const isNwt = /^new( with tags)?$/i.test((item.attributes.condition_rating || '').trim());
  const nwtThin = isNwt && (r?.newCompCount ?? 0) < 3 && (r?.sampleSize ?? 0) > 0;

  // Plan §I Smart Pricing state: opt-in flag + floor ride in attributes (like
  // grailed_color — no store migration). The floor suggestion is the D2
  // sold-median ("list at $Y, floor at $X").
  const spOn = item.attributes.smart_pricing_enabled === true;
  const spFloor = item.attributes.smart_pricing_floor ?? null;
  const suggestedFloor = r?.soldMedian ?? null;

  // Slice 4: recompute price/comps from the item's current (possibly edited)
  // attributes via the guarded live-Grailed provider. Result replaces the range
  // and marks the item dirty so Slice 2 auto-save persists it.
  const recompute = () => {
    setRecomputing(true);
    api
      .recomputeComps(item.attributes)
      .then(({ range, providerName, cached }) => {
        update((d) => {
          d.range = range;
          d.showAllComps = false;
          d.dirty = true;
        });
        const span = range.low != null && range.high != null ? ` $${range.low}–$${range.high}` : '';
        const n = range.sampleSize ?? range.mostRelevantComps.length;
        toast(`Recomputed from ${providerName}:${span} (${n} comps${cached ? ', cached' : ''}).`);
      })
      .catch((err) => {
        console.error('[api] recomputeComps failed', err);
        const msg = errorMessage(err);
        toast(
          /circuit/i.test(msg)
            ? 'Pricing is paused as a safety precaution (see the banner up top) — set the price yourself for now.'
            : `Recompute failed: ${msg}`
        );
      })
      .finally(() => setRecomputing(false));
  };

  // M-8 phase 1: the confidence detail, readable without a mouse — the same
  // text rides on the pill's title (hover) and on sr-only content screen
  // readers announce inline. Zero visual change (sr-only is out of flow).
  const confDetail = r?.confidence
    ? `${r.confidence.explanation} ${r.confidence.strongMatches} near-identical + ${r.confidence.moderateMatches} similar comps · effective sample ${r.confidence.effectiveN}. The CI95 below is where the true going rate likely sits, not the min–max of sales.`
    : null;

  const comps: Comp[] = r ? (r.allComps?.length ? r.allComps : r.mostRelevantComps) : [];
  const nComps = r?.sampleSize ?? comps.length;
  const topComps = r?.mostRelevantComps.slice(0, 3) ?? [];

  /** Open a comp on Grailed (system browser, main-process allowlist). */
  const openComp = (c: Comp) => {
    if (!/^https?:\/\//.test(c.url)) return;
    api.openExternal(c.url).catch((err) => toast(`Couldn't open listing: ${errorMessage(err)}`));
  };

  return (
    <section id="sec-price" className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <label className="text-2xs uppercase tracking-wider text-muted-foreground">Suggested price</label>
        <span className="flex-1" />
        <Button variant="outline" size="sm" disabled={recomputing} onClick={recompute}>
          <RefreshCw className={recomputing ? 'animate-spin' : ''} />
          {recomputing ? 'recomputing…' : 'Recompute'}
        </Button>
      </div>

      {!r ? (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No price yet — recompute from sold comps to estimate a range.
        </div>
      ) : (
        <>
          {/* Owner mock 2026-07-14: price + range + confidence on one row.
              The number stays the EDITABLE list price (§D2). */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex items-center">
              <span className="font-display text-3xl text-primary">$</span>
              <Input
                value={r.median ?? ''}
                inputMode="numeric"
                aria-label="Your price"
                className="h-11 w-24 border-transparent px-1 font-display text-3xl text-primary shadow-none focus-visible:border-input"
                onChange={(e) =>
                  update((d) => {
                    const v = e.target.value;
                    d.range!.median = v === '' ? null : Number(v);
                    d.dirty = true;
                  })
                }
              />
            </div>
            {r.low != null && r.high != null && (
              <span className="font-mono text-sm text-muted-foreground">
                range {money(r.low)}–{money(r.high)}
              </span>
            )}
            <span className="flex-1" />
            {r.confidence && (
              <span
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-2xs font-medium',
                  CONF_CLASS[r.confidence.level]
                )}
                title={confDetail ?? undefined}
              >
                {r.confidence.level} confidence
                <span className="sr-only"> — {confDetail}</span>
              </span>
            )}
          </div>
          {/* Plan §D2 list/sell split: the editable number above is the LIST
              price (offer headroom built in); the typical sale shows so
              neither is mistaken for the other. */}
          {r.soldMedian != null && r.soldMedian !== r.median && (
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
              list price — typically sells ~{money(r.soldMedian)}
            </div>
          )}
          {isNwt && (
            <div className="mt-1.5">
              <span className="inline-block rounded-md border border-transparent bg-success/15 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-success">
                New with tags — priced against new-condition sales
              </span>
              {nwtThin && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Few new-with-tags comps behind this estimate — it may be conservative; new pieces often sell above
                  used comps.
                </div>
              )}
            </div>
          )}
          {/* The range bar — real geometry (see RangeBar). */}
          <RangeBar r={r} comps={comps} />
          <div
            className="mt-1.5 font-mono text-xs text-muted-foreground"
            title="CI95 = where the true going rate likely sits (95% interval on the estimate), not the min–max of sales."
          >
            {nComps} sold comp{nComps === 1 ? '' : 's'}
            {r.confidence?.ci95[0] != null && (
              <> · CI95 {money(r.confidence.ci95[0])}–{money(r.confidence.ci95[1])}</>
            )}
          </div>

          {/* Top comps (owner mock): the three most relevant, price right. */}
          {topComps.length > 0 && (
            <div className="mt-3 border-t pt-2.5">
              {topComps.map((c, i) => {
                const hasLink = /^https?:\/\//.test(c.url);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!hasLink}
                    title={hasLink ? `Sold ${c.soldDate} — open on Grailed` : `Sold ${c.soldDate}`}
                    className="group flex w-full items-baseline gap-2 rounded px-1 py-1 text-left text-sm- enabled:cursor-pointer enabled:hover:bg-secondary/50 disabled:cursor-default"
                    onClick={() => openComp(c)}
                  >
                    <span className={cn('min-w-0 flex-1 truncate text-muted-foreground', hasLink && 'group-hover:text-foreground')}>
                      {c.title || c.url}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{money(c.price)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {comps.length > topComps.length && (
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-0.5 text-sm- text-primary hover:underline"
              onClick={() => setOpen((o) => !o)}
            >
              all {nComps} comp{nComps === 1 ? '' : 's'}
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
          {open && (
            <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto pr-1">
              {comps.map((c, i) => {
                const hasLink = /^https?:\/\//.test(c.url);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!hasLink}
                    title={hasLink ? 'Open this sold listing on Grailed' : 'No listing link for this comp'}
                    className="group flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-xs enabled:cursor-pointer enabled:hover:bg-secondary/50 disabled:cursor-default"
                    onClick={() => {
                      if (!hasLink) return;
                      api.openExternal(c.url).catch((err) => toast(`Couldn't open listing: ${errorMessage(err)}`));
                    }}
                  >
                    <span className="w-9 shrink-0 font-medium tabular-nums">{money(c.price)}</span>
                    <span className="w-[4.5rem] shrink-0 font-mono text-muted-foreground">{c.soldDate}</span>
                    <span className={cn('truncate text-muted-foreground', hasLink && 'group-hover:text-foreground group-hover:underline')}>
                      {c.title || c.url}
                    </span>
                    {hasLink && (
                      <ExternalLink className="h-3 w-3 shrink-0 self-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Plan §I: Grailed's NATIVE Smart Pricing — strictly opt-in per item
          (default OFF). Enabling here only records the choice; the next fill
          sets Grailed's own toggle + floor on the Sell form, and the user
          still reviews and publishes. Never auto-enabled, never autonomous.
          Pairs with §D2: the editable number above is the list price, the
          suggested floor is what comparable items typically sold for. */}
      <div
        className={cn(
          'mt-3 rounded-lg border p-3 transition-colors',
          spOn ? 'border-primary/50 bg-primary/5' : 'bg-secondary/30'
        )}
      >
        <label
          className="flex cursor-pointer items-center gap-2"
          title="Grailed's own auto-discount: lowers the price ~10% a week until your floor and nudges likers. Enabling here only records the choice — the next fill sets Grailed's toggle + floor on the Sell form, and you still review and publish."
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={spOn}
            aria-label="Enable Smart Pricing on Grailed for this item"
            onChange={(e) => {
              const on = e.target.checked;
              update((d) => {
                d.attributes.smart_pricing_enabled = on;
                // Seed the floor with the typical-sale figure the first time —
                // still fully editable, and nothing reaches Grailed until the
                // user runs a fill.
                if (on && d.attributes.smart_pricing_floor == null && suggestedFloor != null) {
                  d.attributes.smart_pricing_floor = suggestedFloor;
                }
                d.dirty = true;
              });
            }}
          />
          <span className="text-sm font-medium">Smart Pricing (Grailed)</span>
          {spOn && (
            <span className="rounded-full border border-primary/50 px-2 py-0.5 font-mono text-3xs font-medium uppercase text-primary">
              set at next fill
            </span>
          )}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Grailed’s auto-discount — drops the price weekly until your floor. You still review and publish.
        </p>
        {spOn && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">Floor $</span>
            <Input
              value={spFloor ?? ''}
              inputMode="numeric"
              aria-label="Smart Pricing floor price"
              className="h-8 w-24"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '');
                update((d) => {
                  d.attributes.smart_pricing_floor = digits === '' ? null : Number(digits);
                  d.dirty = true;
                });
              }}
            />
            {suggestedFloor != null && spFloor !== suggestedFloor && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                title="Comparable items typically sold around this — a floor below it rarely helps."
                onClick={() =>
                  update((d) => {
                    d.attributes.smart_pricing_floor = suggestedFloor;
                    d.dirty = true;
                  })
                }
              >
                use ~{money(suggestedFloor)} (typical sale)
              </button>
            )}
            {spOn && (spFloor == null || spFloor <= 0) && (
              <span className="text-xs text-warning">set a floor — the fill skips Smart Pricing without one</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
