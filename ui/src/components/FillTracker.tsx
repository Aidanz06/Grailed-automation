import { ArrowRight } from 'lucide-react';
import type { Item } from '@/types';
import type { Selection } from '@/App';
import { isTriageDraft, useTriageOrder } from '@/lib/readiness';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/motion';

/*
 * R5 batch fill tracker: a compact persistent strip under the workspace
 * header — "3 of 9 listed", the draft you're on, and the next one queued —
 * so momentum survives the app↔Chrome round-trips. The next-draft control
 * reuses the existing single-click fill-next (App's autoFillId path): that
 * click IS the per-item manual trigger, gated by the fresh-Sell-form probe
 * in the editor. Nothing fills without it; nothing ever submits.
 */

interface Props {
  items: Item[];
  selected: Selection;
  /** The tracker's one control: jump to this draft and start its (gated) fill. */
  onFillNext: (id: number) => void;
}

export function FillTracker({ items, selected, onFillNext }: Props) {
  const current = typeof selected === 'number' ? items.find((it) => it.id === selected) ?? null : null;

  // Scope to the current item's import batch (album) when it has one;
  // otherwise track across all items with listings.
  const albumId = current?.albumId ?? null;
  const scope = items.filter((it) => !!it.content?.title && (albumId == null || it.albumId === albumId));

  const listed = scope.filter((it) => it.status === 'submitted').length;
  const drafts = useTriageOrder(scope).filter(isTriageDraft);
  const total = listed + drafts.length;

  // Collapsed when nothing is in flight: a single-item scope isn't a batch,
  // and a fully-listed batch has nothing left to track.
  if (total < 2 || drafts.length === 0) return null;

  const curIdx = current ? drafts.findIndex((it) => it.id === current.id) : -1;
  const next =
    drafts.length === 0
      ? null
      : curIdx === -1
        ? drafts[0]
        : drafts.length > 1
          ? drafts[(curIdx + 1) % drafts.length]
          : null;

  // Slimmed (owner request 2026-07-17): count + bar + current draft + the one
  // control. The album name and "next up" echo are gone — the button's tooltip
  // carries the next title.
  return (
    <div className="flex items-center gap-3 border-b bg-card/60 px-4 py-1 text-xs">
      <span className="shrink-0 font-medium tabular-nums">
        {listed}/{total} listed
      </span>
      <ProgressBar pct={(listed / total) * 100} className="w-20 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {current && curIdx !== -1 && (
          <>
            now: <span className="text-foreground">{current.content?.title}</span>
          </>
        )}
      </span>
      {next && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          title={`Next: ${next.content?.title ?? ''} — jump there and start its fill. Same single-click trigger as “fill next draft”; only fires onto a fresh Sell form. Never submits.`}
          onClick={() => onFillNext(next.id)}
        >
          Fill next <ArrowRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
