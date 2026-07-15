import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Command as CommandIcon } from 'lucide-react';
import type { Item } from '@/types';
import { cn } from '@/lib/utils';

/*
 * ⌘K command palette (refinement plan §E9): navigation + actions + draft
 * search from anywhere, keyboard-first. Purely an accelerator over EXISTING
 * paths — every command runs the same callback its button runs (Fill goes
 * through the same gated fillSignal path as the F key; nothing new touches
 * Grailed). The binding lives in lib/shortcuts.ts like every other key.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  /** Small right-aligned context hint ("navigate", "same as F"). */
  hint?: string;
  run: () => void;
}

type Entry =
  | { kind: 'command'; key: string; label: string; hint?: string; run: () => void }
  | { kind: 'item'; key: string; item: Item };

interface Props {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
  items: Item[];
  onOpenItem: (id: number) => void;
}

const STATUS_WORD: Record<string, string> = {
  draft: 'draft',
  needs_review: 'review',
  submitted: 'listed',
  grouped: 'grouped',
};

export function CommandPalette({ open, onClose, commands, items, onOpenItem }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      // autoFocus misses when the palette mounts mid-keydown; focus next tick.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const needle = q.trim().toLowerCase();
    const cmds: Entry[] = commands
      .filter((c) => !needle || c.label.toLowerCase().includes(needle))
      .map((c) => ({ kind: 'command', key: `c:${c.id}`, label: c.label, hint: c.hint, run: c.run }));
    // Drafts/listings by title — only once the user types, so the empty
    // palette reads as an action menu, not a second sidebar.
    const matched: Entry[] = needle
      ? items
          .filter((it) => it.content?.title && it.content.title.toLowerCase().includes(needle))
          .slice(0, 8)
          .map((it) => ({ kind: 'item', key: `i:${it.id}`, item: it }))
      : [];
    return [...cmds, ...matched];
  }, [q, commands, items]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    // Keep the selected row in view while arrowing through a long list.
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const runEntry = (e: Entry) => {
    onClose();
    if (e.kind === 'command') e.run();
    else onOpenItem(e.item.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(entries.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (entries[sel]) runEntry(entries[sel]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[14vh]" onMouseDown={onClose}>
      <div
        className="rise-in h-fit w-[560px] max-w-[90vw] overflow-hidden rounded-lg border bg-card shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <CommandIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            placeholder="Type a command or search your drafts…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</div>
          ) : (
            entries.map((e, i) => (
              <button
                key={e.key}
                data-selected={i === sel}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                  i === sel ? 'bg-accent' : 'hover:bg-accent/60'
                )}
                onMouseEnter={() => setSel(i)}
                onClick={() => runEntry(e)}
              >
                {e.kind === 'command' ? (
                  <>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    {e.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{e.hint}</span>}
                  </>
                ) : (
                  <>
                    <span
                      className="relative h-8 w-6 shrink-0 overflow-hidden rounded"
                      style={{ background: e.item.photos[0]?.tint ?? '#333' }}
                    >
                      {e.item.photos[0]?.src && (
                        <img
                          src={e.item.photos[0].src}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={(ev) => {
                            (ev.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{e.item.content?.title}</span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {STATUS_WORD[e.item.status] ?? e.item.status}
                    </span>
                  </>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
