import { useEffect, useState } from 'react';
import { ArrowRight, CircleHelp, ClipboardCheck, Eye, EyeOff, Images, LayoutGrid, Plus, Rows3, Trash2 } from 'lucide-react';
import type { Item } from '@/types';
import type { Album } from '@/lib/api';
import { DefaultsMenu } from '@/components/DefaultsMenu';
import { isTriageDraft, readiness } from '@/lib/readiness';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChromeNotifier } from '@/components/ChromeNotifier';
import { GettingStarted } from '@/components/GettingStarted';
import { FLAG_LABELS, TriageBoard, reviewReason } from '@/components/TriageBoard';
import { CheckUpdatesButton, type Updater } from '@/components/Updater';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn, formatWhen } from '@/lib/utils';

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + n);

// Persisted Home layout preference: the batch board is the default surface
// (refinement plan §C); the classic status lists stay one toggle away.
const HOME_VIEW_KEY = 'tailor.homeView';
type HomeView = 'board' | 'lists';

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

/** The classic Home lists (the pre-board layout, kept reachable behind the
 * Board/Lists toggle by owner decision): three flat sections by status. */
function HomeLists({ items, onOpenItem, onDeleteItem }: { items: Item[]; onOpenItem: (id: number) => void; onDeleteItem: (id: number) => void }) {
  const attentionFlags = Object.keys(FLAG_LABELS);
  const needsAttention = items.filter(
    (it) => it.status === 'needs_review' || it.flags.some((f) => !f.resolved && attentionFlags.includes(f.type))
  );
  const drafts = items.filter((it) => it.status === 'draft');
  const listed = items.filter((it) => it.status === 'submitted');

  return (
    <>
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
                    <div className="truncate text-xs text-warning">{reviewReason(it)}</div>
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
    </>
  );
}

interface Props {
  items: Item[];
  /** Import batches (Lightroom-style albums); hidden ones drop off the board. */
  albums: Album[];
  onOpenItem: (id: number) => void;
  onNewBatch: () => void;
  /** Permanently delete a listing from the app (testing + cleanup). */
  onDeleteItem: (id: number) => void;
  /** Hide/show a whole import batch on this screen (nothing is deleted). */
  onToggleAlbum: (id: number, hidden: boolean) => void;
  /** Confirm-drafts pass: one card per draft with gaps, keyboard-walked. */
  onFinish: () => void;
  /** Open the in-app Guide (beta Part G) — the "?" button. */
  onOpenGuide: () => void;
  /** Pre-scope the batch board to one album (post-import landing). */
  boardAlbumId?: number | null;
  /** Description Styles (App-owned): raw styles JSON, its setter (after a
   * save), and the global style-editor opener. */
  stylesRaw: string | null;
  onStylesChanged: (raw: string | null) => void;
  onEditStyles: () => void;
  /** App-level toast — carries the Chrome notifier's launch-result copy. */
  toast?: (msg: string) => void;
  /** In-app updater state (App-owned) — renders the header "Check for
   * updates" entry; hidden entirely when the build isn't a git clone. */
  updater?: Updater;
}

// Home = the batch triage board by default (refinement plan §C): garment
// cards with a quality state and the next thing to fix. The classic status
// lists remain one toggle away (owner decision 2026-07-14).
export function Home({ items, albums, onOpenItem, onNewBatch, onDeleteItem, onToggleAlbum, onFinish, onOpenGuide, boardAlbumId, stylesRaw, onStylesChanged, onEditStyles, toast, updater }: Props) {
  const [homeView, setHomeView] = useState<HomeView>(() => {
    try {
      return localStorage.getItem(HOME_VIEW_KEY) === 'lists' ? 'lists' : 'board';
    } catch {
      return 'board';
    }
  });
  const pickView = (v: HomeView) => {
    setHomeView(v);
    try {
      localStorage.setItem(HOME_VIEW_KEY, v);
    } catch {
      /* private mode — preference just won't persist */
    }
  };

  // Items in hidden albums leave the board and lists (but stay in the
  // workspace sidebar and DB — hiding is organization, not deletion).
  const hiddenAlbumIds = new Set(albums.filter((a) => a.hidden).map((a) => a.id));
  const visible = items.filter((it) => it.albumId == null || !hiddenAlbumIds.has(it.albumId));
  const hiddenCount = items.length - visible.length;
  // R2: drafts with unresolved required fields — what "Finish drafts" walks.
  const unready = visible.filter((it) => isTriageDraft(it) && !readiness(it).ready).length;

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
        <DefaultsMenu stylesRaw={stylesRaw} onStylesChanged={onStylesChanged} onEditStyles={onEditStyles} toast={toast ?? (() => {})} />
        {/* Board (default) vs classic lists — a layout preference, persisted. */}
        <div className="flex rounded-md border p-0.5">
          {(
            [
              { key: 'board', icon: LayoutGrid, label: 'Board — garment cards with readiness' },
              { key: 'lists', icon: Rows3, label: 'Lists — items grouped by status' },
            ] as const
          ).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              title={label}
              aria-label={label}
              className={cn(
                'rounded p-1.5 transition-colors',
                homeView === key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => pickView(key)}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <ThemeToggle />
        {unready > 0 && (
          <Button
            variant="outline"
            title="One card per draft that still needs something — confirm the key fields, correct the AI's text, keyboard through the queue. Complete drafts are skipped."
            onClick={onFinish}
          >
            <ClipboardCheck /> Confirm drafts ({unready})
          </Button>
        )}
        <Button onClick={onNewBatch}>
          <Plus /> New batch
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-9 px-6 py-8">
          {/* 0. Beta Part B: until the first listing goes live, a LIVE
              get-started checklist leads — the Chrome notifier's status and
              actions fold into its step 2 (same hooks; only one poll mounts).
              After that, the plain Chrome status row takes over. */}
          {!items.some((it) => it.status === 'submitted') ? (
            <GettingStarted
              items={items}
              onNewBatch={onNewBatch}
              onOpenDraft={visible.some((it) => it.status === 'draft') ? onOpenItem : null}
              firstDraftId={visible.find((it) => it.status === 'draft')?.id ?? null}
              toast={toast}
            />
          ) : (
            <ChromeNotifier toast={toast} />
          )}

          {/* 1. The batch board (default) or the classic status lists. */}
          {homeView === 'board' ? (
            <TriageBoard
              items={visible}
              albums={albums.filter((a) => !a.hidden)}
              initialAlbumId={boardAlbumId}
              onOpenItem={onOpenItem}
              onDeleteItem={onDeleteItem}
            />
          ) : (
            <HomeLists items={visible} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} />
          )}

          {/* 2. Albums — one per import batch (Lightroom-style). Hiding a
              finished batch declutters the board above; nothing is deleted and
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
                          ? 'Show this batch’s items on the board again'
                          : 'Hide this batch’s items from the board (kept in the app — nothing is deleted)'
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
