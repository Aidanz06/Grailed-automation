import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Pencil, RefreshCw } from 'lucide-react';
import type { Item } from '@/types';
import { api, type AutofillOptions, type ChromeStatus, type FillChanges } from '@/lib/api';
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
import { PricePanel } from '@/components/PricePanel';
import { ListingChecklist } from '@/components/ListingChecklist';
import { FillProgressCard, applyFillProgress, emptyFillRun, type FillRunState } from '@/components/FillProgressCard';
import { FillChangesCard } from '@/components/FillChangesCard';
import { useOpenSellTab } from '@/components/ChromeStatusChip';
import { ConditionChips } from '@/components/ConditionChips';

// Beta Part F: the very first fill ever shows a one-time heads-up.
const FIRST_FILL_KEY = 'tailor.firstFillConfirmed';
function firstFillSeen(): boolean {
  try {
    return localStorage.getItem(FIRST_FILL_KEY) === '1';
  } catch {
    return true; // storage unavailable — never block the fill over it
  }
}
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
  /** Raw persisted description-styles JSON (Description Styles Phase 1). */
  stylesRaw: string | null;
  /** Opens the global style editor (the App-root modal). */
  onEditStyles: () => void;
  toast: (msg: string) => void;
  /** Next draft in sidebar order — target of the "listed, fill next" flow. */
  nextDraft: { id: number; title: string } | null;
  /** True when the user's "fill next draft" click targeted THIS item: start
   * the fill on mount (the click was the per-item manual trigger). */
  autoFill: boolean;
  onAutoFillConsumed: () => void;
  /** Current item was marked listed — advance to nextId and fill it. */
  onMarkListedAndNext: (nextId: number) => void;
  /** R3 "F" shortcut: increments each time the user presses Fill's hotkey —
   * runs the exact same gated fillListing path as the button (never submits;
   * blocked with the warning card when Chrome isn't on a fresh Sell form). */
  fillSignal?: number;
  /** Reports fill activity upward (in-app updater guard: never rebuild the
   * app under a running fill). */
  onFillingChange?: (busy: boolean) => void;
  /** §E8: a duplicate draft was created — reload and select it. */
  onDuplicated?: (newId: number) => void;
}

// Everything a save persists — INCLUDING the photo list (order + membership):
// editor deletes/reorders must reach the DB or autofill uploads the stale set
// (real-run find 2026-07-04: a removed duplicate photo was still uploaded).
// Non-numeric ids (mock/preview-only tiles) are filtered out. Exported so
// App's save-and-next shortcut (R3) persists exactly what a debounced save would.
export function editsOf(item: Item) {
  return {
    content: item.content,
    range: item.range,
    attributes: item.attributes,
    descParts: item.descParts,
    measurements: item.measurements,
    photos: item.photos.map((p) => Number(p.id)).filter((n) => Number.isFinite(n)),
  };
}

export function DraftEditor({ item, update, stylesRaw, onEditStyles, toast, nextDraft, autoFill, onAutoFillConsumed, onMarkListedAndNext, fillSignal = 0, onFillingChange, onDuplicated }: Props) {
  const content = item.content!;
  const attrs = item.attributes;
  const highConf = attrs.brand_confidence >= 0.65 && !!attrs.resembles_brand && attrs.resembles_brand !== 'unclear';

  // Slice 2: debounced auto-save of edits back to the store. Edits set
  // `item.dirty`; ~800ms after they stop we persist and clear the flag. Each
  // keystroke replaces item.content/range/attributes identities, resetting the
  // timer (debounce). Note: measurements/descParts have no store column yet
  // (schema gap) — they persist in-session only.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
  useEffect(() => {
    if (!item.dirty) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      api
        .saveItem(item.id, editsOf(item))
        .then(() => {
          update((d) => {
            d.dirty = false;
          });
          setLastSavedAt(Date.now());
          setNow(Date.now());
          setSaveState('saved');
        })
        .catch((err) => {
          console.error('[api] saveItem failed', err);
          setSaveState('idle');
          toast(`Save failed: ${errorMessage(err)}`);
        });
    }, 800);
    return () => clearTimeout(t);
  }, [item.dirty, item.content, item.range, item.attributes, item.id]);

  // Keep the "saved Ns ago" label fresh without re-rendering constantly.
  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [saveState]);

  // S6: "Mark submitted" claims something happened on Grailed — ask before
  // believing it. First click arms the inline confirm; only "Yes" persists.
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  useEffect(() => setConfirmSubmit(false), [item.id]);
  const markSubmitted = () => {
    setConfirmSubmit(false);
    // Flush pending edits first so the persisted listing matches what's on
    // screen — INCLUDING descParts/measurements (UX review Q5: omitting them
    // here silently lost measurement edits made inside the debounce window).
    api
      .saveItem(item.id, editsOf(item))
      .then(() => api.markSubmitted(item.id))
      .then(() => {
        update((d) => {
          d.status = 'submitted';
          d.submittedAt = new Date().toISOString().slice(0, 10);
          d.dirty = false;
        });
        toast('Marked as listed — moved to “Currently listed on Grailed”.');
      })
      .catch((err) => {
        console.error('[api] markSubmitted failed', err);
        toast(`Failed to mark as listed: ${errorMessage(err)}`);
      });
  };

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
  const confirmed = !!(attrs.grailed_department && attrs.grailed_category);
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

  // Slice 6: autofill the sell form in the driven real Chrome. Flushes pending
  // edits first so what's filled matches the screen. The app never submits —
  // the user reviews, completes category/size/designer, and submits in Chrome.
  const [filling, setFilling] = useState(false);
  // In-app updater guard: report fill activity to App (never rebuild the app
  // under a running fill). Cleared on unmount so it can't stick true.
  useEffect(() => {
    onFillingChange?.(filling);
    return () => onFillingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filling]);
  // UX review Q1: after a fill, the "NOT saved on Grailed until you Save as
  // Draft/Publish" fact must NOT live only in a self-dismissing toast — a
  // reload silently reverts the form to Grailed's last saved draft. This
  // banner persists until the user confirms they saved/published (or the
  // item changes).
  const [fillOutcome, setFillOutcome] = useState<string[] | null>(null);
  // S3: live per-field checklist fed by the driver's autofill:progress stream.
  // The card sticks around after the run (as "Last fill") until the next fill
  // or an item switch.
  const [fillRun, setFillRun] = useState<FillRunState>(emptyFillRun);
  useEffect(() => api.onFillProgress((p) => setFillRun((r) => applyFillProgress(r, p))), []);
  // Fresh-Sell-form gate (audit §3.1): the last NOT-ready probe result — set
  // = the persistent warning card is up and the fill did not fire. `armed`
  // marks a deferred auto-fill-next: Chrome wasn't ready when this editor
  // mounted, so the fill waits for the user's explicit click instead of
  // pouring into whatever page Chrome is on (e.g. item N's just-published
  // listing).
  const [fillBlocked, setFillBlocked] = useState<ChromeStatus | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setFillOutcome(null);
    setFillRun(emptyFillRun());
    setFillBlocked(null);
    setArmed(false);
    setFirstFillPrompt(null);
  }, [item.id]);
  // Changes since the last fill (main-process diff vs the persisted snapshot).
  // Refetched when the item switches, a debounced save lands (lastSavedAt), or
  // a fill finishes (the snapshot advanced). null = never autofilled / loading.
  const [fillChanges, setFillChanges] = useState<FillChanges | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getFillChanges(item.id)
      .then((c) => {
        if (alive) setFillChanges(c);
      })
      .catch(() => {
        if (alive) setFillChanges(null); // informational — never block the editor
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, lastSavedAt, filling]);
  // A re-fill targets only the edited fields when a snapshot exists and the
  // diff is non-empty (photo changes aren't tracked — Grailed-form territory).
  const changedFill = !!fillChanges?.lastFillAt && fillChanges.changes.length > 0;

  // M-8 phase 1: the Fill explanation, reachable without a mouse — the same
  // text rides on the wrapper's title (hover) and on an sr-only description
  // the button announces on keyboard focus. Zero visual change.
  const fillDescId = useId();
  const fillExplain =
    changedFill && !armed
      ? 'Updates only the fields you edited since the last fill, in the same Sell form (still open in Chrome). Never submits.'
      : confirmed
        ? "Fills title, description, price, condition, photos + the confirmed category with size/sub-category/designer into Grailed's sell form in the launched Chrome. Never submits."
        : "Fills title, description, price, condition + photos into Grailed's sell form in the launched Chrome. Category/size/designer stay manual until you confirm the category. Never submits.";
  const changedCount = fillChanges?.changes.length ?? 0;
  const startFill = (changedOnly = false) => {
    setFilling(true);
    setFillRun(emptyFillRun());
    toast(
      changedOnly
        ? `Updating ${changedCount} changed field${changedCount === 1 ? '' : 's'} in Chrome — everything else stays as filled…`
        : 'Filling the form in Chrome — human-paced, takes ~20s…'
    );
    api
      .saveItem(item.id, editsOf(item))
      .then(() => api.fillListing(item.id, changedOnly ? { changedOnly: true } : undefined))
      .then((res) => {
        const filled: string[] = [];
        const issues: string[] = [];
        for (const [key, r] of Object.entries(res.results)) {
          const name =
            key === 'countryOfOrigin'
              ? 'country'
              : key === 'subcategory'
                ? 'sub-category'
                : key === 'photos'
                  ? `${r.uploadPosts ?? '?'} photos`
                  : key;
          if (r.skipped) issues.push(`${name} (skipped)`);
          else if (r.ok) filled.push(name);
          // Carry the driver's reason ("input is disabled", "no matching
          // suggestion", …) — "problems with designer" alone is undebuggable.
          else issues.push(r.reason ? `${name} — ${r.reason}` : name);
        }
        if (filled.length) setFillOutcome(filled); // persistent banner owns the not-saved warning
        if (res.ok && filled.length) {
          const manualTail = confirmed
            ? 'Double-check the category cascade fields there.'
            : 'Category/size/designer stayed manual (unconfirmed).';
          toast(`Filled ${filled.join(', ')}. Review in Chrome — ${manualTail}`);
        } else {
          console.log('[autofill] partial/failed result', res);
          toast(
            res.message ||
              `Filled ${filled.join(', ') || 'nothing'}; problems with ${issues.join(', ') || 'all fields'}.`
          );
        }
      })
      .catch((err) => {
        console.error('[api] fillListing failed', err);
        toast(`The fill didn’t finish — ${errorMessage(err)}. Nothing was submitted; check the Chrome window.`);
      })
      .finally(() => setFilling(false));
  };

  // Beta Part F: a brief one-time heads-up before the very FIRST fill ever
  // (localStorage-gated) restating the contract — types into Chrome, never
  // submits, you publish. Repeat fills are untouched; behavior is unchanged
  // either way (the prompt only defers the same click).
  const [firstFillPrompt, setFirstFillPrompt] = useState<{ force: boolean; changedOnly: boolean } | null>(null);
  const confirmFirstFill = () => {
    const opts = firstFillPrompt;
    setFirstFillPrompt(null);
    try {
      localStorage.setItem(FIRST_FILL_KEY, '1');
    } catch {
      /* private mode — the heads-up may show once more, harmless */
    }
    if (opts) fillListing({ ...opts, confirmed: true });
  };

  // Gate before any fill (audit §3.1): probe the launched Chrome (read-only
  // HTTP tab list) and only proceed onto a fresh Sell form. Not ready → the
  // persistent warning card with Recheck / Fill anyway; `force` is the "Fill
  // anyway" escape hatch (proceeds exactly as before the gate existed). A
  // probe IPC failure never blocks a deliberate click — fail open, the driver
  // still reports per-field what it actually found.
  const fillListing = async ({ force = false, changedOnly = false, confirmed = false } = {}) => {
    if (!confirmed && !firstFillSeen()) {
      setFirstFillPrompt({ force, changedOnly });
      return;
    }
    if (!force) {
      let status: ChromeStatus | null = null;
      try {
        status = await api.getChromeStatus();
      } catch (err) {
        console.warn('[api] getChromeStatus failed — filling without the gate', err);
      }
      if (status && !status.ready) {
        setFillBlocked(status);
        return;
      }
    }
    setFillBlocked(null);
    setArmed(false);
    startFill(changedOnly);
  };

  const recheckChrome = () => {
    api
      .getChromeStatus()
      .then((s) => {
        if (s.ready) {
          setFillBlocked(null);
          toast('Chrome is ready — a fresh Sell form is open.');
        } else setFillBlocked(s);
      })
      .catch(() => toast('Could not check Chrome — is the app connected?'));
  };

  // Blocked-card "Open Sell form": create the missing tab right here, then
  // re-probe once it has had a moment to load (the card clears when ready).
  const { opening: openingSellTab, openSellTab } = useOpenSellTab(toast);
  const openSellTabAndRecheck = () => {
    openSellTab();
    setTimeout(recheckChrome, 2500);
  };

  // In-app Chrome launcher for the not-connected case (spawn only — sign-in
  // and the Sell-form navigation stay the user's, PRD §8.2). After it comes
  // up, Recheck (or the header chip's poll) confirms the state.
  const [launchingChrome, setLaunchingChrome] = useState(false);
  const launchChrome = () => {
    setLaunchingChrome(true);
    api
      .launchChrome()
      .then((r) => {
        toast(r.message);
        if (r.ok) recheckChrome(); // refresh the card: not-connected → open-a-Sell-form
      })
      .catch((err) => toast(`Couldn’t launch Chrome: ${errorMessage(err)}`))
      .finally(() => setLaunchingChrome(false));
  };

  // "Listed, fill next": the user's click targeted this item — start its fill
  // once on mount, but ONLY if Chrome is already sitting on a fresh Sell form
  // (after publishing item N, Chrome is usually still on N's published page —
  // firing there would pour this draft into the wrong form). Not ready → arm
  // the fill button instead; the same single click stays the per-item manual
  // trigger. The ref stops a re-run if props re-render before the consume
  // propagates. (Still one user click per filled item.)
  const autoFillRan = useRef<number | null>(null);
  useEffect(() => {
    if (!autoFill || autoFillRan.current === item.id) return;
    autoFillRan.current = item.id;
    onAutoFillConsumed();
    api
      .getChromeStatus()
      .then((s) => {
        if (s.ready) startFill();
        else {
          setArmed(true);
          setFillBlocked(s);
        }
      })
      .catch(() => setArmed(true)); // can't verify → never auto-fire blind
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, autoFill]);

  // R3: the F hotkey mirrors the primary Fill button exactly — same gated
  // path (fresh-Sell-form probe, blocked card, changed-only default), one
  // manual keypress per item. The ref skips the mount-time value so an old
  // signal never fires on item switch.
  const fillSignalSeen = useRef(fillSignal);
  useEffect(() => {
    if (fillSignal === fillSignalSeen.current) return;
    fillSignalSeen.current = fillSignal;
    if (!filling) fillListing({ changedOnly: changedFill && !armed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillSignal]);

  // One large post-publish action (batch posting flow): mark THIS item listed,
  // advance to the next draft, and fill it — all from the single click that
  // asserts "I published in Chrome". The app never checks Chrome state and
  // never submits; publishing itself stayed manual.
  const publishAndNext = () => {
    if (!nextDraft) return;
    const nextId = nextDraft.id;
    setFillOutcome(null);
    api
      .saveItem(item.id, editsOf(item))
      .then(() => api.markSubmitted(item.id))
      .then(() => {
        update((d) => {
          d.status = 'submitted';
          d.submittedAt = new Date().toISOString().slice(0, 10);
          d.dirty = false;
        });
        onMarkListedAndNext(nextId);
      })
      .catch((err) => {
        console.error('[api] publishAndNext failed', err);
        toast(`Failed to mark as listed: ${errorMessage(err)}`);
      });
  };

  // §E8 duplicate: same garment type, new physical item — clone the text +
  // details as a fresh draft (photos/fill history/Smart Pricing reset
  // main-side) and jump to it so the next step (add photos) is obvious.
  const duplicateItem = () => {
    api
      .duplicateItem(item.id)
      .then(({ itemId }) => {
        toast('Duplicated — text and details copied. Add the new item’s own photos before filling.');
        onDuplicated?.(itemId);
      })
      .catch((err) => toast(`Duplicate failed: ${errorMessage(err)}`));
  };

  const copyListing = () => {
    // Footer backstop (Description Styles): the copied text carries the active
    // style's constant footer even on legacy drafts stored before composition.
    const desc = finalizeDescription(content.description, activeTemplate(stylesRaw));
    const parts = [content.title, '', desc];
    parts.push('', 'Tags: ' + content.tags.join(', '), '', `Price: ${money(item.range?.median)}`);
    const text = parts.join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast('Listing copied — paste into Grailed’s sell form.'))
        .catch(() => {
          console.log('[copy] clipboard blocked; text follows:\n' + text);
          toast('Clipboard blocked — text logged to console.');
        });
    } else {
      console.log('[copy] listing text:\n' + text);
      toast('Copied to console (clipboard unavailable).');
    }
  };

  return (
    <div className="p-6">
      {/* UI redesign 2026-07-04 (mock-inspired): the form lives in the middle
          column; a sticky right rail holds the readiness checklist, the price
          card, and the actions — so "what's left to fill" stays visible while
          editing. Below lg the rail stacks under the form. */}
      {/* key={item.id} remounts both columns on item switch so the rise-in
          stagger replays — content fades up instead of hard-swapping. */}
      <div key={item.id} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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

      {/* Right rail: readiness checklist, price card, actions. Sticky so the
          checklist + fill CTA stay in view while scrolling the form. */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <div className="rise-in" style={{ animationDelay: '60ms' }}>
          <ListingChecklist item={item} />
        </div>

        <div className="rise-in" style={{ animationDelay: '120ms' }}>
          <PricePanel item={item} update={update} toast={toast} />
        </div>

        <section className="rise-in rounded-xl border bg-card p-4" style={{ animationDelay: '180ms' }}>
          <span className="block" title={fillExplain}>
            <Button
              className={cn('w-full', !filling && 'glow-primary')}
              disabled={filling}
              aria-describedby={fillDescId}
              onClick={() => fillListing({ changedOnly: changedFill && !armed })}
            >
              <ArrowUpRight />
              {filling
                ? 'Filling…'
                : armed
                  ? 'Chrome ready on a new Sell form? — Fill this draft'
                  : changedFill
                    ? `Fill ${changedCount} change${changedCount === 1 ? '' : 's'} in Chrome`
                    : 'Fill listing in Chrome'}
            </Button>
          </span>
          <span id={fillDescId} className="sr-only">
            {fillExplain}
          </span>
          {/* Beta Part F: one-time first-fill heads-up (localStorage-gated).
              Confirm proceeds with the exact click that was deferred. */}
          {firstFillPrompt && !filling && (
            <div className="mt-2.5 rounded-md border border-l-[3px] border-l-primary bg-secondary/40 p-3 text-sm-">
              <div className="font-medium">Quick heads-up before your first fill</div>
              <div className="mt-0.5 text-muted-foreground">
                Tailor will type this listing into your Chrome Sell form. It will <span className="font-medium text-foreground">not</span>{' '}
                submit — you review everything there and click Publish yourself.
              </div>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" className="flex-1" onClick={confirmFirstFill}>
                  Fill
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setFirstFillPrompt(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {/* Changed-only is the default re-fill; the full pass stays one click
              away for the fresh-form case (page reloaded/republishing — the
              old values are gone, so a diff against them would fill too little). */}
          {changedFill && !armed && !filling && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              title="Types every field again. Use this when the Sell form is fresh/empty (e.g. the page was reloaded) — filling a form that already has photos would duplicate them."
              onClick={() => fillListing()}
            >
              Fill everything again (fresh form)
            </Button>
          )}
          {/* Fresh-Sell-form gate (audit §3.1): a probe said Chrome isn't on
              a fresh Sell form, so the fill did NOT fire. Persistent (same
              stakes as the not-saved banner) until Recheck passes, the item
              changes, or the user overrides with Fill anyway. */}
          {fillBlocked && !filling && (
            <div className="mt-2.5 rounded-md border border-warning/60 border-l-[3px] border-l-warning bg-warning/10 p-3 text-sm-">
              <div className="font-medium text-warning">Chrome isn’t on a fresh Sell form.</div>
              <div className="mt-0.5 text-muted-foreground">
                {!fillBlocked.connected
                  ? 'No app-connected Chrome is running. Launch it below, sign in to Grailed there yourself (login is always manual), open grailed.com/sell/new, then Recheck.'
                  : fillBlocked.loggedIn === false
                    ? 'That Chrome is on a Grailed login page — sign in there yourself (login is always manual), open grailed.com/sell/new, then Recheck.'
                    : 'No Sell-form tab is open — open one below, then Fill. Filling now would type into whatever page Chrome is showing.'}
              </div>
              <div className="mt-2.5 flex gap-2">
                {!fillBlocked.connected && (
                  <Button size="sm" className="flex-1" disabled={launchingChrome} onClick={launchChrome}>
                    {launchingChrome ? 'Launching…' : 'Launch Chrome'}
                  </Button>
                )}
                {fillBlocked.connected && fillBlocked.loggedIn !== false && (
                  <Button size="sm" className="flex-1" disabled={openingSellTab} onClick={openSellTabAndRecheck}>
                    {openingSellTab ? 'Opening…' : 'Open Sell form'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={fillBlocked.connected && fillBlocked.loggedIn === false ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={recheckChrome}
                >
                  Recheck
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => fillListing({ force: true, changedOnly: changedFill && !armed })}
                >
                  Fill anyway
                </Button>
              </div>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="outline" className="flex-1 px-2" title="Copy the listing text to the clipboard" onClick={copyListing}>
              Copy text
            </Button>
            <Button
              variant="outline"
              className="flex-1 px-2"
              title="Start a new draft of a similar garment — text and details are copied; photos, fill history, and Smart Pricing start fresh."
              onClick={duplicateItem}
            >
              Duplicate
            </Button>
            {item.status !== 'submitted' && (
              <Button variant="outline" className="flex-1 px-2" onClick={() => setConfirmSubmit(true)}>
                Mark listed
              </Button>
            )}
          </div>
          {confirmSubmit && (
            <div className="mt-2 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-xs">
              <div className="mb-2 text-foreground">
                Did you actually publish this listing on Grailed (in the Chrome window)? The app can’t check — this
                only updates its own status.
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={markSubmitted}>
                  Yes — it’s live on Grailed
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmSubmit(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <p className="mt-2.5 text-xs text-muted-foreground">
            Fill types into the launched Chrome on Grailed’s Sell page — it never submits. Watch the Chrome-status
            chip up top; you review and publish in Chrome.
          </p>
        </section>

        {/* Edits made since the last fill — what a re-fill will touch, with
            live status; photo changes are flagged as manual. */}
        <FillChangesCard
          changes={fillChanges?.changes ?? []}
          lastFillAt={fillChanges?.lastFillAt ?? null}
          run={fillRun}
          filling={filling}
        />

        {/* S3: live per-field checklist during (and after) a fill run. */}
        <FillProgressCard run={fillRun} filling={filling} />

        {/* Q1: persistent post-fill warning — the highest-stakes fact in the app.
            A toast is not proportional to "a reload silently discards the fill". */}
        {fillOutcome && (
          <div className="rounded-md border border-warning/60 border-l-[3px] border-l-warning bg-warning/10 p-3 text-sm-">
            <div className="font-medium text-warning">Filled in Chrome — but NOT saved on Grailed yet.</div>
            <div className="mt-0.5 text-muted-foreground">
              Filled: {fillOutcome.join(', ')}. A page reload there reverts to Grailed’s last saved draft. Click{' '}
              <span className="font-medium text-foreground">Save as Draft</span> or{' '}
              <span className="font-medium text-foreground">Publish</span> in the Chrome window to keep it.
            </div>
            {/* Batch posting flow: after publishing in Chrome, ONE click marks
                this item listed, jumps to the next draft, and starts its fill.
                Nothing advances without this click. */}
            {nextDraft && (
              <Button size="sm" className="glow-primary mt-2.5 w-full" onClick={publishAndNext}>
                I published — fill next draft
              </Button>
            )}
            {nextDraft && (
              <div className="mt-1 truncate text-center text-2xs text-muted-foreground" title={nextDraft.title}>
                next: {nextDraft.title}
              </div>
            )}
            {/* Last draft in the batch: no "fill next" target, but the user is
                in the same just-filled-and-published context that justifies the
                one-click mark-listed for middle items — so offer it here too
                (mirrors publishAndNext; no separate arm/confirm needed). */}
            {!nextDraft && (
              <Button
                size="sm"
                className="glow-primary mt-2.5 w-full"
                onClick={() => {
                  setFillOutcome(null);
                  markSubmitted();
                }}
              >
                I published — mark this listed
              </Button>
            )}
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setFillOutcome(null)}>
              {nextDraft ? 'I only saved a draft in Chrome' : 'I saved it in Chrome'}
            </Button>
          </div>
        )}
      </aside>
      </div>
    </div>
  );
}
