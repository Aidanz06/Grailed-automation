import { useEffect, useState } from 'react';
import { ArrowRight, CircleHelp, ClipboardCheck, Eye, EyeOff, Images, Plus, Trash2 } from 'lucide-react';
import type { Item } from '@/types';
import type { Album } from '@/lib/api';
import { isTriageDraft, readiness } from '@/lib/readiness';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChromeNotifier } from '@/components/ChromeNotifier';
import { GettingStarted } from '@/components/GettingStarted';
import { CheckUpdatesButton, type Updater } from '@/components/Updater';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn, formatWhen } from '@/lib/utils';

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + n);

const FLAG_LABELS: Record<string, string> = {
  multi_item_photo: 'Multiple garments in one photo',
  low_confidence_group: 'Low-confidence grouping',
  singleton_review: 'Single photo — confirm it’s its own item',
  processing_failed: 'Pricing/writing failed during import',
};

const ATTENTION_FLAGS = ['multi_item_photo', 'low_confidence_group', 'singleton_review', 'processing_failed'];

function attentionReason(item: Item): string {
  const f = item.flags.find((x) => !x.resolved);
  if (f) return f.detail ?? FLAG_LABELS[f.type] ?? f.type.replace(/_/g, ' ');
  if (item.status === 'needs_review') return 'Needs review';
  return '';
}

function Thumb({ tint, src }: { tint?: string; src?: string }) {
  return (
    <span className="relative h-10 w-8 shrink-0 overflow-hidden rounded" style={{ background: tint ?? '#333' }}>
      {src && (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
    </span>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

/** Permanent delete, two-step: first click arms (turns red "Sure?"), second
 * deletes; disarms itself after 3.5s. Sits BESIDE the row button — the whole
 * row is itself a button, so this can't nest inside it. */
function RowDelete({ title, onDelete }: { title: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      aria-label={armed ? `confirm delete ${title}` : `delete ${title}`}
      title={armed ? 'Click again to permanently delete (app only — Grailed is untouched)' : 'Delete this listing from the app'}
      className={cn(
        'flex w-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition-colors',
        armed
          ? 'border-destructive bg-destructive/15 text-destructive'
          : 'bg-card hover:border-destructive hover:text-destructive'
      )}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onDelete();
      }}
    >
      {armed ? <span className="px-1 text-[10px] font-semibold uppercase">Sure?</span> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}

interface Props {
  items: Item[];
  /** Import batches (Lightroom-style albums); hidden ones drop off the lists. */
  albums: Album[];
  onOpenItem: (id: number) => void;
  onNewBatch: () => void;
  /** Permanently delete a listing from the app (testing + cleanup). */
  onDeleteItem: (id: number) => void;
  /** Hide/show a whole import batch on this screen (nothing is deleted). */
  onToggleAlbum: (id: number, hidden: boolean) => void;
  /** Finish-drafts pass (R2): resolve every draft's remaining gaps in one queue. */
  onFinish: () => void;
  /** Open the in-app Guide (beta Part G) — the "?" button. */
  onOpenGuide: () => void;
  /** App-level toast — carries the Chrome notifier's launch-result copy. */
  toast?: (msg: string) => void;
  /** In-app updater state (App-owned) — renders the header "Check for
   * updates" entry; hidden entirely when the build isn't a git clone. */
  updater?: Updater;
}

// De-stubbed per the UX review (Q3): no "Check Grailed messages" dead button
// (deferred per §8.5 — add it back only when it does something), no demo-only
// "hide flagged" toggle, no "mock data" subtitle in shipped UI.
export function Home({ items, albums, onOpenItem, onNewBatch, onDeleteItem, onToggleAlbum, onFinish, onOpenGuide, toast, updater }: Props) {
  // Items in hidden albums leave every Home list (but stay in the workspace
  // sidebar and DB — hiding is organization, not deletion).
  const hiddenAlbumIds = new Set(albums.filter((a) => a.hidden).map((a) => a.id));
  const visible = items.filter((it) => it.albumId == null || !hiddenAlbumIds.has(it.albumId));
  const hiddenCount = items.length - visible.length;
  const needsAttention = visible.filter(
    (it) => it.status === 'needs_review' || it.flags.some((f) => !f.resolved && ATTENTION_FLAGS.includes(f.type))
  );
  const drafts = visible.filter((it) => it.status === 'draft');
  const listed = visible.filter((it) => it.status === 'submitted');
  // R2: drafts with unresolved required fields — what "Finish drafts" walks.
  const unready = drafts.filter((it) => isTriageDraft(it) && !readiness(it).ready).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b bg-card px-6 py-3">
        <span className="font-display text-xl tracking-tight">
          Tailor <span className="italic text-primary">Studio</span>
        </span>
        <span className="flex-1" />
        {updater && <CheckUpdatesButton u={updater} />}
        <Button variant="ghost" size="sm" title="How Tailor works — the guide" aria-label="open guide" onClick={onOpenGuide}>
          <CircleHelp />
        </Button>
        <ThemeToggle />
        {unready > 0 && (
          <Button
            variant="outline"
            title="One pass over every draft that still needs something — only the gaps are shown, complete drafts are skipped."
            onClick={onFinish}
          >
            <ClipboardCheck /> Finish drafts ({unready})
          </Button>
        )}
        <Button onClick={onNewBatch}>
          <Plus /> New batch
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-9 px-6 py-8">
          {/* 0. Beta Part B: until the first listing goes live, a LIVE
              get-started checklist leads — the Chrome notifier's status and
              actions fold into its step 2 (same hooks; only one poll mounts).
              After that, the plain Chrome status row takes over. */}
          {!items.some((it) => it.status === 'submitted') ? (
            <GettingStarted
              items={items}
              onNewBatch={onNewBatch}
              onOpenDraft={drafts.length ? onOpenItem : null}
              firstDraftId={drafts[0]?.id ?? null}
              toast={toast}
            />
          ) : (
            <ChromeNotifier toast={toast} />
          )}

          {/* 1. Needs your attention */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Needs your attention</h2>
            </div>
            {needsAttention.length === 0 ? (
              <EmptyRow text="All clear — nothing needs review." />
            ) : (
              <ul className="space-y-2">
                {needsAttention.map((it) => (
                  <li key={it.id} className="flex items-stretch gap-2">
                    <button
                      onClick={() => onOpenItem(it.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
                    >
                      <Thumb tint={it.photos[0]?.tint} src={it.photos[0]?.src} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.content?.title ?? 'Ungrouped photos'}</div>
                        <div className="truncate text-xs text-warning">{attentionReason(it)}</div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">Review <ArrowRight className="h-3 w-3" /></span>
                    </button>
                    <RowDelete title={it.content?.title ?? 'ungrouped photos'} onDelete={() => onDeleteItem(it.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2. Drafts waiting to post */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Drafts waiting to post <span className="text-muted-foreground/60">({drafts.length})</span>
            </h2>
            {drafts.length === 0 ? (
              <EmptyRow text="No drafts yet — import a batch of photos to create your first ones." />
            ) : (
              <ul className="space-y-2">
                {drafts.map((it) => (
                  <li key={it.id} className="flex items-stretch gap-2">
                    <button
                      onClick={() => onOpenItem(it.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
                    >
                      <Thumb tint={it.photos[0]?.tint} src={it.photos[0]?.src} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.content?.title}</div>
                        <div className="text-xs text-muted-foreground">created {formatWhen(it.createdAt)}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <div className="font-medium tabular-nums">
                          {money(it.range?.low)}–{money(it.range?.high)}
                        </div>
                        <div className="flex items-center justify-end gap-1 text-muted-foreground">Edit <ArrowRight className="h-3 w-3" /></div>
                      </div>
                    </button>
                    <RowDelete title={it.content?.title ?? 'draft'} onDelete={() => onDeleteItem(it.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. Currently listed on Grailed */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Currently listed on Grailed <span className="text-muted-foreground/60">({listed.length})</span>
            </h2>
            {listed.length === 0 ? (
              <EmptyRow text="Nothing listed yet — open a draft and Fill it in Chrome when you're ready." />
            ) : (
              <ul className="space-y-2">
                {listed.map((it) => (
                  <li key={it.id} className="flex items-stretch gap-2">
                    <button
                      onClick={() => onOpenItem(it.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
                    >
                      <Thumb tint={it.photos[0]?.tint} src={it.photos[0]?.src} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.content?.title}</div>
                        <div className="text-xs text-muted-foreground">listed {formatWhen(it.submittedAt)}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <div className="font-medium tabular-nums text-success">{money(it.range?.median)}</div>
                        <div className="flex items-center justify-end gap-1 text-muted-foreground">View <ArrowRight className="h-3 w-3" /></div>
                      </div>
                    </button>
                    <RowDelete title={it.content?.title ?? 'listing'} onDelete={() => onDeleteItem(it.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 4. Albums — one per import batch (Lightroom-style). Hiding a
              finished batch declutters the lists above; nothing is deleted and
              everything stays reachable in the workspace sidebar. */}
          {albums.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Albums — past imports{' '}
                {hiddenCount > 0 && <span className="text-muted-foreground/60">({hiddenCount} items hidden above)</span>}
              </h2>
              <ul className="space-y-2">
                {albums.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border bg-card p-3',
                      a.hidden && 'opacity-60'
                    )}
                  >
                    <Images className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.itemCount} item{a.itemCount === 1 ? '' : 's'} · {a.listedCount} listed
                        {a.reviewCount > 0 && <span className="text-warning"> · {a.reviewCount} to review</span>}
                        {' · imported '}
                        {formatWhen(a.createdAt)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      title={
                        a.hidden
                          ? 'Show this batch’s items on the Home screen again'
                          : 'Hide this batch’s items from the Home screen (kept in the app — nothing is deleted)'
                      }
                      onClick={() => onToggleAlbum(a.id, !a.hidden)}
                    >
                      {a.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {a.hidden ? 'Show' : 'Hide'}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
