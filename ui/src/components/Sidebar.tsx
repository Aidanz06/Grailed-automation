import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Folder, FolderPlus, Plus, Trash2 } from 'lucide-react';
import type { Item, ItemStatus } from '@/types';
import type { Selection } from '@/App';
import { cn } from '@/lib/utils';
import { GRAILED_PHOTO_LIMIT, isTriageDraft, readiness, useTriageOrder } from '@/lib/readiness';
import { quality, qualityTitle } from '@/lib/quality';
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

// R1 triage filter: a quick lens over the queue, not navigation state — reset
// per mount is fine, so it stays local.
type TriageFilter = 'all' | 'attention' | 'ready';
const FILTERS: Array<{ key: TriageFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'ready', label: 'Ready' },
];

/*
 * Sidebar folders (owner request 2026-07-17): nameable groups at the bottom of
 * the item queue — drag a listing onto a folder to tuck it out of the main
 * list while keeping it one click away. Pure view-layer organization:
 * membership lives in localStorage (not the DB), and items keep their normal
 * status/queue behavior (J/K and fill-next still walk foldered drafts).
 */
const FOLDERS_KEY = 'tailor.sidebarFolders';
interface SidebarFolder {
  name: string;
  ids: number[];
  open: boolean;
}
function loadFolders(): SidebarFolder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f && typeof f.name === 'string' && Array.isArray(f.ids))
      .map((f) => ({ name: f.name, ids: f.ids.filter((n: unknown) => typeof n === 'number'), open: !!f.open }));
  } catch {
    return [];
  }
}

interface SidebarProps {
  items: Item[];
  selected: Selection;
  onSelect: (s: Selection) => void;
}

export function Sidebar({ items, selected, onSelect }: SidebarProps) {
  const [filter, setFilter] = useState<TriageFilter>('all');

  // Folders: persisted on every change; deleted items simply don't resolve
  // when rendering members (no eager pruning needed).
  const [folders, setFolders] = useState<SidebarFolder[]>(loadFolders);
  useEffect(() => {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch {
      /* private mode — folders won't persist, harmless */
    }
  }, [folders]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dragId = useRef<number | null>(null);
  const filedIds = new Set(folders.flatMap((f) => f.ids));
  const byId = new Map(items.map((it) => [it.id, it]));

  const fileInto = (name: string, id: number) =>
    setFolders((fs) =>
      fs.map((f) =>
        f.name === name
          ? { ...f, ids: f.ids.includes(id) ? f.ids : [...f.ids, id] }
          : { ...f, ids: f.ids.filter((x) => x !== id) }
      )
    );
  const unfile = (id: number) => setFolders((fs) => fs.map((f) => ({ ...f, ids: f.ids.filter((x) => x !== id) })));
  const addFolder = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    setFolders((fs) => (fs.some((f) => f.name === name) ? fs : [...fs, { name, ids: [], open: true }]));
  };
  // Deleting a folder only un-files its listings — nothing about the items changes.
  const removeFolder = (name: string) => setFolders((fs) => fs.filter((f) => f.name !== name));
  const toggleFolder = (name: string) =>
    setFolders((fs) => fs.map((f) => (f.name === name ? { ...f, open: !f.open } : f)));

  // Triage order (R1): review first, then drafts needing a human, then ready
  // drafts, then listed — shared with App's J/K + fill-next queue via
  // lib/readiness.ts so "next" always matches what's on screen. Positions are
  // frozen between status changes (useTriageOrder) so rows don't jump when a
  // draft's readiness flips mid-edit.
  const ordered = useTriageOrder(items);
  const shown = ordered.filter((it) => {
    if (filedIds.has(it.id)) return false; // foldered items live under their folder
    if (filter === 'all') return true;
    if (!isTriageDraft(it)) return filter === 'attention' && (it.status === 'needs_review' || !it.content?.title);
    return filter === 'ready' ? readiness(it).ready : !readiness(it).ready;
  });

  // One row — used by the main list AND expanded folders (drag moves items
  // between the two; the row markup must not diverge).
  const renderItem = (it: Item) => {
    const hasListing = !!it.content?.title;
    const cover = it.photos[0];
    // R1 readiness chip: "Ready" or the top blocker, so a correct
    // draft never has to be opened just to check on it. The §D4
    // quality score rides along in the tooltip.
    const q = isTriageDraft(it) ? quality(it) : null;
    const r = q?.r ?? null;
    return (
      <li
        key={it.id}
        className="relative"
        draggable
        onDragStart={(e) => {
          dragId.current = it.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(it.id));
        }}
        onDragEnd={() => {
          dragId.current = null;
          setDragOverFolder(null);
        }}
      >
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
            className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-md border"
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
          <div className="min-w-0 flex-1">
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
  };

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
        {/* Dropping a dragged item anywhere OUTSIDE a folder row un-files it
            (folder drops stopPropagation before this fires). */}
        <ul
          className="space-y-1 p-1.5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId.current != null) unfile(dragId.current);
            dragId.current = null;
            setDragOverFolder(null);
          }}
        >
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
                  : filedIds.size > 0
                    ? 'Everything is filed in the folders below.'
                    : 'No items yet — import a batch of photos.'}
            </li>
          )}
          {shown.map(renderItem)}

          {/* Folders — drop targets; expanded members render the same rows. */}
          {(folders.length > 0 || newFolderOpen) && (
            <li className="mt-3 px-2.5 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Folders
            </li>
          )}
          {folders.map((f) => {
            const members = f.ids.map((id) => byId.get(id)).filter(Boolean) as Item[];
            return (
              <li key={f.name}>
                <div
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md border border-transparent px-2.5 py-2 text-[13px] transition-colors',
                    dragOverFolder === f.name ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverFolder(f.name);
                  }}
                  onDragLeave={() => setDragOverFolder((cur) => (cur === f.name ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragId.current != null) fileInto(f.name, dragId.current);
                    dragId.current = null;
                    setDragOverFolder(null);
                  }}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    title="Show or hide this folder's listings — drag items onto the name to file them"
                    onClick={() => toggleFolder(f.name)}
                  >
                    {f.open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{members.length}</span>
                  </button>
                  <button
                    aria-label={`delete folder ${f.name}`}
                    title="Delete this folder — its listings return to the list above (nothing else changes)"
                    className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive"
                    onClick={() => removeFolder(f.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {f.open && members.length === 0 && (
                  <div className="px-3 pb-1 pl-10 text-[11px] text-muted-foreground">
                    empty — drag a listing onto the folder name
                  </div>
                )}
                {f.open && members.length > 0 && <ul className="mt-0.5 space-y-1 pl-3">{members.map(renderItem)}</ul>}
              </li>
            );
          })}
          <li>
            {newFolderOpen ? (
              <input
                autoFocus
                placeholder="folder name — Enter to create"
                className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addFolder(e.currentTarget.value);
                    setNewFolderOpen(false);
                  } else if (e.key === 'Escape') setNewFolderOpen(false);
                }}
                onBlur={() => setNewFolderOpen(false)}
              />
            ) : (
              <button
                title="Create a folder to tuck finished listings out of the way — drag items in; they stay one click away"
                className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlus className="h-3.5 w-3.5" /> New folder
              </button>
            )}
          </li>
        </ul>
      </ScrollArea>
    </aside>
  );
}
