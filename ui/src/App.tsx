import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Link2, Ruler, Unlink2 } from 'lucide-react';
import type { DescProfile, Item } from '@/types';
import { DEFAULT_PROFILE } from '@/lib/description';
import { api, type Album } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { ChromeStatusChip } from '@/components/ChromeStatusChip';
import { Home } from '@/components/Home';
import { MeasureScreen } from '@/components/MeasureScreen';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BatchProgressBar } from '@/components/BatchProgressBar';

export type Selection = number | 'import';
export type View = 'home' | 'workspace' | 'measure';
export type UpdateItem = (id: number, recipe: (draft: Item) => void) => void;

// Persisted dock-Chrome intent (audit §2.5).
const DOCK_PREF_KEY = 'tailor.dockChrome';

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [view, setView] = useState<View>('home');
  const [selected, setSelected] = useState<Selection>('import');
  // Where Measure mode was launched from, so "Done" returns there (audit §2.2:
  // Measure is now reachable from the workspace, not just Home).
  const [measureReturn, setMeasureReturn] = useState<View>('home');
  // One-shot: "New batch" opens the OS folder picker on the Import screen
  // without the extra drop-zone click (audit §2.4). Consumed on mount.
  const [autoPickImport, setAutoPickImport] = useState(false);
  // "Listed, fill next": set when the user clicks "mark listed & fill next
  // draft" — the DraftEditor for this item starts its fill on mount (that
  // click IS the per-item manual trigger; nothing fills without it).
  const [autoFillId, setAutoFillId] = useState<number | null>(null);
  const [defaultProfile, setDefaultProfile] = useState<DescProfile>(() => structuredClone(DEFAULT_PROFILE));
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // §5.5 window docking: snap the real Chrome window against the app so
  // fill-review feels like one window. State lives in the main process
  // (dock:start/stop); this flag just tracks the toggle. Chrome quitting
  // undocks main-side and pushes dock:stopped so the toggle resets.
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const off = api.onDockStopped(({ reason }) => {
      setDocked(false);
      setToastMsg(`Chrome undocked: ${reason}`);
    });
    return off;
  }, []);
  const toggleDock = () => {
    if (docked) {
      setDocked(false);
      // Clear the persisted intent — the user deliberately undocked.
      try {
        localStorage.setItem(DOCK_PREF_KEY, '0');
      } catch {
        /* private mode / unavailable — non-fatal */
      }
      api.stopDock().catch(() => {});
      return;
    }
    api
      .startDock()
      .then((res) => {
        if (res.ok) {
          setDocked(true);
          try {
            localStorage.setItem(DOCK_PREF_KEY, '1');
          } catch {
            /* non-fatal */
          }
        } else setToastMsg(res.message ?? 'Could not dock Chrome.');
      })
      .catch((err) => {
        setToastMsg(errorMessage(err));
      });
  };
  // Audit §2.5: remember the dock preference across sessions. On entering the
  // workspace with intent set and not already docked, try to re-dock ONCE and
  // swallow failure quietly — Chrome may not be launched yet, so this must be
  // silent (no toast).
  useEffect(() => {
    if (view !== 'workspace' || docked) return;
    let want = false;
    try {
      want = localStorage.getItem(DOCK_PREF_KEY) === '1';
    } catch {
      want = false;
    }
    if (!want) return;
    api
      .startDock()
      .then((res) => {
        if (res.ok) setDocked(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const reloadItems = useCallback(
    () =>
      Promise.all([api.listItems(), api.listAlbums()])
        .then(([its, als]) => {
          setItems(its);
          setAlbums(als);
        })
        .catch((err) => console.error('[api] listItems failed', err)),
    []
  );

  useEffect(() => {
    reloadItems();
  }, [reloadItems]);

  // Stream drafts as they finish: batch:process announces each saved item via
  // the progress stream — refresh the lists incrementally so the sidebar (and
  // Home) fill up while the rest of the batch is still pricing/writing.
  useEffect(() => {
    const off = api.onBatchProgress((p) => {
      if (p.item?.itemId != null) reloadItems();
    });
    return off;
  }, [reloadItems]);

  useEffect(() => {
    if (!toastMsg) return;
    // Longer messages (fill summaries, error guidance) need longer than 2.8s.
    const t = setTimeout(() => setToastMsg(null), Math.max(2800, Math.min(9000, toastMsg.length * 55)));
    return () => clearTimeout(t);
  }, [toastMsg]);

  // §8.1 circuit-breaker banner: surface the open state up front, not just on
  // a failed recompute/fill. Checked on load + every 60s (breaker can trip
  // mid-session from an aborted autofill).
  const [circuitOpen, setCircuitOpen] = useState(false);
  useEffect(() => {
    const check = () =>
      api
        .getGuardStatus()
        .then((s) => setCircuitOpen(s.circuitOpen))
        .catch(() => {});
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  const updateItem = useCallback<UpdateItem>((id, recipe) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const draft = structuredClone(it);
        recipe(draft);
        return draft;
      })
    );
  }, []);

  const openItem = (id: number) => {
    setSelected(id);
    setView('workspace');
  };
  const newBatch = () => {
    setAutoPickImport(true); // open the folder picker on entry (audit §2.4)
    setSelected('import');
    setView('workspace');
  };
  const openMeasure = (from: View) => {
    setMeasureReturn(from);
    setView('measure');
  };

  const selectedItem = typeof selected === 'number' ? items.find((it) => it.id === selected) ?? null : null;

  // "Listed, fill next": the next draft in sidebar order (after the current
  // item, wrapping) — the one-click post-publish flow advances to it.
  const draftQueue = items.filter((it) => it.status === 'draft' && it.content?.title);
  const curIdx = typeof selected === 'number' ? draftQueue.findIndex((it) => it.id === selected) : -1;
  const nextDraftItem =
    draftQueue.length === 0
      ? null
      : curIdx === -1
        ? draftQueue[0]
        : draftQueue.length > 1
          ? draftQueue[(curIdx + 1) % draftQueue.length]
          : null;
  const nextDraft = nextDraftItem ? { id: nextDraftItem.id, title: nextDraftItem.content?.title ?? `item #${nextDraftItem.id}` } : null;

  return (
    <div className="flex h-full flex-col">
      {circuitOpen && (
        <div className="border-b border-destructive/50 bg-destructive/15 px-4 py-2 text-center text-[13px] font-medium text-destructive">
          Circuit breaker OPEN — live comps + autofill are disabled (PRD §8.1). Review the Grailed account, then
          remove data/CIRCUIT_OPEN to re-enable.
        </div>
      )}
      {/* Persistent import progress: a batch keeps running in the background while
          you navigate; show a thin top strip everywhere except the Import screen,
          which renders its own detailed bar. */}
      <BatchProgressBar hidden={view === 'workspace' && selected === 'import'} />
      <div className="min-h-0 flex-1">
      {view === 'home' ? (
        <Home
          items={items}
          albums={albums}
          onOpenItem={openItem}
          onNewBatch={newBatch}
          onToggleAlbum={(id, hidden) => {
            api
              .setAlbumHidden(id, hidden)
              .then(reloadItems)
              .catch((err) => setToastMsg(`Album update failed: ${errorMessage(err)}`));
          }}
          onDeleteItem={(id) => {
            const title = items.find((it) => it.id === id)?.content?.title ?? `item #${id}`;
            api
              .deleteItem(id)
              .then(() => {
                // If the deleted item was selected in the workspace, drop the
                // stale selection so returning there doesn't show a ghost.
                if (selected === id) setSelected('import');
                return reloadItems();
              })
              .then(() => setToastMsg(`Deleted “${title}” from the app. Grailed and your photo files are untouched.`))
              .catch((err) => setToastMsg(`Delete failed: ${errorMessage(err)}`));
          }}
          onMeasure={() => openMeasure('home')}
          toast={setToastMsg}
        />
      ) : view === 'measure' ? (
        <MeasureScreen
          drafts={draftQueue}
          toast={setToastMsg}
          onDone={() => {
            // Reload so editors show the numbers typed in measure mode, then
            // return to wherever Measure was launched from (Home or workspace).
            reloadItems().then(() => setView(measureReturn));
          }}
        />
      ) : (
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
            <Button variant="ghost" size="sm" onClick={() => setView('home')}>
              <ArrowLeft /> Home
            </Button>
            <span className="font-display text-lg tracking-tight">
              Tailor <span className="italic text-primary">Studio</span>
            </span>
            <span className="flex-1" />
            {draftQueue.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                title="Measure every draft in one pass — tab through all of them without opening each editor."
                onClick={() => openMeasure('workspace')}
              >
                <Ruler /> Measure
              </Button>
            )}
            <ChromeStatusChip toast={setToastMsg} />
            <Button
              variant={docked ? 'secondary' : 'ghost'}
              size="sm"
              title="Snaps the separate Chrome window against this one and keeps it glued while you move or resize. You still review and publish in Chrome."
              onClick={toggleDock}
            >
              {docked ? <Link2 className="text-primary" /> : <Unlink2 />}
              {docked ? 'Chrome docked' : 'Dock Chrome'}
            </Button>
            <ThemeToggle />
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
            <Sidebar items={items} selected={selected} onSelect={setSelected} />
            <Editor
              selection={selected}
              item={selectedItem}
              defaultProfile={defaultProfile}
              setDefaultProfile={setDefaultProfile}
              updateItem={updateItem}
              toast={setToastMsg}
              autoPickImport={autoPickImport}
              onAutoPickConsumed={() => setAutoPickImport(false)}
              onImported={() => {
                // The Import screen now shows its own summary (with per-group
                // Open buttons), so completion only refreshes the item list —
                // no navigation, which also means a background import can
                // never yank the user off whatever they moved on to.
                reloadItems();
              }}
              onOpenItem={(id) => {
                setSelected(id);
                setView('workspace');
              }}
              nextDraft={nextDraft}
              autoFillId={autoFillId}
              onAutoFillConsumed={() => setAutoFillId(null)}
              onMarkListedAndNext={(nextId) => {
                // Current item is already marked listed by the editor; jump to
                // the next draft and let its editor start the fill (the click
                // that got us here is the manual per-item trigger).
                reloadItems();
                setAutoFillId(nextId);
                setSelected(nextId);
              }}
              onReviewResolved={(nextId) => {
                // Reload BEFORE navigating so the resolved item renders its new
                // state (draft editor, moved photos) rather than the stale one.
                reloadItems().then(() => {
                  if (nextId == null) setView('home');
                  else setSelected(nextId);
                });
              }}
            />
          </div>
        </div>
      )}
      </div>

      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 max-w-[70%] -translate-x-1/2 rounded-md border bg-card px-4 py-2.5 text-sm shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
