import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { Item } from '@/types';
import type { UpdateItem } from '@/App';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONDITIONS } from '@/components/ConditionChips';

/*
 * R4 bulk edit bar: one action across the selected drafts instead of N editor
 * visits. SAFE seller-judgment fields only — condition, tags, description
 * style. Size and price VALUES are deliberately absent (per-item truth;
 * never bulk-set); bulk Recompute re-runs each item's OWN comps.
 * Every action is the existing per-item saveItem edit applied in a loop —
 * no bulk fill, no bulk submit, nothing touches Grailed.
 */

interface Props {
  /** The currently selected draft items (already filtered to drafts). */
  targets: Item[];
  updateItem: UpdateItem;
  toast: (msg: string) => void;
  onClear: () => void;
}

export function BulkActionBar({ targets, updateItem, toast, onClear }: Props) {
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState('');

  /** Apply one per-item edit across the selection via the normal saveItem
   * path; local state mirrors only the items whose save succeeded. */
  const run = async (
    verb: string,
    mutate: (d: Item) => void,
    applies: (it: Item) => boolean = () => true
  ) => {
    if (busy) return;
    setBusy(true);
    let ok = 0;
    let skipped = 0;
    const failures: string[] = [];
    for (const it of targets) {
      if (!applies(it)) {
        skipped++;
        continue;
      }
      const draft = structuredClone(it);
      mutate(draft);
      try {
        await api.saveItem(it.id, { content: draft.content, attributes: draft.attributes });
        updateItem(it.id, mutate);
        ok++;
      } catch (err) {
        failures.push(errorMessage(err));
      }
    }
    setBusy(false);
    toast(
      `${verb} on ${ok} draft${ok === 1 ? '' : 's'}` +
        (skipped ? `, ${skipped} skipped` : '') +
        (failures.length ? `. ${failures.length} failed: ${failures[0]}` : '.')
    );
  };

  const setCondition = (v: string) =>
    run(`Set condition “${v}”`, (d) => {
      d.attributes.condition_rating = v;
    });

  const addTag = () => {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    setTag('');
    run(
      `Added tag “${t}”`,
      (d) => {
        if (d.content && !d.content.tags.some((x) => x.toLowerCase() === t)) d.content.tags.push(t);
      },
      (it) => !!it.content
    );
  };

  const removeTag = () => {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    setTag('');
    run(
      `Removed tag “${t}”`,
      (d) => {
        if (d.content) d.content.tags = d.content.tags.filter((x) => x.toLowerCase() !== t);
      },
      (it) => !!it.content?.tags.some((x) => x.toLowerCase() === t)
    );
  };

  // The old per-item Minimal/Standard/Detailed bulk action is gone —
  // description structure now comes from the global style templates
  // (Description Styles Phase 1); Regenerate applies the active one.

  // Bulk Recompute: each item's price re-derives from its OWN comps — no
  // value is copied across items.
  const recomputeAll = async () => {
    if (busy) return;
    setBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const it of targets) {
      try {
        const { range } = await api.recomputeComps(it.attributes);
        await api.saveItem(it.id, { range });
        updateItem(it.id, (d) => {
          d.range = range;
        });
        ok++;
      } catch (err) {
        failures.push(errorMessage(err));
      }
    }
    setBusy(false);
    toast(
      `Recomputed prices for ${ok} draft${ok === 1 ? '' : 's'} (each from its own comps)` +
        (failures.length ? `. ${failures.length} failed: ${failures[0]}` : '.')
    );
  };

  return (
    <div className="border-t bg-secondary/40 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium">
          {targets.length} draft{targets.length === 1 ? '' : 's'} selected
        </span>
        {busy && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={onClear} disabled={busy}>
          <X className="h-3 w-3" /> Clear
        </Button>
      </div>
      <div className="space-y-2">
        <Select value={undefined} onValueChange={setCondition} disabled={busy}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Set condition for all selected…" />
          </SelectTrigger>
          <SelectContent>
            {CONDITIONS.filter((c) => c !== 'Unclear').map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1.5">
          <Input
            value={tag}
            placeholder="tag…"
            className="h-8 flex-1 text-xs"
            disabled={busy}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag();
            }}
          />
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={busy || !tag.trim()} onClick={addTag}>
            Add
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={busy || !tag.trim()} onClick={removeTag}>
            Remove
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full text-xs"
          disabled={busy}
          title="Re-runs each draft's own sold-comps lookup — prices are never copied between items."
          onClick={recomputeAll}
        >
          <RefreshCw className={busy ? 'animate-spin' : ''} /> Recompute prices (each from its own comps)
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Size and price values stay per-item — they’re never bulk-set. No bulk fill either: filling is
        one click per draft.
      </p>
    </div>
  );
}
