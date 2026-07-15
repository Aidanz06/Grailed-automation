import { useMemo, useState } from 'react';
import { CheckCircle2, CheckSquare, Plus, Square } from 'lucide-react';
import type { Item, ItemStatus } from '@/types';
import type { Selection, UpdateItem } from '@/App';
import { cn } from '@/lib/utils';
import { GRAILED_PHOTO_LIMIT, isTriageDraft, readiness, triageSort } from '@/lib/readiness';
import { quality, qualityTitle } from '@/lib/quality';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BulkActionBar } from '@/components/BulkActionBar';

const STATUS_LABEL: Record<ItemStatus, string> = {
  draft: 'draft',
  needs_review: 'needs review',
  submitted: 'listed', // vocab aligned with Home's "Currently listed on Grailed"
  grouped: 'grouped',
};

// Colored badges per status (change #9 from the vanilla shell): blue / amber / green.
const STATUS_CLASS: Record<ItemStatus, string> = {
  draft: 'border-transparent bg-primary/15 text-primary',
  needs_review: 'border-transparent bg-warning/15 text-warning',
  submitted: 'border-transparent bg-success/15 text-success',
  grouped: 'border-transparent bg-muted text-muted-foreground',
};

// R1 triage filter: a quick lens over the queue, not navigation state — reset
// per mount is fine, so it stays local.
type TriageFilter = 'all' | 'attention' | 'ready';
const FILTERS: Array<{ key: TriageFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'ready', label: 'Ready' },
];

interface SidebarProps {
  items: Item[];
  selected: Selection;
  onSelect: (s: Selection) => void;
  /** R4 bulk edits apply through the same per-item state/save path. */
  updateItem: UpdateItem;
  toast: (msg: string) => void;
}

export function Sidebar({ items, selected, onSelect, updateItem, toast }: SidebarProps) {
  const [filter, setFilter] = useState<TriageFilter>('all');
  // R4 multi-select: checked draft ids for the bulk action bar. Stale ids
  // (item listed/deleted meanwhile) are dropped when computing targets.
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const toggleChecked = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkTargets = items.filter((it) => checked.has(it.id) && isTriageDraft(it));

  // Triage order (R1): review first, then drafts needing a human, then ready
  // drafts, then listed — shared with App's J/K + fill-next queue via
  // lib/readiness.ts so "next" always matches what's on screen.
  const ordered = useMemo(() => triageSort(items), [items]);
  const shown = ordered.filter((it) => {
    if (filter === 'all') return true;
    if (!isTriageDraft(it)) return filter === 'attention' && (it.status === 'needs_review' || !it.content?.title);
    return filter === 'ready' ? readiness(it).ready : !readiness(it).ready;
  });

  return (
    <aside className="flex min-h-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span>Items</span>
        <span className="tabular-nums">{items.length}</span>
      </div>
      <div className="flex gap-1 border-b px-1.5 py-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] transition-colors',
              filter === f.key ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-secondary/60'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ScrollArea className="flex-1">
        <ul className="space-y-1 p-1.5">
          <li>
            <button
              onClick={() => onSelect('import')}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-2.5 text-center text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground',
                selected === 'import' && 'border-primary bg-primary/10 text-primary'
              )}
            >
              <Plus className="h-4 w-4" /> New batch — import photos
            </button>
          </li>
          {shown.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">
              {filter === 'attention'
                ? 'Nothing needs attention — every draft is ready to fill.'
                : filter === 'ready'
                  ? 'No drafts are fully ready yet.'
                  : 'No items yet — import a batch of photos.'}
            </li>
          )}
          {shown.map((it) => {
            const hasListing = !!it.content?.title;
            const cover = it.photos[0];
            // R1 readiness chip: "Ready" or the top blocker, so a correct
            // draft never has to be opened just to check on it. The §D4
            // quality score rides along in the tooltip.
            const q = isTriageDraft(it) ? quality(it) : null;
            const r = q?.r ?? null;
            const isChecked = checked.has(it.id);
            return (
              <li key={it.id} className="relative">
                {/* R4 multi-select checkbox — a SIBLING of the row button (a
                    button can't nest in a button), floated over its corner. */}
                {r && (
                  <button
                    aria-label={isChecked ? `deselect ${it.content?.title}` : `select ${it.content?.title} for bulk edit`}
                    title="Select for bulk edit (condition / tags / description style)"
                    className={cn(
                      'absolute right-1.5 top-1.5 z-10 rounded p-0.5 transition-colors',
                      isChecked ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleChecked(it.id);
                    }}
                  >
                    {isChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                )}
                <button
                  onClick={() => onSelect(it.id)}
                  className={cn(
                    'relative flex w-full items-center gap-3 rounded-md border border-transparent px-2.5 py-2.5 text-left transition-colors hover:bg-accent',
                    selected === it.id && 'bg-accent/70'
                  )}
                >
                  {/* Selection accent: brass bar that fades/slides in. */}
                  <span
                    className={cn(
                      'absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-primary transition-all duration-300',
                      selected === it.id ? 'opacity-100' : 'opacity-0 -translate-x-1'
                    )}
                  />
                  {/* Item thumbnail (photo 1) — the fastest way to tell listings apart. */}
                  <div
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border"
                    style={{ background: cover?.tint ?? '#333' }}
                  >
                    {cover?.src && (
                      <img
                        src={cover.src}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    {it.photos.length > 1 && (
                      <span
                        className={cn(
                          'absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] tabular-nums',
                          it.photos.length > GRAILED_PHOTO_LIMIT ? 'font-semibold text-warning' : 'text-white'
                        )}
                      >
                        {it.photos.length}
                      </span>
                    )}
                  </div>
                  <div className={cn('min-w-0 flex-1', r && 'pr-4')}>
                    <div className={cn('line-clamp-2 text-sm font-medium leading-snug', !hasListing && 'font-normal italic text-muted-foreground')}>
                      {hasListing ? it.content!.title : '(needs review — no listing yet)'}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className={cn('px-2 py-0 text-[10px] uppercase tracking-wide', STATUS_CLASS[it.status])}>
                        {STATUS_LABEL[it.status]}
                      </Badge>
                      {r &&
                        (r.ready ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-success"
                            title={`Every required field is set — fill it whenever you're ready. ${qualityTitle(q!)}.`}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Ready
                          </span>
                        ) : (
                          <span
                            className="truncate text-[10px] font-medium uppercase tracking-wide text-warning"
                            title={`Next: ${r.blocker!.label} — ${r.blocker!.sub} (${r.doneCount}/${r.requiredCount} done). ${qualityTitle(q!)}.`}
                          >
                            {r.blocker!.short}
                          </span>
                        ))}
                      {it.flags.some((f) => !f.resolved) && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="open flags" />
                      )}
                      {it.dirty && <span className="ml-auto shrink-0 text-[11px] text-primary">• edited</span>}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
      {bulkTargets.length > 0 && (
        <BulkActionBar
          targets={bulkTargets}
          updateItem={updateItem}
          toast={toast}
          onClear={() => setChecked(new Set())}
        />
      )}
    </aside>
  );
}
