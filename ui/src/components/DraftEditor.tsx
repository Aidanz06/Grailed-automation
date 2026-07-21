import { useEffect, useState } from 'react';
import type { Item } from '@/types';
import { api } from '@/lib/api';
import { editsOf } from '@/lib/edits';
import { useFillOrchestration } from '@/components/useFillOrchestration';
import { activeTemplate, finalizeDescription } from '@/lib/description';
import { copyText } from '@/lib/clipboard';
import { errorMessage, money } from '@/lib/utils';
import { ManualCopyModal } from '@/components/ManualCopy';
import { PricePanel } from '@/components/PricePanel';
import { ListingChecklist } from '@/components/ListingChecklist';
import { FillActionsCard } from '@/components/FillActionsCard';
import { DraftForm } from '@/components/DraftForm';

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

export function DraftEditor({ item, update, stylesRaw, onEditStyles, toast, nextDraft, autoFill, onAutoFillConsumed, onMarkListedAndNext, fillSignal = 0, onFillingChange, onDuplicated }: Props) {
  const content = item.content!;
  const attrs = item.attributes;

  // Slice 2: debounced auto-save of edits back to the store. Edits set
  // `item.dirty`; ~800ms after they stop we persist and clear the flag. Each
  // keystroke replaces item.content/range/attributes identities, resetting the
  // timer (debounce). Note: measurements/descParts have no store column yet
  // (schema gap) — they persist in-session only.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // UX audit #9: a failed save re-attempts on this nonce — bumped by the
  // chip's retry click and by the 5s auto-retry timer below.
  const [saveRetryNonce, setSaveRetryNonce] = useState(0);

  useEffect(() => {
    if (!item.dirty) {
      // A save from another path (fill flush, save-and-next) landed — the
      // failed chip must not outlive the failure it reported.
      setSaveState((s) => (s === 'failed' ? 'idle' : s));
      return;
    }
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
          // Stay visibly failed (the chip is persistent + clickable) — idle
          // here looked exactly like success once the toast expired.
          setSaveState('failed');
          toast(`Save failed: ${errorMessage(err)}`);
        });
    }, 800);
    return () => clearTimeout(t);
  }, [item.dirty, item.content, item.range, item.attributes, item.id, saveRetryNonce]);

  // Auto-retry while failed and still dirty (~5s) — a missed toast must not
  // mean a silently lost edit; success returns to the normal saved flow.
  useEffect(() => {
    if (saveState !== 'failed') return;
    const t = setTimeout(() => setSaveRetryNonce((n) => n + 1), 5000);
    return () => clearTimeout(t);
  }, [saveState, saveRetryNonce]);

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


  const confirmed = !!(attrs.grailed_department && attrs.grailed_category);

  // S-1 PR-a: the entire fill state machine lives in useFillOrchestration;
  // PR-b: FillActionsCard renders it — this component just wires the two.
  const fill = useFillOrchestration({
    item,
    update,
    toast,
    nextDraft,
    autoFill,
    onAutoFillConsumed,
    onMarkListedAndNext,
    fillSignal,
    onFillingChange,
    onDuplicated,
    confirmed,
    lastSavedAt,
  });

  // Clipboard failure → the manual-copy modal (audit #18): the packaged app
  // has no console, so "logged to console" was an instruction the seller
  // couldn't follow. null = closed.
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const copyListing = () => {
    // Footer backstop (Description Styles): the copied text carries the active
    // style's constant footer even on legacy drafts stored before composition.
    const desc = finalizeDescription(content.description, activeTemplate(stylesRaw));
    const parts = [content.title, '', desc];
    parts.push('', 'Tags: ' + content.tags.join(', '), '', `Price: ${money(item.range?.median)}`);
    const text = parts.join('\n');
    copyText(text).then((ok) => {
      if (ok) toast('Listing copied — paste into Grailed’s sell form.');
      else setManualCopy(text);
    });
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
      <DraftForm
        item={item}
        update={update}
        toast={toast}
        stylesRaw={stylesRaw}
        onEditStyles={onEditStyles}
        confirmed={confirmed}
        saveState={saveState}
        onSaveRetry={() => setSaveRetryNonce((n) => n + 1)}
        lastSavedAt={lastSavedAt}
        now={now}
      />

      {/* Right rail: readiness checklist, price card, actions. Sticky so the
          checklist + fill CTA stay in view while scrolling the form. */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <div className="rise-in" style={{ animationDelay: '60ms' }}>
          <ListingChecklist item={item} />
        </div>

        <div className="rise-in" style={{ animationDelay: '120ms' }}>
          <PricePanel item={item} update={update} toast={toast} />
        </div>

        <FillActionsCard
          item={item}
          fill={fill}
          confirmed={confirmed}
          nextDraft={nextDraft}
          copyListing={copyListing}
          confirmSubmit={confirmSubmit}
          setConfirmSubmit={setConfirmSubmit}
          markSubmitted={markSubmitted}
        />
      </aside>
      </div>
      {manualCopy && <ManualCopyModal text={manualCopy} onClose={() => setManualCopy(null)} />}
    </div>
  );
}
