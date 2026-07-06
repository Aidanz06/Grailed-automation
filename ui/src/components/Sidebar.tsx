import { Plus } from 'lucide-react';
import type { Item, ItemStatus } from '@/types';
import type { Selection } from '@/App';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

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

interface SidebarProps {
  items: Item[];
  selected: Selection;
  onSelect: (s: Selection) => void;
}

export function Sidebar({ items, selected, onSelect }: SidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span>Items</span>
        <span className="tabular-nums">{items.length}</span>
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
          {items.map((it) => {
            const hasListing = !!it.content?.title;
            const cover = it.photos[0];
            return (
              <li key={it.id}>
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
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] tabular-nums text-white">
                        {it.photos.length}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('line-clamp-2 text-sm font-medium leading-snug', !hasListing && 'font-normal italic text-muted-foreground')}>
                      {hasListing ? it.content!.title : '(needs review — no listing yet)'}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className={cn('px-2 py-0 text-[10px] uppercase tracking-wide', STATUS_CLASS[it.status])}>
                        {STATUS_LABEL[it.status]}
                      </Badge>
                      {it.flags.some((f) => !f.resolved) && (
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" title="open flags" />
                      )}
                      {it.dirty && <span className="ml-auto text-[11px] text-primary">• edited</span>}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </aside>
  );
}
