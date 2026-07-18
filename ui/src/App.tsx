import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Link2, Unlink2 } from 'lucide-react';
import type { Item } from '@/types';
import { api, type Album, type ConfigStatus } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { isTriageDraft, readiness, useTriageOrder } from '@/lib/readiness';
import { matchShortcut } from '@/lib/shortcuts';
import { ChromeStatusChip } from '@/components/ChromeStatusChip';
import { GuideMenu, type GuideSection } from '@/components/GuideMenu';
import { Onboarding, ONBOARDED_KEY } from '@/components/Onboarding';
import { CheckUpdatesButton, UpdateBanner, UpdateModal, useUpdater } from '@/components/Updater';
import { editsOf } from '@/components/DraftEditor';
import { Home } from '@/components/Home';
import { ConfirmScreen } from '@/components/ConfirmScreen';
import { CommandPalette, type PaletteCommand } from '@/components/CommandPalette';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { StyleEditor } from '@/components/StyleEditor';
import { FillTracker } from '@/components/FillTracker';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BatchProgressBar } from '@/components/BatchProgressBar';

export type Selection = number | 'import';
export type View = 'home' | 'workspace' | 'confirm';
export type UpdateItem = (id: number, recipe: (draft: Item) => void) => void;

// Persisted dock-Chrome intent (audit §2.5).
const DOCK_PREF_KEY = 'tailor.dockChrome';

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [view, setView] = useState<View>('home');
  const [selected, setSelected] = useState<Selection>('import');
  // Where a batch pass (Confirm drafts) was launched from, so "Done" returns
  // there (audit §2.2: passes are reachable from Home AND workspace).
  const [passReturn, setPassReturn] = useState<View>('home');
  // One-shot: "New batch" opens the OS folder picker on the Import screen
  // without the extra drop-zone click (audit §2.4). Consumed on mount.
  const [autoPickImport, setAutoPickImport] = useState(false);
  // Post-import landing (plan §C): "Review the batch" pre-scopes the Home
  // board to that import's album. Cleared whenever Home is reached any other
  // way, so a later manual visit shows all batches again.
  const [boardAlbum, setBoardAlbum] = useState<number | null>(null);
  // "Listed, fill next": set when the user clicks "mark listed & fill next
  // draft" — the DraftEditor for this item starts its fill on mount (that
  // click IS the per-item manual trigger; nothing fills without it).
  const [autoFillId, setAutoFillId] = useState<number | null>(null);
  // Description Styles (Phase 1): the raw persisted styles JSON, loaded once —
  // components resolve it with resolveStyles(); the StyleEditor modal saves it
  // and pushes the new value back through setStylesRaw.
  const [stylesRaw, setStylesRaw] = useState<string | null>(null);
  const [styleEditorOpen, setStyleEditorOpen] = useState(false);
  useEffect(() => {
    api
      .getDescriptionStyles()
      .then(setStylesRaw)
      .catch(() => {}); // unset/unavailable → built-in presets
  }, []);
  const openStyleEditor = useCallback(() => setStyleEditorOpen(true), []);
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
        setToastMsg(`Couldn’t dock Chrome — ${errorMessage(err)}`);
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
          // §J: never clobber in-flight edits. reloadItems fires on background
          // events (import streaming, album toggles, …) and used to replace
          // the whole array — wiping the in-memory state of the item being
          // edited mid-debounce. Dirty items keep their in-memory version;
          // the DB one takes over once their auto-save lands (dirty clears).
          setItems((prev) =>
            its.map((fresh) => {
              const cur = prev.find((p) => p.id === fresh.id);
              return cur?.dirty ? cur : fresh;
            })
          );
          setAlbums(als);
        })
        .catch((err) => console.error('[api] listItems failed', err)),
    []
  );

  useEffect(() => {
    reloadItems();
  }, [reloadItems]);

  // In-app updater: quiet check on launch (inside useUpdater) + banner/modal.
  // Busy refs feed the guard — never rebuild the app under a running import
  // (batch:progress stream, non-terminal stage) or fill (DraftEditor report).
  const batchBusyRef = useRef(false);
  const fillBusyRef = useRef(false);
  const isBusy = useCallback(() => batchBusyRef.current || fillBusyRef.current, []);
  const updater = useUpdater(setToastMsg, isBusy);

  // Stream drafts as they finish: batch:process announces each saved item via
  // the progress stream — refresh the lists incrementally so the sidebar (and
  // Home) fill up while the rest of the batch is still pricing/writing.
  useEffect(() => {
    const off = api.onBatchProgress((p) => {
      batchBusyRef.current = p.stage !== 'done' && p.stage !== 'error';
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

  // Preflight config check (beta Part E): a build without its keys should say
  // so calmly on launch, not fail deep inside the first import. Booleans only
  // — no key material ever reaches this process. Checked once; keys don't
  // appear mid-session.
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  useEffect(() => {
    api
      .getConfigStatus()
      .then(setConfig)
      .catch(() => {});
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
  const openConfirm = (from: View) => {
    setPassReturn(from);
    setView('confirm');
  };

  const selectedItem = typeof selected === 'number' ? items.find((it) => it.id === selected) ?? null : null;

  // "Listed, fill next": the next draft in sidebar order (after the current
  // item, wrapping) — the one-click post-publish flow advances to it. Sidebar
  // order is now the R1 triage order (needs-attention drafts first), shared
  // via lib/readiness.ts so "next" always matches what's on screen.
  const draftQueue = useTriageOrder(items).filter(isTriageDraft);
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

  // R2: drafts with at least one unresolved required field — the Finish pass
  // walks exactly these; the button hides when there's nothing to finish.
  const unreadyCount = draftQueue.filter((it) => !readiness(it).ready).length;

  // R3 keyboard-first navigation (bindings live in lib/shortcuts.ts — the
  // guide renders the same table, so docs can't drift). J/K/arrows move
  // through the sidebar's draft order; Cmd/Ctrl+Enter saves and advances even
  // mid-typing; F is one manual fill keypress routed through the editor's
  // gated fill path (probe + blocked card — never fires onto a stale page,
  // never submits). matchShortcut() drops plain keys while typing.
  const [fillSignal, setFillSignal] = useState(0);

  // Beta Part A: one-time first-run welcome (persists via localStorage);
  // Part G: the Guide overlay, reopenable from the "?" buttons any time.
  // `guide` holds the section to open with, or null when closed.
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDED_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const dismissOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* private mode — it'll show again next launch, harmless */
    }
  };
  const [guide, setGuide] = useState<GuideSection | null>(null);

  // ⌘K command palette — available from EVERY screen (its binding lives in
  // lib/shortcuts.ts with the rest, so the guide documents it for free).
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(e) === 'palette') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Every command runs an EXISTING path — the palette adds reach, not powers.
  const paletteCommands: PaletteCommand[] = [
    ...(view !== 'home'
      ? [{ id: 'home', label: 'Go to the board (Home)', hint: 'navigate', run: () => { setBoardAlbum(null); setView('home'); } }]
      : []),
    { id: 'new-batch', label: 'New batch — import photos', hint: 'opens the folder picker', run: newBatch },
    ...(unreadyCount > 0 && view !== 'confirm'
      ? [{ id: 'confirm', label: `Confirm drafts (${unreadyCount})`, hint: 'one card per gap', run: () => openConfirm(view === 'workspace' ? 'workspace' : 'home') }]
      : []),
    ...(view === 'workspace' && selectedItem && selectedItem.status !== 'submitted' && selectedItem.content?.title
      ? [{ id: 'fill', label: `Fill “${selectedItem.content.title}” in Chrome`, hint: 'same gated path as F', run: () => setFillSignal((s) => s + 1) }]
      : []),
    { id: 'guide', label: 'Open the guide', hint: 'how it works + shortcuts', run: () => setGuide('how') },
  ];

  useEffect(() => {
    if (view !== 'workspace') return;
    const onKey = (e: KeyboardEvent) => {
      // The palette owns the keyboard while open (its input handles keys).
      if (paletteOpen) return;
      const id = matchShortcut(e);
      if (!id) return;
      const idx = typeof selected === 'number' ? draftQueue.findIndex((it) => it.id === selected) : -1;
      const go = (dir: 1 | -1) => {
        if (!draftQueue.length) return;
        const next =
          idx === -1
            ? dir === 1
              ? draftQueue[0]
              : draftQueue[draftQueue.length - 1]
            : draftQueue[(idx + dir + draftQueue.length) % draftQueue.length];
        setSelected(next.id);
      };
      if (id === 'nextDraft') {
        e.preventDefault();
        go(1);
      } else if (id === 'prevDraft') {
        e.preventDefault();
        go(-1);
      } else if (id === 'saveAndNext') {
        e.preventDefault();
        const cur = selectedItem;
        if (cur?.dirty) {
          api
            .saveItem(cur.id, editsOf(cur))
            .then(() =>
              updateItem(cur.id, (d) => {
                d.dirty = false;
              })
            )
            .catch((err) => setToastMsg(`Save failed: ${errorMessage(err)}`));
        }
        go(1);
      } else if (id === 'fill') {
        // Only a draft with content can fill; the editor's gate does the rest.
        if (selectedItem && selectedItem.status !== 'submitted' && selectedItem.content?.title) {
          e.preventDefault();
          setFillSignal((s) => s + 1);
        }
      } else if (id === 'help') {
        e.preventDefault();
        setGuide((g) => (g ? null : 'shortcuts'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected, items, paletteOpen]);

  return (
    <div className="flex h-full flex-col">
      {circuitOpen && (
        <div className="border-b border-destructive/50 bg-destructive/15 px-4 py-2 text-center text-[13px] font-medium text-destructive">
          Pricing and Fill are paused as a safety precaution — something looked off with the Grailed account, so the
          app stopped touching it. Nothing was submitted. Check the account in Chrome, then reach out to whoever set
          this up to re-enable.
        </div>
      )}
      {/* Beta Part E: calm setup banners for a keyless build. */}
      {config && !config.hasAnthropicKey && (
        <div className="border-b border-warning/50 bg-warning/10 px-4 py-2 text-center text-[13px] font-medium text-warning">
          This copy isn’t finished setting up (it’s missing an API key). Importing photos and drafting listings won’t
          work until it’s configured — reach out to whoever shared this with you.
        </div>
      )}
      {config && config.hasAnthropicKey && !config.hasCompsKey && (
        <div className="border-b bg-secondary/40 px-4 py-1.5 text-center text-xs text-muted-foreground">
          Price suggestions are limited on this copy (no sold-comps access configured) — you can still set prices
          yourself on every draft.
        </div>
      )}
      {/* In-app updater: quiet launch check surfaced as a small banner. */}
      <UpdateBanner u={updater} />
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
          onFinish={() => openConfirm('home')}
          onOpenGuide={() => setGuide('how')}
          boardAlbumId={boardAlbum}
          stylesRaw={stylesRaw}
          onStylesChanged={setStylesRaw}
          onEditStyles={openStyleEditor}
          toast={setToastMsg}
          updater={updater}
        />
      ) : view === 'confirm' ? (
        <ConfirmScreen
          drafts={draftQueue}
          toast={setToastMsg}
          onOpenItem={(id) => {
            // A gap this pass can't fix inline (photos) — reload so the
            // editor sees the pass's saved fixes, then open the full editor.
            reloadItems().then(() => openItem(id));
          }}
          onDone={() => {
            reloadItems().then(() => setView(passReturn));
          }}
        />
      ) : (
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBoardAlbum(null); // manual Home visit → board shows all batches
                setView('home');
              }}
            >
              <ArrowLeft /> Home
            </Button>
            <span className="font-display text-lg tracking-tight">
              Tailor <span className="italic text-primary">Studio</span>
            </span>
            <span className="flex-1" />
            {unreadyCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                title="One card per draft that still needs something — confirm the key fields, correct the AI's text, keyboard through the queue. Complete drafts are skipped."
                onClick={() => openConfirm('workspace')}
              >
                <ClipboardCheck /> Confirm drafts ({unreadyCount})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              title="Guide & keyboard shortcuts (?)"
              aria-label="open guide and keyboard shortcuts"
              onClick={() => setGuide((g) => (g ? null : 'shortcuts'))}
            >
              ?
            </Button>
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
          {/* R5: batch momentum strip — count, current, and next queued. Its
              one control routes through the same autoFillId path as "fill
              next draft" (that click is the per-item manual trigger). */}
          <FillTracker
            items={items}
            selected={selected}
            onFillNext={(id) => {
              setAutoFillId(id);
              setSelected(id);
            }}
          />
          <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
            <Sidebar items={items} selected={selected} onSelect={setSelected} />
            <Editor
              selection={selected}
              item={selectedItem}
              stylesRaw={stylesRaw}
              onEditStyles={openStyleEditor}
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
              onOpenBoard={(result) => {
                // Land on the Home board scoped to the import's album — items
                // were reloaded when the batch finished, so the album can be
                // looked up from any item it produced.
                const firstId = result.processed.find((p) => p.itemId != null)?.itemId ?? null;
                const albumId = firstId != null ? items.find((it) => it.id === firstId)?.albumId ?? null : null;
                setBoardAlbum(albumId);
                setView('home');
              }}
              nextDraft={nextDraft}
              fillSignal={fillSignal}
              onFillingChange={(b) => {
                fillBusyRef.current = b;
              }}
              onDuplicated={(newId) => {
                // Reload so the clone exists in state, then select it — the
                // editor opens on the new draft with its "no photos" blocker.
                reloadItems().then(() => setSelected(newId));
              }}
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
                  if (nextId == null) {
                    setBoardAlbum(null);
                    setView('home');
                  } else setSelected(nextId);
                });
              }}
            />
          </div>
        </div>
      )}
      </div>

      {/* Beta A/G overlays: the Guide (keyed so it reopens on the requested
          section) and the one-time first-run welcome on top. */}
      {guide && <GuideMenu key={guide} open initialSection={guide} onClose={() => setGuide(null)} />}
      {showOnboarding && (
        <Onboarding
          onClose={dismissOnboarding}
          onImport={() => {
            dismissOnboarding();
            newBatch();
          }}
        />
      )}

      {/* ⌘K palette — App-rooted so it works from every screen. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
        items={items}
        onOpenItem={openItem}
      />

      {/* Updater progress modal — App-rooted so navigation can't lose it. */}
      <UpdateModal u={updater} toast={setToastMsg} />

      {/* Description Styles editor — App-rooted, opens from Defaults and the
          draft editor's style row. Saving pushes the new raw value back and
          reloads items (the mock preview composes descriptions on read). */}
      {styleEditorOpen && (
        <StyleEditor
          stylesRaw={stylesRaw}
          onSaved={(raw) => {
            setStylesRaw(raw);
            reloadItems();
          }}
          onClose={() => setStyleEditorOpen(false)}
          toast={setToastMsg}
        />
      )}

      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 max-w-[70%] -translate-x-1/2 rounded-md border bg-card px-4 py-2.5 text-sm shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
