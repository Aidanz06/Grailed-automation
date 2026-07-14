import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import type { Comp, Item } from '@/types';
import { api } from '@/lib/api';
import { cn, errorMessage } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + n);

// Estimate-confidence badge (owner request 2026-07-05): duplicate sold
// listings of the item → high; only loosely similar sales → low. Level and
// the 95% CI on the median come from pipeline/range.js.
const CONF_CLASS: Record<string, string> = {
  high: 'border-transparent bg-success/15 text-success',
  medium: 'border-transparent bg-warning/15 text-warning',
  low: 'border-input bg-secondary/60 text-muted-foreground',
};

// Estimated-price card for the right rail (UI redesign 2026-07-04): big
// editable price up top, comps trend sparkline under it, compact comps list
// behind an expander. Same data + recompute behavior as the old inline panel.

interface Props {
  item: Item;
  update: (recipe: (draft: Item) => void) => void;
  toast: (msg: string) => void;
}

/** Sold prices oldest→newest as a small trend line. Pure SVG, no deps. */
function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return null;
  const w = 100;
  const h = 30;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pts = prices.map((p, i) => [
    (i / (prices.length - 1)) * w,
    h - 3 - ((p - min) / span) * (h - 6),
  ]);
  const line = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const area = `M0,${h} L${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L')} L${w},${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-10 w-full" aria-hidden>
      <path d={area} fill="hsl(var(--success))" opacity="0.1" />
      <polyline
        points={line}
        fill="none"
        stroke="hsl(var(--success))"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill="hsl(var(--primary))" />
    </svg>
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

  const comps: Comp[] = r ? (r.allComps?.length ? r.allComps : r.mostRelevantComps) : [];
  const sparkPrices = [...comps]
    .filter((c) => c.price > 0)
    .sort((a, b) => (a.soldDate || '').localeCompare(b.soldDate || ''))
    .map((c) => c.price);
  const nComps = r?.sampleSize ?? comps.length;

  return (
    <section id="sec-price" className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Estimated price</label>
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
          <div className="flex items-center gap-1">
            <span className="font-display text-3xl text-primary">$</span>
            <Input
              value={r.median ?? ''}
              inputMode="numeric"
              aria-label="Your price"
              className="h-11 w-28 border-transparent px-1 font-display text-3xl text-primary shadow-none focus-visible:border-input"
              onChange={(e) =>
                update((d) => {
                  const v = e.target.value;
                  d.range!.median = v === '' ? null : Number(v);
                  d.dirty = true;
                })
              }
            />
          </div>
          {/* Plan §D2 list/sell split: the editable number above is the LIST
              price (offer headroom built in); what comparable items actually
              sold for is shown separately so neither is mistaken for the other. */}
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {r.soldMedian != null && r.soldMedian !== r.median ? (
              <>list price — typically sells ~{money(r.soldMedian)} · comps {money(r.low)} – {money(r.high)}</>
            ) : (
              <>comps {money(r.low)} – {money(r.high)} · your price is editable</>
            )}
          </div>
          {isNwt && (
            <div className="mt-1.5">
              <span className="rounded-md border border-transparent bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
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
          {r.confidence && (
            <div
              className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
              title={`${r.confidence.strongMatches} near-identical + ${r.confidence.moderateMatches} similar comps · effective sample ${r.confidence.effectiveN} · spread cv ${r.confidence.spreadCv}. The interval is where the true going rate likely sits, not the min–max of sales.`}
            >
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  CONF_CLASS[r.confidence.level]
                )}
              >
                {r.confidence.level} confidence
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                likely sells {money(r.confidence.ci95[0])}–{money(r.confidence.ci95[1])}
              </span>
              <span className="w-full text-xs text-muted-foreground">{r.confidence.explanation}</span>
            </div>
          )}
          <Sparkline prices={sparkPrices} />
          {comps.length > 0 && (
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-0.5 text-[13px] text-primary hover:underline"
              onClick={() => setOpen((o) => !o)}
            >
              {nComps} sold comp{nComps === 1 ? '' : 's'}
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
      <div className="mt-3 rounded-lg border bg-secondary/30 p-3">
        <label className="flex cursor-pointer items-center gap-2">
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
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Grailed’s own auto-discount: it lowers the price ~10% a week until your floor, and nudges likers. Off unless
          you turn it on here — the next fill then sets the toggle + floor on the Sell form for you to review before
          publishing.
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
