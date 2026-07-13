import { ArrowRight } from 'lucide-react';
import type { Item } from '@/types';
import type { Album } from '@/lib/api';
import type { Selection } from '@/App';
import { isTriageDraft, triageSort } from '@/lib/readiness';
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
  albums: Album[];
  selected: Selection;
  /** The tracker's one control: jump to this draft and start its (gated) fill. */
  onFillNext: (id: number) => void;
}

export function FillTracker({ items, albums, selected, onFillNext }: Props) {
  const current = typeof selected === 'number' ? items.find((it) => it.id === selected) ?? null : null;

  // Scope to the current item's import batch (album) when it has one;
  // otherwise track across all items with listings.
  const albumId = current?.albumId ?? null;
  const scope = items.filter((it) => !!it.content?.title && (albumId == null || it.albumId === albumId));
  const album = albumId != null ? albums.find((a) => a.id === albumId) : null;

  const listed = scope.filter((it) => it.status === 'submitted').length;
  const drafts = triageSort(scope).filter(isTriageDraft);
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

  return (
    <div className="flex items-center gap-3 border-b bg-card/60 px-4 py-1.5 text-xs">
      <span className="shrink-0 font-medium tabular-nums">
        {listed} of {total} listed
      </span>
      <ProgressBar pct={(listed / total) * 100} className="w-24 shrink-0" />
      {album && <span className="hidden shrink-0 text-muted-foreground lg:inline">{album.name}</span>}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {current && curIdx !== -1 && (
          <>
            now: <span className="text-foreground">{current.content?.title}</span>
          </>
        )}
        {next && (
          <>
            {current && curIdx !== -1 && ' · '}next up: <span className="text-foreground">{next.content?.title}</span>
          </>
        )}
      </span>
      {next && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          title="Jump to the next draft and start its fill — same single-click trigger as “fill next draft”, and it only fires onto a fresh Sell form. Never submits."
          onClick={() => onFillNext(next.id)}
        >
          Fill next draft <ArrowRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
