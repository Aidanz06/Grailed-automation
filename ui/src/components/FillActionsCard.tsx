import { useId } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Item } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FillChangesCard } from '@/components/FillChangesCard';
import { FillProgressCard } from '@/components/FillProgressCard';
import type { useFillOrchestration } from '@/components/useFillOrchestration';

/*
 * S-1 PR-b: the right rail's action cluster, extracted verbatim from
 * DraftEditor — the Fill CTA and everything that surrounds one fill run
 * (first-fill prompt, changed-only/fresh-form choice, blocked card, live
 * progress, the persistent not-saved-on-Grailed banner, publish-and-next).
 * All state and actions come from useFillOrchestration via the `fill` prop;
 * save-machinery bits (copy text, mark listed) stay in DraftEditor and ride
 * in as callbacks. The app never submits — every button here is one manual
 * trigger per item.
 */

interface Props {
  item: Item;
  fill: ReturnType<typeof useFillOrchestration>;
  /** Category cascade confirmed — widens the fill scope messaging. */
  confirmed: boolean;
  nextDraft: { id: number; title: string } | null;
  copyListing: () => void;
  /** S6 two-step "Mark listed" confirm — state stays with DraftEditor's save logic. */
  confirmSubmit: boolean;
  setConfirmSubmit: (v: boolean) => void;
  markSubmitted: () => void;
}

export function FillActionsCard({
  item,
  fill,
  confirmed,
  nextDraft,
  copyListing,
  confirmSubmit,
  setConfirmSubmit,
  markSubmitted,
}: Props) {
  const {
    filling,
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
  } = fill;

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

  return (
    <>
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
            onClick={fill.duplicateItem}
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
    </>
  );
}
