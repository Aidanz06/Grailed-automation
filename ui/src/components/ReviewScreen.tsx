import { useEffect, useState } from 'react';
import type { Item } from '@/types';
import { api } from '@/lib/api';
import { cn, errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// §5.1 "confirm, merge, split, or reassign" — the review queue's exit doors
// (UX review S1; previously both buttons were stubs and flagged groups could
// never become drafts). Every action records a correction event (§5.6) so the
// clustering accumulates ground truth from real fixes.

const REVIEW_REASONS: Record<string, string> = {
  singleton_review:
    'Single photo — usually a fragment split off from its item. Confirm it really is its own item, or assign it to one.',
  multi_item_photo: 'This photo appears to show more than one garment — split it before listing.',
  low_confidence_group: 'The photos in this group didn’t match each other strongly — confirm they’re one item.',
  split_review: 'Split off from another group — confirm it as its own item or assign it elsewhere.',
  processing_failed:
    'The group was formed but pricing/writing hit an error during import — confirm it to run the pipeline again.',
};

interface Props {
  item: Item;
  toast: (msg: string) => void;
  /** After a resolution: reload items and jump to `nextId` (null → Home). */
  onResolved: (nextId: number | null) => void;
}

export function ReviewScreen({ item, toast, onResolved }: Props) {
  const detail =
    item.flags.map((f) => f.detail ?? REVIEW_REASONS[f.type] ?? f.type.replace(/_/g, ' ')).join(' · ') ||
    (item.photos.length === 1
      ? REVIEW_REASONS.singleton_review
      : 'Low-confidence group — confirm, merge, split, or reassign before it becomes an item.');
  const confidence = item.photos[0]?.clusterConfidence;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | 'confirm' | 'split' | 'assign'>(null);
  const [assignTarget, setAssignTarget] = useState<string>('');
  // Assign targets = every other item (drafts first — the usual destination).
  const [targets, setTargets] = useState<Array<{ id: number; label: string }>>([]);
  useEffect(() => {
    api
      .listItems()
      .then((all) =>
        setTargets(
          all
            .filter((it) => it.id !== item.id)
            .sort((a, b) => (a.status === 'draft' ? -1 : 1) - (b.status === 'draft' ? -1 : 1))
            .map((it) => ({ id: it.id, label: `#${it.id} · ${it.content?.title ?? `${it.status} (untitled)`}` }))
        )
      )
      .catch(() => {});
    setSelected(new Set());
    setAssignTarget('');
  }, [item.id]);

  const toggle = (photoId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  const selectedIds = () => [...selected].map((s) => Number(s));

  const confirm = () => {
    setBusy('confirm');
    toast('Processing this group — attributes, comps, and listing content (~1 min)…');
    api
      .reviewConfirm(item.id)
      .then((res) => {
        toast(`Processed${res.title ? ` “${res.title}”` : ''} — it’s a draft now.`);
        onResolved(item.id);
      })
      .catch((err) => toast(`Couldn’t process the group: ${errorMessage(err)}`))
      .finally(() => setBusy(null));
  };

  const split = () => {
    setBusy('split');
    api
      .reviewSplit(item.id, selectedIds())
      .then((res) => {
        toast(`Moved ${selected.size} photo(s) into a new review group.`);
        onResolved(res.sourceDeleted ? res.newItemId : item.id);
      })
      .catch((err) => toast(`Split failed: ${errorMessage(err)}`))
      .finally(() => setBusy(null));
  };

  const assign = () => {
    const targetId = Number(assignTarget);
    setBusy('assign');
    api
      .reviewAssign(item.id, selectedIds(), targetId)
      .then((res) => {
        toast(`Moved ${selected.size} photo(s) to item #${targetId}.`);
        onResolved(res.sourceDeleted ? res.targetItemId : item.id);
      })
      .catch((err) => toast(`Assign failed: ${errorMessage(err)}`))
      .finally(() => setBusy(null));
  };

  const nSel = selected.size;
  const canSplit = nSel > 0 && nSel < item.photos.length && !busy;

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold">Photos in this group weren’t confidently clustered</h2>
      <p className="mt-1.5 text-sm text-warning">{detail}</p>
      {confidence != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          grouping confidence: {(confidence * 100).toFixed(0)}% (auto-accept needs ≥70% and no flags)
        </p>
      )}

      {/* Selectable photo tiles — selection drives split/assign. */}
      <div className="mt-5 flex flex-wrap gap-2.5">
        {item.photos.map((p) => {
          const isSel = selected.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              title={p.label}
              className={cn(
                'relative h-28 w-24 overflow-hidden rounded-lg border-2 transition-colors',
                isSel ? 'border-primary' : 'border-transparent hover:border-border'
              )}
              style={{ background: p.tint }}
            >
              {p.src && <img src={p.src} alt={p.label} className="h-full w-full object-cover" />}
              {isSel && (
                <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-bold text-primary-foreground">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Click photos to select them for split/assign. {nSel ? `${nSel} selected.` : 'None selected.'}
      </p>

      {/* Resolution actions */}
      <div className="mt-5 space-y-3">
        <div className="flex items-center gap-3">
          <Button disabled={!!busy} onClick={confirm}>
            {busy === 'confirm' ? 'Processing…' : '✓ These photos are one item — process into a draft'}
          </Button>
          <span className="text-xs text-muted-foreground">Runs attributes → comps → content (~1 min). Nothing is submitted.</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={!canSplit} onClick={split}>
            {busy === 'split' ? 'Splitting…' : `Split ${nSel || ''} selected into a new group`}
          </Button>
          <span className="text-xs text-muted-foreground">
            {nSel === item.photos.length ? 'Leave at least one photo behind (or use assign).' : 'The rest stay here.'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Select value={assignTarget || undefined} onValueChange={setAssignTarget}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="assign selected to item…" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={!nSel || !assignTarget || !!busy} onClick={assign}>
            {busy === 'assign' ? 'Moving…' : `Move ${nSel || ''} selected`}
          </Button>
        </div>
      </div>
    </div>
  );
}
