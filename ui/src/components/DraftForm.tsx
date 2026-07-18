import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, RefreshCw } from 'lucide-react';
import type { Item } from '@/types';
import { api, type AutofillOptions } from '@/lib/api';
import { suggestGrailedCategory } from '@/lib/grailedCategory';
import { sizeOptionsFor } from '@/lib/sizes';
import { activeTemplate, finalizeDescription } from '@/lib/description';
import { agoLabel, cn, errorMessage, isCollabBrand, money, primaryBrand } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SaveChip } from '@/components/SaveChip';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CategorySelect } from '@/components/CategorySelect';
import { PhotoRow } from '@/components/PhotoRow';
import { TagEditor } from '@/components/TagEditor';
import { DetailPanel } from '@/components/DetailPanel';
import { ConditionChips } from '@/components/ConditionChips';

/*
 * S-1 PR-c: the editor's left column, extracted verbatim from DraftEditor —
 * photos, the tiered form (Tier-1 seller bands, AI-drafted text, collapsed
 * "More details"), and the staged category confirmation. Field edits flow
 * through the same `update` recipes as before; the debounced save machinery
 * (saveState/lastSavedAt/now) stays with DraftEditor and rides in as props
 * for the SaveChip.
 */

// §F hierarchy (option B, owner-picked from 3 mocks): the page keeps its
// order but stops shouting evenly. Tier-1 fields (the seller's call) sit in
// a brass-bordered band with loud labels (BAND_LABEL); AI-drafted text gets
// a quiet tier header + quiet labels (FIELD_LABEL_CLS); rarely-used fields
// collapse behind "More details".
const FIELD_LABEL_CLS = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const BAND_LABEL = 'text-xs font-semibold uppercase tracking-wide text-foreground';

interface Props {
  item: Item;
  update: (recipe: (draft: Item) => void) => void;
  toast: (msg: string) => void;
  /** Raw persisted description-styles JSON (Description Styles Phase 1). */
  stylesRaw: string | null;
  /** Opens the global style editor (the App-root modal). */
  onEditStyles: () => void;
  /** Category cascade confirmed (derived in DraftEditor, shared with the fill). */
  confirmed: boolean;
  /** Debounced-save state for the SaveChip — owned by DraftEditor. */
  saveState: 'idle' | 'saving' | 'saved';
  lastSavedAt: number | null;
  now: number;
}

export function DraftForm({ item, update, toast, stylesRaw, onEditStyles, confirmed, saveState, lastSavedAt, now }: Props) {
  const content = item.content!;
  const attrs = item.attributes;
  const highConf = attrs.brand_confidence >= 0.65 && !!attrs.resembles_brand && attrs.resembles_brand !== 'unclear';

  // Audit §2.6: on opening a draft, land the cursor in the first EMPTY required
  // field (title → description → size) so keyboard users don't mouse to it. A
  // fully-filled draft is left untouched (never steal focus). Price lives in
  // the rail's PricePanel and is almost always pre-filled, so it's not chased
  // here (would need a cross-component ref).
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const sizeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!content.title?.trim()) titleRef.current?.focus();
      else if (!content.description?.trim()) descRef.current?.focus();
      else if (!attrs.size?.trim()) sizeRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const regenerate = () => {
    update((d) => {
      d.regenerating = true;
    });
    api
      .generateContent(item.attributes)
      .then((generated) => {
        update((d) => {
          d.regenerating = false;
          d.content = {
            title: generated.title,
            description: generated.description,
            tags: generated.tags,
            disclaimers: generated.disclaimers,
            title_alternatives: generated.title_alternatives,
          };
          d.descParts = generated.descParts;
          // generated.description already arrives COMPOSED from the active
          // style template (constants + footer included) — ui/main.js (or the
          // mock) composes at generation time; re-assembling here would lose them.
          d.dirty = true; // auto-save persists the regenerated content + parts
        });
        toast('Regenerated listing content.');
      })
      .catch((err) => {
        console.error('[api] generateContent failed', err);
        update((d) => {
          d.regenerating = false;
        });
        toast(`Regenerate failed: ${errorMessage(err)}`);
      });
  };

  // §F option B: the description collapses to a preview once it exists —
  // it stays open while empty (it needs writing); Tier-3 Grailed details
  // fold behind "More details". Both reset when the selection changes.
  const [descOpen, setDescOpen] = useState(() => !item.content?.description);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    setDescOpen(!item.content?.description);
    setMoreOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Grailed's fixed color/style lists + the department→category tree (from
  // grailed-selectors.json via IPC; static mirror in mock mode).
  const [fillOptions, setFillOptions] = useState<AutofillOptions>({ colors: [], styles: [], categoryTree: {} });
  useEffect(() => {
    api.getAutofillOptions().then(setFillOptions).catch(() => {});
  }, []);

  // A1 cascade gate, revised per owner feedback (2026-07-04, first real batch):
  // a confident suggestion is now ADOPTED automatically instead of waiting for
  // a manual confirm — the card shows the selection with "Change", and
  // ui/main.js still only passes cascade fields that are set here. Same for
  // color (free-text primary_color maps onto Grailed's fixed list) and style
  // (vision's grailed_style_estimate, already one of the fixed options).
  const suggestion = suggestGrailedCategory(attrs);
  useEffect(() => {
    const colors = fillOptions.colors;
    const tree = fillOptions.categoryTree;
    if (!colors.length && !Object.keys(tree).length) return; // options not loaded yet
    let nextColor: string | null = null;
    if (!attrs.grailed_color && attrs.primary_color) {
      const pc = attrs.primary_color.trim().toLowerCase();
      nextColor =
        colors.find((c) => c.toLowerCase() === pc) ??
        colors.find((c) => pc.includes(c.toLowerCase()) || c.toLowerCase().includes(pc)) ??
        null;
    }
    // Style: adopt the vision estimate when it matches one of Grailed's fixed
    // options ("Unclear" never matches by construction, so it stays manual).
    let nextStyle: string | null = null;
    if (!attrs.grailed_style && attrs.grailed_style_estimate) {
      const est = attrs.grailed_style_estimate.trim().toLowerCase();
      nextStyle = fillOptions.styles.find((s) => s.toLowerCase() === est) ?? null;
    }
    const adoptCascade =
      !attrs.grailed_department &&
      !attrs.grailed_category &&
      !!suggestion &&
      (tree[suggestion.department] ?? []).includes(suggestion.category);
    if (!nextColor && !nextStyle && !adoptCascade) return;
    update((d) => {
      if (nextColor && !d.attributes.grailed_color) d.attributes.grailed_color = nextColor;
      if (nextStyle && !d.attributes.grailed_style) d.attributes.grailed_style = nextStyle;
      if (adoptCascade && !d.attributes.grailed_department && !d.attributes.grailed_category && suggestion) {
        d.attributes.grailed_department = suggestion.department;
        d.attributes.grailed_category = suggestion.category;
      }
      d.dirty = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, fillOptions]);

  // Size dropdown (owner request 2026-07-17): once the category is set, offer
  // its size list (lib/sizes.ts); a stored off-list value (e.g. an AI guess
  // like "Large") is injected so it stays visible. sizeCustom = the free-text
  // escape, reset per item.
  const [sizeCustom, setSizeCustom] = useState(false);
  useEffect(() => setSizeCustom(false), [item.id]);
  const sizeOpts = sizeOptionsFor(confirmed ? attrs.grailed_category : null);
  const sizeChoices =
    attrs.size && sizeOpts.length > 0 && !sizeOpts.includes(attrs.size) ? [attrs.size, ...sizeOpts] : sizeOpts;
  const [pendingDept, setPendingDept] = useState(attrs.grailed_department || suggestion?.department || 'Menswear');
  const [pendingCat, setPendingCat] = useState(attrs.grailed_category || suggestion?.category || '');
  useEffect(() => {
    // Re-seed the pickers when switching items (or after a confirm/change).
    setPendingDept(attrs.grailed_department || suggestion?.department || 'Menswear');
    setPendingCat(attrs.grailed_category || suggestion?.category || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, confirmed]);
  const confirmCategory = () => {
    if (!pendingDept || !pendingCat) return;
    update((d) => {
      d.attributes.grailed_department = pendingDept;
      d.attributes.grailed_category = pendingCat;
      d.dirty = true;
    });
  };
  const clearCategory = () => {
    update((d) => {
      delete d.attributes.grailed_department;
      delete d.attributes.grailed_category;
      d.dirty = true;
    });
  };
  // What confirming unlocks — shown verbatim so the user knows exactly what
  // will be filled and where to edit it.
  const cascadeExtras = [
    attrs.size ? `Size “${attrs.size}”` : null,
    attrs.subcategory ? `Sub-category “${attrs.subcategory}”` : null,
    attrs.resembles_brand && attrs.resembles_brand !== 'unclear' ? `Designer “${attrs.resembles_brand}”` : null,
  ].filter(Boolean) as string[];

  return (
      <div className="rise-in min-w-0">
      <div id="sec-photos" className="scroll-mt-4">
        <PhotoRow item={item} update={update} />
      </div>

      {/* Tier 2 (§F option B): the AI's draft — glance and correct, don't
          audit. Quiet labels; the loud band below holds the seller's calls.
          Brand confidence moved into the band (titles are brandless now). */}
      <section id="sec-title" className="mb-5 scroll-mt-4">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            AI-drafted — glance, correct if wrong
          </span>
          <span className="flex-1" />
          <SaveChip state={saveState} savedLabel={`Saved ${lastSavedAt ? agoLabel(lastSavedAt, now) : ''}`.trim()} />
          <Button variant="outline" size="sm" disabled={item.regenerating} onClick={regenerate}>
            <RefreshCw className={item.regenerating ? 'animate-spin' : ''} />
            {item.regenerating ? 'regenerating…' : 'Regenerate'}
          </Button>
        </div>
        <span className={cn(FIELD_LABEL_CLS, 'mb-1 block')}>Title</span>
        <Input
          ref={titleRef}
          value={content.title}
          className="text-sm+ font-medium"
          onChange={(e) =>
            update((d) => {
              d.content!.title = e.target.value;
              d.dirty = true;
            })
          }
        />
      </section>

      {/* Description + detail selector */}
      <section id="sec-desc" className="mb-5 scroll-mt-4">
        <span className={cn(FIELD_LABEL_CLS, 'mb-1 block')}>Description</span>
        {/* §F option B: once a description exists it collapses to a preview —
            proofreading is one click away, and the page stops leading with a
            240px textarea. Empty descriptions stay open (they need writing). */}
        {!descOpen ? (
          <button
            type="button"
            className="block w-full rounded-md border border-input bg-secondary/30 px-3 py-2.5 text-left transition-colors hover:border-primary"
            title="Expand to read and edit the full description"
            onClick={() => setDescOpen(true)}
          >
            <span className="line-clamp-3 whitespace-pre-line font-mono text-sm- text-muted-foreground">
              {content.description}
            </span>
            <span className="mt-1.5 block text-2xs text-primary">expand to edit ▾</span>
          </button>
        ) : (
        <>
        {/* Global style pointer (Description Styles Phase 1); items generated
            before structured descriptions get a Regenerate nudge instead. */}
        {item.descParts ? (
          <DetailPanel stylesRaw={stylesRaw} onEditStyles={onEditStyles} />
        ) : (
          <div className="mb-2 flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">
              This listing predates structured descriptions. Regenerate once to compose it with your description
              style (constant footer included) — your attributes are kept.
            </span>
            <Button variant="outline" size="sm" disabled={item.regenerating} onClick={regenerate}>
              <RefreshCw className={item.regenerating ? 'animate-spin' : ''} />
              {item.regenerating ? 'regenerating…' : 'Regenerate'}
            </Button>
          </div>
        )}
        {/* Description styles open from a floating circular button in the
            textarea's bottom-right corner (a tiny header pencil wasn't
            discoverable — owner feedback 2026-07-14). It opens the global
            chip-template editor (StyleEditor), which replaced the old
            style-example panel. */}
        <div className="relative">
          <Textarea
            ref={descRef}
            className="min-h-[240px] pb-12 font-mono text-sm-"
            value={content.description}
            onChange={(e) =>
              update((d) => {
                d.content!.description = e.target.value;
                d.dirty = true;
              })
            }
          />
          <button
            type="button"
            aria-label="edit description styles"
            title="Description styles — the template every generated description composes from (constant footer included)."
            className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-input bg-card text-muted-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
            onClick={onEditStyles}
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
        </>
        )}
        {/* Measurements were removed entirely (owner decision 2026-07-14):
            on Grailed they go through Grailed's own measurements system on
            the listing, never the description — the app stopped collecting
            them. */}
      </section>

      {/* Tags */}
      <section id="sec-tags" className="mb-5 scroll-mt-4">
        <label className={cn(FIELD_LABEL_CLS, 'mb-2 block')}>Tags</label>
        <TagEditor
          tags={content.tags}
          onChange={(tags) =>
            update((d) => {
              d.content!.tags = tags;
              d.dirty = true;
            })
          }
        />
      </section>

      {/* Tier 1 (§F option B): the seller-known fields in one loud band —
          brand, size, condition, the staged category, and a price echo.
          Brand editing is NEW here (it previously needed the Confirm pass);
          it feeds the designer autofill + comps queries. */}
      <section id="sec-details" className="mb-5 scroll-mt-4">
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-primary">
          Your call — the fields that sell it
        </p>
        <div className="space-y-4 rounded-lg border border-primary/40 bg-card p-4">
        {/* Brand · Size · Condition — same order as the ConfirmCard. */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="order-1 flex min-w-0 flex-col gap-1">
            <span className={BAND_LABEL}>
              Brand
              {!highConf && <span className="font-normal normal-case tracking-normal text-warning"> — check the tag</span>}
            </span>
            <Input
              value={attrs.resembles_brand === 'unclear' ? '' : attrs.resembles_brand}
              placeholder="brand on the tag"
              onChange={(e) =>
                update((d) => {
                  d.attributes.resembles_brand = e.target.value;
                  d.dirty = true;
                })
              }
            />
            {!highConf && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 self-start px-2 text-2xs"
                title="Records that you checked the physical tag — the low-confidence warning goes away."
                onClick={() =>
                  update((d) => {
                    d.attributes.brand_confidence = 1;
                    d.dirty = true;
                  })
                }
              >
                I checked — it’s right
              </Button>
            )}
            {/* Collabs: Grailed's designer list has no collab entries (verified
                live) — the fill sends the primary label; say so up front
                instead of failing at fill time. */}
            {(isCollabBrand(attrs.resembles_brand) || attrs.collaboration) && (
              <span className="text-xs text-muted-foreground">
                collab{attrs.collaboration ? ` with ${attrs.collaboration}` : ''} — the fill sets designer “
                {primaryBrand(attrs.resembles_brand)}” (Grailed has no collab designers; the partner belongs in
                tags/description)
              </span>
            )}
          </div>
          <div className="order-3 flex min-w-0 flex-col gap-1">
            <span className={BAND_LABEL}>Condition</span>
            <ConditionChips
              value={attrs.condition_rating}
              onChange={(v) =>
                update((d) => {
                  d.attributes.condition_rating = v;
                  d.dirty = true;
                })
              }
            />
            {attrs.condition_rating === 'Unclear' && (
              <span className="text-xs text-warning">unclear from photos — judge it yourself</span>
            )}
          </div>
          <div className="order-2 flex min-w-0 flex-col gap-1">
            <span className={BAND_LABEL}>Size</span>
            {/* Once a Grailed category is set, size becomes a dropdown of that
                category's sizes (lib/sizes.ts) — mirroring how Grailed's own
                size field repopulates from the category. "Custom size" flips
                back to free text for anything off-list (the fill sends the
                string either way). An off-list stored value (AI guess like
                "Large") is injected as an option so it stays visible. */}
            {sizeChoices.length > 0 && !sizeCustom ? (
              <>
                <Select
                  value={attrs.size && sizeChoices.includes(attrs.size) ? attrs.size : undefined}
                  onValueChange={(v) =>
                    update((d) => {
                      // Picking a size is the seller's own judgment — clear the
                      // AI's "guessed, unclear" flag (it only ever described the
                      // AI's value; the editor has no other way to clear it).
                      d.attributes.size = v;
                      d.attributes.size_unclear = false;
                      d.dirty = true;
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="select size" />
                  </SelectTrigger>
                  <SelectContent>
                    {sizeChoices.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title="Type a size that isn't in the list — it fills as-is"
                  onClick={() => setSizeCustom(true)}
                >
                  custom size…
                </button>
              </>
            ) : (
              <>
                <Input
                  ref={sizeRef}
                  value={attrs.size}
                  placeholder="e.g. L"
                  onChange={(e) =>
                    update((d) => {
                      // Typing a size is the seller's own judgment — clear the
                      // AI's "guessed, unclear" flag (it only ever described the
                      // AI's value; the editor has no other way to clear it).
                      d.attributes.size = e.target.value;
                      d.attributes.size_unclear = false;
                      d.dirty = true;
                    })
                  }
                />
                {sizeChoices.length > 0 && (
                  <button
                    type="button"
                    className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setSizeCustom(false)}
                  >
                    choose from {attrs.grailed_category} sizes
                  </button>
                )}
              </>
            )}
            {/* Track the SOURCE's uncertainty, not whether the field is blank
                (UX review §4.4): an AI-guessed-but-uncertain size needs the
                caveat most of all. */}
            {attrs.size_unclear && (
              <span className="text-xs text-warning">
                {attrs.size
                  ? 'size guessed — tag unclear in photos, verify before filling'
                  : 'size not clearly visible in photos — confirm from tag'}
              </span>
            )}
          </div>
        </div>

        {/* A1 staged confirmation: the Grailed category cascade. The suggestion
            is loudly labeled as a suggestion; nothing fills until confirmed. */}
        <div id="sec-category" className="scroll-mt-4">
        <span className={cn(BAND_LABEL, 'mb-1 block')}>Grailed category — auto-selected from photos, change if wrong</span>
        <div
          className={cn(
            'rounded-md border border-l-[3px] p-3',
            confirmed ? 'border-l-success bg-success/5' : 'border-l-warning bg-secondary/40'
          )}
        >
          {confirmed ? (
            <>
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="outline" className="border-transparent bg-success/15 text-success">
                  ✓ selected — will autofill
                </Badge>
                <span className="text-sm- font-medium">
                  {attrs.grailed_department} / {attrs.grailed_category}
                </span>
                <span className="flex-1" />
                <Button variant="outline" size="sm" onClick={clearCategory}>
                  Change
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {cascadeExtras.length
                  ? `Fill listing will also set: ${cascadeExtras.join(' · ')} — size and brand are editable above.`
                  : 'No size/sub-category/designer values set yet — set size and brand above to include them.'}{' '}
                Nothing is saved on Grailed until you review and submit in Chrome.
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="outline" className="border-transparent bg-warning/15 text-warning">
                  suggestion — not filled until you confirm
                </Badge>
                <span className="text-sm-">
                  {suggestion ? (
                    <>
                      Suggested:{' '}
                      <span className="font-medium">
                        {suggestion.department} / {suggestion.category}
                      </span>{' '}
                      <span className="text-muted-foreground">(based on “{suggestion.basedOn}”)</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">no confident suggestion — pick manually</span>
                  )}
                </span>
              </div>
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <div className="flex min-w-[260px] flex-col gap-1">
                  <span className={FIELD_LABEL_CLS}>Department › Category</span>
                  {/* Grouped picker only — the staged gate below (Confirm for
                      autofill) is what actually writes the cascade fields. */}
                  <CategorySelect
                    categoryTree={fillOptions.categoryTree}
                    value={pendingDept && pendingCat ? `${pendingDept}||${pendingCat}` : undefined}
                    onValueChange={(v) => {
                      const [d, c] = v.split('||');
                      setPendingDept(d);
                      setPendingCat(c);
                    }}
                  />
                </div>
                <Button size="sm" disabled={!pendingDept || !pendingCat} onClick={confirmCategory}>
                  Confirm for autofill
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Why confirm? A wrong category cascades into wrong sizes on Grailed.{' '}
                {cascadeExtras.length
                  ? `Confirming also lets Fill listing set: ${cascadeExtras.join(' · ')}.`
                  : 'Until then, category/size/sub-category/designer stay manual in Chrome.'}
              </div>
            </>
          )}
        </div>
        </div>

        {/* Price echo — the editable price lives in the right-rail panel;
            this shows it with its evidence and jumps there. */}
        <button
          type="button"
          className="group flex flex-wrap items-center gap-x-2.5 gap-y-1 text-left"
          title="Edit in the price panel (right rail)"
          onClick={() => document.getElementById('sec-price')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >
          <span className={BAND_LABEL}>Price</span>
          <span className="font-display text-xl leading-none text-primary">{money(item.range?.median)}</span>
          {(() => {
            const n = item.range?.sampleSize ?? item.range?.mostRelevantComps.length ?? 0;
            const conf = item.range?.confidence?.level;
            return (
              <span className="font-mono text-2xs tabular-nums text-muted-foreground transition-colors group-hover:text-foreground">
                {n > 0 ? `${n} comps` : 'no comps yet'}
                {conf ? ` · ${conf} confidence` : ''} · edit →
              </span>
            );
          })()}
        </button>
        </div>
      </section>

      {/* Disclaimers */}
      {content.disclaimers.length > 0 && (
        <section className="mb-5">
          <div className="rounded-md border border-l-[3px] border-l-warning bg-secondary/40 p-3">
            <div className="mb-1.5 text-2xs uppercase tracking-wide text-warning">Verify before posting</div>
            <ul className="list-disc space-y-1 pl-5 text-sm- text-muted-foreground">
              {content.disclaimers.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Tier 3 (§F option B): rarely-touched Grailed details, collapsed.
          Values set here (or auto-adopted from the AI) fill whether or not
          the section is open — the toggle says how many are set so nothing
          feels hidden. */}
      <section id="sec-more" className="mb-5 scroll-mt-4">
        {(() => {
          const t3Set = [attrs.grailed_color, attrs.grailed_style, attrs.country_of_origin].filter(Boolean).length;
          return (
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setMoreOpen((o) => !o)}
            >
              {moreOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              More details — Grailed color · style · country
              {t3Set > 0 && <span className="text-muted-foreground">({t3Set} set — filled even while collapsed)</span>}
            </button>
          );
        })()}
        {moreOpen && (
          <div className="mt-2.5">
            <p className="mb-2 text-xs text-muted-foreground">
              These feed autofill. Blank fields are simply skipped — nothing is guessed for you.
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-[220px] flex-col gap-1">
                <span className={FIELD_LABEL_CLS}>Color (Grailed)</span>
                <Select
                  value={attrs.grailed_color || undefined}
                  onValueChange={(v) =>
                    update((d) => {
                      d.attributes.grailed_color = v;
                      d.dirty = true;
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="not set — skipped" />
                  </SelectTrigger>
                  <SelectContent>
                    {fillOptions.colors.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-[220px] flex-col gap-1">
                <span className={FIELD_LABEL_CLS}>Style (Grailed)</span>
                <Select
                  value={attrs.grailed_style || undefined}
                  onValueChange={(v) =>
                    update((d) => {
                      d.attributes.grailed_style = v;
                      d.dirty = true;
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="not set — skipped" />
                  </SelectTrigger>
                  <SelectContent>
                    {fillOptions.styles.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-[220px] flex-col gap-1">
                <span className={FIELD_LABEL_CLS}>Country of origin</span>
                <Input
                  value={attrs.country_of_origin ?? ''}
                  placeholder="e.g. Portugal — skipped if blank"
                  onChange={(e) =>
                    update((d) => {
                      d.attributes.country_of_origin = e.target.value;
                      d.dirty = true;
                    })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  must match a country Grailed suggests — filled via its autocomplete
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
      </div>
  );
}
