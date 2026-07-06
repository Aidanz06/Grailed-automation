import { useEffect, useState } from 'react';
import { ArrowLeft, Ruler } from 'lucide-react';
import type { Item, Measurements } from '@/types';
import { api } from '@/lib/api';
import { measureFields, measureKind } from '@/lib/measurements';
import { cn, errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThemeToggle } from '@/components/ThemeToggle';

interface Props {
  /** Drafts waiting to post — the items worth measuring in one sitting. */
  drafts: Item[];
  toast: (msg: string) => void;
  /** Leave measure mode (App reloads items so editors see the new numbers). */
  onDone: () => void;
}

/**
 * Batch measure mode (real-run feedback 2026-07-04): measuring is the slowest
 * part of listing, so instead of opening 9 editors, tab through every draft's
 * category-specific blanks in one table. Values save automatically (debounced,
 * same store path as the editor); nothing is guessed or filled for you.
 */
export function MeasureScreen({ drafts, toast, onDone }: Props) {
  const [values, setValues] = useState<Record<number, Measurements>>(() =>
    Object.fromEntries(drafts.map((d) => [d.id, { ...(d.measurements ?? {}) }]))
  );
  const [dirty, setDirty] = useState<Set<number>>(() => new Set());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (!dirty.size) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      const ids = [...dirty];
      Promise.all(ids.map((id) => api.saveItem(id, { measurements: values[id] })))
        .then(() => {
          setDirty(new Set());
          setSaveState('saved');
        })
        .catch((err) => {
          console.error('[measure] save failed', err);
          setSaveState('idle');
          toast(`Save failed: ${errorMessage(err)}`);
        });
    }, 800);
    return () => clearTimeout(t);
  }, [values, dirty, toast]);

  const setValue = (id: number, key: string, v: string) => {
    setValues((prev) => ({ ...prev, [id]: { ...prev[id], [key]: v } }));
    setDirty((prev) => new Set(prev).add(id));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={onDone}>
          <ArrowLeft /> Done
        </Button>
        <Ruler className="h-4 w-4 text-primary" />
        <span className="font-display text-lg tracking-tight">Measure all drafts</span>
        <span className="flex-1" />
        {saveState !== 'idle' && (
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 text-xs transition-colors duration-300',
              saveState === 'saving'
                ? 'border-success/50 text-muted-foreground'
                : 'border-success bg-success/20 text-success'
            )}
          >
            {saveState === 'saving' ? 'Saving…' : 'Saved'}
          </span>
        )}
        <ThemeToggle />
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <p className="mb-5 text-sm text-muted-foreground">
            Tab through every draft in one pass — fields match each garment’s category (tops get pit-to-pit, bottoms
            get waist/inseam, footwear gets tagged size). Blanks are simply skipped in listings; nothing is guessed.
          </p>
          {drafts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No drafts to measure — import a batch first.
            </div>
          ) : (
            <ul className="space-y-3">
              {drafts.map((it) => {
                const fields = measureFields(it.attributes, values[it.id]);
                return (
                  <li key={it.id} className="rounded-lg border bg-card p-3">
                    <div className="mb-2.5 flex items-center gap-3">
                      <span
                        className="relative h-12 w-10 shrink-0 overflow-hidden rounded"
                        style={{ background: it.photos[0]?.tint ?? '#333' }}
                      >
                        {it.photos[0]?.src && (
                          <img
                            src={it.photos[0].src}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.content?.title}</div>
                        <div className="text-xs text-muted-foreground">measuring as: {measureKind(it.attributes)}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {fields.map((f) => (
                        <div key={f.key} className="flex w-[130px] flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">{f.label}</span>
                          <Input
                            value={values[it.id]?.[f.key] ?? ''}
                            placeholder={f.placeholder}
                            className={cn('h-8', !(values[it.id]?.[f.key]) && 'border-dashed')}
                            onChange={(e) => setValue(it.id, f.key, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
