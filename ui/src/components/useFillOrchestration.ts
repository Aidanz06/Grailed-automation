import { useEffect, useRef, useState } from 'react';
import type { Item } from '@/types';
import { api, type ChromeStatus, type FillChanges } from '@/lib/api';
import { editsOf } from '@/lib/edits';
import { errorMessage } from '@/lib/utils';
import { applyFillProgress, emptyFillRun, type FillRunState } from '@/components/FillProgressCard';
import { useOpenSellTab } from '@/components/ChromeStatusChip';

/*
 * S-1 PR-a: the fill state machine, extracted verbatim from DraftEditor —
 * every state, effect, and action that decides WHEN a fill fires and what
 * happens around it. The app never submits; every path here starts from one
 * manual user action per item (button, F key, palette, or the single
 * "listed, fill next" click). Rendering stays in DraftEditor/FillActionsCard.
 */

// Beta Part F: the very first fill ever shows a one-time heads-up.
const FIRST_FILL_KEY = 'tailor.firstFillConfirmed';
function firstFillSeen(): boolean {
  try {
    return localStorage.getItem(FIRST_FILL_KEY) === '1';
  } catch {
    return true; // storage unavailable — never block the fill over it
  }
}

interface Args {
  item: Item;
  update: (recipe: (draft: Item) => void) => void;
  toast: (msg: string) => void;
  /** Next draft in sidebar order — target of the "listed, fill next" flow. */
  nextDraft: { id: number; title: string } | null;
  /** True when the user's "fill next draft" click targeted THIS item. */
  autoFill: boolean;
  onAutoFillConsumed: () => void;
  onMarkListedAndNext: (nextId: number) => void;
  /** R3 "F" shortcut: increments per press — same gated path as the button. */
  fillSignal?: number;
  /** Reports fill activity upward (updater guard: never rebuild mid-fill). */
  onFillingChange?: (busy: boolean) => void;
  /** §E8: a duplicate draft was created — reload and select it. */
  onDuplicated?: (newId: number) => void;
  /** Category cascade confirmed — widens the fill scope messaging. */
  confirmed: boolean;
  /** Bumped when a debounced save lands — refetches the changed-fields diff. */
  lastSavedAt: number | null;
}

export function useFillOrchestration({
  item,
  update,
  toast,
  nextDraft,
  autoFill,
  onAutoFillConsumed,
  onMarkListedAndNext,
  fillSignal = 0,
  onFillingChange,
  onDuplicated,
  confirmed,
  lastSavedAt,
}: Args) {
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
  const changedCount = fillChanges?.changes.length ?? 0;

  // "Stop" during a fill (audit #4): sets the main-side cancel flag; the
  // driver finishes the in-flight field and skips the rest. The per-field
  // results (and the outcome banner) stay truthful about what got filled.
  const [stoppingFill, setStoppingFill] = useState(false);
  const stopFill = () => {
    setStoppingFill(true);
    api
      .cancelFill()
      .then((r) => {
        if (!r.ok && r.message) toast(r.message);
      })
      .catch((err) => toast(`Couldn’t stop the fill: ${errorMessage(err)}`));
  };

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
        if (res.cancelled) {
          toast(
            filled.length
              ? `Fill stopped — ${filled.join(', ')} already filled in Chrome. Nothing was submitted.`
              : 'Fill stopped — nothing was filled. Nothing was submitted.'
          );
        } else if (res.ok && filled.length) {
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
      .finally(() => {
        setFilling(false);
        setStoppingFill(false);
      });
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
  const fillListing = async ({ force = false, changedOnly = false, confirmed: promptConfirmed = false } = {}) => {
    if (!promptConfirmed && !firstFillSeen()) {
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

  return {
    filling,
    stoppingFill,
    stopFill,
    fillOutcome,
    setFillOutcome,
    fillRun,
    fillBlocked,
    armed,
    firstFillPrompt,
    setFirstFillPrompt,
    confirmFirstFill,
    fillChanges,
    changedFill,
    changedCount,
    fillListing,
    recheckChrome,
    openingSellTab,
    openSellTabAndRecheck,
    launchingChrome,
    launchChrome,
    publishAndNext,
    duplicateItem,
  };
}
