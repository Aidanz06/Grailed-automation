import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Item } from '@/types';
import type { Album } from '@/lib/api';
import { GRAILED_PHOTO_LIMIT, triageSort } from '@/lib/readiness';
import { quality, qualityTitle, type Quality, type QualityState } from '@/lib/quality';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CoverThumb } from '@/components/CoverThumb';
import { TwoStepDelete } from '@/components/TwoStepDelete';
import { cn, money } from '@/lib/utils';

/*
 * Batch triage board (refinement plan §C/§E5): the batch — not the item — is
 * the unit of work. Every item is a photo-forward garment card with its
 * quality state and, when it isn't ready, the ONE thing to fix next, so a
 * correct draft never has to be opened just to check on it. Sorted by the
 * shared triage order (review → needs attention → ready → listed) — the same
 * order the sidebar, J/K, and fill-next use. Purely a lens over the items:
 * opening a card goes to the same editor; nothing here fills or submits.
 */

export const FLAG_LABELS: Record<string, string> = {
  multi_item_photo: 'Multiple garments in one photo',
  low_confidence_group: 'Low-confidence grouping',
  singleton_review: 'Single photo — confirm it’s its own item',
  processing_failed: 'Pricing/writing failed during import',
};

export function reviewReason(item: Item): string {
  const f = item.flags.find((x) => !x.resolved);
  if (f) return f.detail ?? FLAG_LABELS[f.type] ?? f.type.replace(/_/g, ' ');
  return 'Needs review';
}

type BoardFilter = 'all' | 'attention' | 'ready' | 'listed';
const FILTERS: Array<{ key: BoardFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'ready', label: 'Ready' },
  { key: 'listed', label: 'Listed' },
];

/** The state/next-step line on a card — Ready, listed, or the top blocker. */
function StateLine({ item, q }: { item: Item; q: Quality }) {
  if (q.state === 'listed') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-2xs font-medium uppercase tracking-wide text-success">
        <CheckCircle2 className="h-3 w-3 shrink-0" /> Listed
      </span>
    );
  }
  if (q.state === 'ready') {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1 text-2xs font-medium uppercase tracking-wide text-success"
        title="Every required field is set — fill it whenever you're ready."
      >
        <CheckCircle2 className="h-3 w-3 shrink-0" /> Ready
      </span>
    );
  }
  if (q.state === 'review') {
    return (
      <span className="truncate text-2xs font-medium uppercase tracking-wide text-warning" title={reviewReason(item)}>
        Review
      </span>
    );
  }
  return (
    <span
      className="truncate text-2xs font-medium uppercase tracking-wide text-warning"
      title={`Next: ${q.r.blocker!.label} — ${q.r.blocker!.sub} (${q.r.doneCount}/${q.r.requiredCount} required done)`}
    >
      {q.r.blocker!.short}
    </span>
  );
}

interface Props {
  /** Items to board — already filtered for hidden albums by the caller. */
  items: Item[];
  /** Visible (non-hidden) albums for the batch scope select. */
  albums: Album[];
  /** Pre-scope the board to one batch (post-import landing); null = all. */
  initialAlbumId?: number | null;
  onOpenItem: (id: number) => void;
  onDeleteItem: (id: number) => void;
}

export function TriageBoard({ items, albums, initialAlbumId, onOpenItem, onDeleteItem }: Props) {
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [albumSel, setAlbumSel] = useState<string>(
    initialAlbumId != null && albums.some((a) => a.id === initialAlbumId) ? String(initialAlbumId) : 'all'
  );

  const scoped = albumSel === 'all' ? items : items.filter((it) => it.albumId === Number(albumSel));
  const cards = triageSort(scoped).map((it) => ({ it, q: quality(it) }));
  const count = (s: QualityState) => cards.filter((c) => c.q.state === s).length;
  const listedCount = count('listed');
  const readyCount = count('ready');
  const unlisted = cards.length - listedCount;

  const shown = cards.filter(({ q }) => {
    if (filter === 'all') return true;
    if (filter === 'attention') return q.state === 'attention' || q.state === 'review';
    return q.state === filter;
  });

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Batch board</h2>
        {cards.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {readyCount} of {unlisted} ready
            {listedCount > 0 && <span className="text-success"> · {listedCount} listed</span>}
          </span>
        )}
        <span className="flex-1" />
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-md px-2 py-1 text-2xs transition-colors',
                filter === f.key ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-secondary/60'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {albums.length > 1 && (
          <Select value={albumSel} onValueChange={setAlbumSel}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches</SelectItem>
              {albums.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {cards.length === 0
            ? 'No items in this batch yet — import a folder of photos to create drafts.'
            : filter === 'attention'
              ? 'Nothing needs attention here — every draft is ready to fill.'
              : filter === 'ready'
                ? 'No drafts are fully ready yet — the cards under “Needs attention” show what each one is missing.'
                : 'Nothing listed from this batch yet.'}
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {shown.map(({ it, q }) => {
            const cover = it.photos[0];
            const title = it.content?.title;
            return (
              <li key={it.id} className="group relative">
                <TwoStepDelete variant="card" title={title ?? 'ungrouped photos'} onDelete={() => onDeleteItem(it.id)} />
                <button
                  onClick={() => onOpenItem(it.id)}
                  className={cn(
                    'w-full overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary',
                    q.state === 'listed' && 'opacity-75 hover:opacity-100'
                  )}
                >
                  <CoverThumb photo={cover} className="aspect-[4/5] w-full">
                    {it.photos.length > 1 && (
                      <span
                        className={cn(
                          'absolute bottom-1 right-1 rounded bg-black/60 px-1 text-2xs tabular-nums',
                          it.photos.length > GRAILED_PHOTO_LIMIT ? 'font-semibold text-warning' : 'text-white'
                        )}
                        title={
                          it.photos.length > GRAILED_PHOTO_LIMIT
                            ? `Grailed allows ${GRAILED_PHOTO_LIMIT} photos — remove ${it.photos.length - GRAILED_PHOTO_LIMIT}`
                            : undefined
                        }
                      >
                        {it.photos.length}
                      </span>
                    )}
                  </CoverThumb>
                  <div className="p-2.5">
                    {/* Fixed-height wrapper keeps card rows aligned; the clamp
                        lives on the inner div (a min-height ON the clamped
                        element stretches it past its 2-line height and lets a
                        sliver of the hidden 3rd line paint). */}
                    <div className="min-h-[2.5rem]">
                      <div
                        className={cn(
                          'line-clamp-2 text-sm- font-medium leading-snug',
                          !title && 'font-normal italic text-muted-foreground'
                        )}
                      >
                        {title ?? '(needs review — no listing yet)'}
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <StateLine item={it} q={q} />
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" title={qualityTitle(q)}>
                        {q.score}
                      </span>
                    </div>
                    {/* §F: the price with its comp context inline — how many
                        sales back the number and how much to trust it. */}
                    <div
                      className="mt-1 truncate font-mono text-xs tabular-nums text-muted-foreground"
                      title={
                        it.range?.confidence
                          ? `${it.range.sampleSize ?? it.range.mostRelevantComps.length} sold comps · ${it.range.confidence.level} confidence — ${it.range.confidence.explanation}`
                          : undefined
                      }
                    >
                      <span className={q.state === 'listed' ? 'text-success' : 'text-foreground'}>
                        {money(it.range?.median)}
                      </span>
                      {(() => {
                        const n = it.range?.sampleSize ?? it.range?.mostRelevantComps.length ?? 0;
                        const conf = it.range?.confidence?.level;
                        return (
                          <>
                            {n > 0 && ` · ${n} comps`}
                            {conf && ` · ${conf}`}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
