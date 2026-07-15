import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { Item } from '@/types';
import type { AutofillOptions } from '@/lib/api';
import { readiness } from '@/lib/readiness';
import { quality, qualityTitle } from '@/lib/quality';
import { suggestGrailedCategory } from '@/lib/grailedCategory';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnimatedCheck } from '@/components/motion';
import { ConditionChips } from '@/components/ConditionChips';

/*
 * Structured Confirm Card (refinement plan §D1/§D2): one draft as a compact
 * confirm surface instead of a full-editor scan. Fields are tiered by who
 * knows the answer —
 *   Tier 1 (loud, always visible): the six things the seller knows instantly:
 *     brand · category · size · condition · list price · floor.
 *   Tier 2 (quieter, prefilled): what the AI drafted — title, description,
 *     color, style. Glance, correct only if wrong.
 *   Tier 3 (collapsed): country of origin, the AI's private seller notes.
 * The A1 staged category gate is UNCHANGED (nothing fills until Confirm), the
 * Smart Pricing floor stays strictly opt-in (typing a floor IS the opt-in,
 * clearing it opts out), and nothing here touches Grailed.
 */

interface Props {
  /** The live (edited) item value. */
  item: Item;
  fillOptions: AutofillOptions;
  /** Pending Department||Category pick (staged — not applied until Confirm). */
  pendingCatKey: string;
  onPendingCat: (key: string) => void;
  recomputing: boolean;
  edit: (recipe: (d: Item) => void) => void;
  onRecompute: () => void;
  /** Escape hatch for what the card can't fix (photos, regenerate, comps). */
  onOpenEditor: () => void;
}

/** Labeled field cell; `flag` turns the label into the thing-to-check cue. */
function Field({ label, flag, className, children }: { label: string; flag?: string | null; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className={cn('truncate text-[11px] uppercase tracking-wide', flag ? 'font-medium text-warning' : 'text-muted-foreground')} title={flag ?? undefined}>
        {label}
        {flag ? ` — ${flag}` : ''}
      </span>
      {children}
    </div>
  );
}

export function ConfirmCard({ item, fillOptions, pendingCatKey, onPendingCat, recomputing, edit, onRecompute, onOpenEditor }: Props) {
  const attrs = item.attributes;
  const r = readiness(item);
  const q = quality(item);
  const row = (key: string) => r.rows.find((x) => x.key === key)!;
  const unresolved = r.rows.filter((x) => x.required && x.state !== 'done');
  const suggestion = suggestGrailedCategory(attrs);
  const confirmed = !!(attrs.grailed_department && attrs.grailed_category);
  // Re-open the category picker on a confirmed card without clearing the
  // confirmed value — it only changes when a NEW pick is confirmed.
  const [catEditing, setCatEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const catPairs = Object.entries(fillOptions.categoryTree).flatMap(([dept, cats]) => cats.map((cat) => ({ dept, cat })));
  const pendingKey = pendingCatKey || (suggestion ? `${suggestion.department}||${suggestion.category}` : '');
  const soldMedian = item.range?.soldMedian ?? null;
  const floor = attrs.smart_pricing_enabled ? attrs.smart_pricing_floor ?? null : null;
  const lowBrand = row('brand').state !== 'done';

  return (
    <div className="rounded-lg border bg-card p-4">
      {/* Header: what this item is + how much is left to check. */}
      <div className="mb-3 flex items-center gap-3">
        <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded" style={{ background: item.photos[0]?.tint ?? '#333' }}>
          {item.photos[0]?.src && (
            <img
              src={item.photos[0].src}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.content?.title || `(untitled — item #${item.id})`}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs">
            {r.ready ? (
              <span className="flex items-center gap-1.5 font-medium text-success">
                <AnimatedCheck /> Ready
              </span>
            ) : (
              <span className="text-warning">
                {unresolved.length} thing{unresolved.length === 1 ? '' : 's'} to check: {unresolved.map((x) => x.short).join(' · ')}
              </span>
            )}
            <span className="font-mono tabular-nums text-muted-foreground" title={qualityTitle(q)}>
              {q.score}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpenEditor} title="Open the full editor (photos, comps, regenerate)">
          Open editor <ArrowRight className="h-3 w-3" />
        </Button>
      </div>

      {/* Photos can't be fixed here — zero photos or over Grailed's cap. */}
      {row('photos').state !== 'done' && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{row('photos').sub} — that needs the full editor.</span>
          <Button variant="outline" size="sm" onClick={onOpenEditor}>
            Open editor
          </Button>
        </div>
      )}

      {/* ---- Tier 1: the six seller-known fields ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="Brand" flag={lowBrand ? 'low confidence, check the tag' : null}>
          <Input
            value={attrs.resembles_brand === 'unclear' ? '' : attrs.resembles_brand}
            placeholder="brand on the tag"
            onChange={(e) =>
              edit((d) => {
                d.attributes.resembles_brand = e.target.value;
              })
            }
          />
          {lowBrand && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 self-start px-2 text-[11px]"
              title="Records that you checked the physical tag — the low-confidence warning goes away."
              onClick={() =>
                edit((d) => {
                  d.attributes.brand_confidence = 1;
                })
              }
            >
              I checked — it’s right
            </Button>
          )}
        </Field>

        <Field label="Size" flag={!attrs.size ? 'missing' : attrs.size_unclear ? 'guessed, check the tag' : null}>
          <Input
            value={attrs.size}
            placeholder="e.g. L"
            className={cn(!attrs.size && 'border-dashed')}
            onChange={(e) =>
              edit((d) => {
                // A size the seller typed is their own judgment — the AI's
                // "guessed, unclear" flag only applies to the AI's value.
                d.attributes.size = e.target.value;
                d.attributes.size_unclear = false;
              })
            }
          />
          {attrs.size_unclear && attrs.size && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 self-start px-2 text-[11px]"
              title="Records that you checked the physical tag — the guessed-size warning goes away."
              onClick={() =>
                edit((d) => {
                  d.attributes.size_unclear = false;
                })
              }
            >
              Verified from tag
            </Button>
          )}
        </Field>

        <Field
          label="Condition"
          className="col-span-2 md:col-span-1"
          flag={row('condition').state !== 'done' ? (attrs.condition_rating === 'Unclear' ? 'unclear — judge it' : 'missing') : null}
        >
          <ConditionChips
            value={attrs.condition_rating}
            onChange={(v) =>
              edit((d) => {
                d.attributes.condition_rating = v;
              })
            }
          />
        </Field>

        <Field
          label="Grailed category"
          className="col-span-2"
          flag={!confirmed ? (suggestion ? `suggested from “${suggestion.basedOn}” — confirm it` : 'pick + confirm') : null}
        >
          {confirmed && !catEditing ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate rounded-md border bg-secondary/40 px-3 py-1.5 text-sm">
                {attrs.grailed_department} › {attrs.grailed_category}
              </span>
              <Button variant="outline" size="sm" onClick={() => setCatEditing(true)}>
                Change
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={pendingKey || undefined} onValueChange={onPendingCat}>
                <SelectTrigger className="flex-1">
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
              <Button
                size="sm"
                disabled={!pendingKey}
                title="Nothing is filled until you confirm — a wrong category cascades into wrong sizes on Grailed."
                onClick={() => {
                  const [dept, cat] = pendingKey.split('||');
                  if (!dept || !cat) return;
                  edit((d) => {
                    d.attributes.grailed_department = dept;
                    d.attributes.grailed_category = cat;
                  });
                  setCatEditing(false);
                }}
              >
                Confirm
              </Button>
            </div>
          )}
        </Field>

        <Field label="List price ($)" flag={item.range?.median == null ? 'missing' : null}>
          <div className="flex items-center gap-1.5">
            <Input
              value={item.range?.median ?? ''}
              inputMode="numeric"
              placeholder="your price"
              className={cn(item.range?.median == null && 'border-dashed')}
              onChange={(e) => {
                const v = e.target.value;
                const median = v === '' ? null : Number(v);
                edit((d) => {
                  if (d.range) d.range.median = median;
                  else if (median != null) d.range = { currency: 'USD', low: null, median, high: null, mostRelevantComps: [] };
                });
              }}
            />
            <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" disabled={recomputing} title="Recompute from sold comps" onClick={onRecompute}>
              <RefreshCw className={cn('h-3.5 w-3.5', recomputing && 'animate-spin')} />
            </Button>
          </div>
          {soldMedian != null && <span className="text-[11px] text-muted-foreground">typically sells ~${soldMedian}</span>}
        </Field>

        <Field label="Floor — Smart Pricing">
          <Input
            value={floor ?? ''}
            inputMode="numeric"
            placeholder="off — type to opt in"
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, '');
              edit((d) => {
                // Typing a floor IS the §I opt-in; clearing it opts out.
                d.attributes.smart_pricing_enabled = digits !== '';
                d.attributes.smart_pricing_floor = digits === '' ? null : Number(digits);
              });
            }}
          />
          {soldMedian != null && floor == null && (
            <button
              className="self-start text-[11px] text-primary hover:underline"
              title="Opt in to Grailed's Smart Pricing with the typical sale price as the floor — the next fill sets the toggle + floor for your review."
              onClick={() =>
                edit((d) => {
                  d.attributes.smart_pricing_enabled = true;
                  d.attributes.smart_pricing_floor = soldMedian;
                })
              }
            >
              use ~${soldMedian} (typical sale)
            </button>
          )}
        </Field>
      </div>

      {/* ---- Tier 2: AI-drafted — glance, correct only if wrong ---- */}
      <div className="mt-4 border-t pt-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">AI-drafted — glance, correct if wrong</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title" flag={row('title').state !== 'done' ? 'missing' : null} className="col-span-2">
            <Input
              value={item.content?.title ?? ''}
              placeholder="write a title"
              onChange={(e) =>
                edit((d) => {
                  if (d.content) d.content.title = e.target.value;
                })
              }
            />
          </Field>
          <Field label="Description" flag={row('description').state !== 'done' ? 'missing' : null} className="col-span-2">
            <Textarea
              value={item.content?.description ?? ''}
              placeholder="write a description"
              className="min-h-[64px] font-mono text-[13px]"
              onChange={(e) =>
                edit((d) => {
                  if (d.content) d.content.description = e.target.value;
                })
              }
            />
          </Field>
          <Field label="Color">
            <Select
              value={attrs.grailed_color || undefined}
              onValueChange={(v) =>
                edit((d) => {
                  d.attributes.grailed_color = v;
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="optional" />
              </SelectTrigger>
              <SelectContent>
                {fillOptions.colors.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Style">
            <Select
              value={attrs.grailed_style || undefined}
              onValueChange={(v) =>
                edit((d) => {
                  d.attributes.grailed_style = v;
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="optional" />
              </SelectTrigger>
              <SelectContent>
                {fillOptions.styles.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      {/* ---- Tier 3: rarely needed, collapsed ---- */}
      <div className="mt-3">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setMoreOpen((o) => !o)}
        >
          {moreOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          More (optional)
        </button>
        {moreOpen && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Country of origin">
              <Input
                value={attrs.country_of_origin ?? ''}
                placeholder="e.g. USA"
                onChange={(e) =>
                  edit((d) => {
                    d.attributes.country_of_origin = e.target.value;
                  })
                }
              />
            </Field>
            {(item.content?.disclaimers.length ?? 0) > 0 && (
              <Field label="Seller notes (private — never posted)" className="col-span-2">
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {item.content!.disclaimers.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </Field>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
