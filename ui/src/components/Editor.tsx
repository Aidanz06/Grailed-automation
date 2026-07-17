import { useEffect, useState, type ReactNode } from 'react';
import type { Item } from '@/types';
import type { Selection, UpdateItem } from '@/App';
import type { BatchResult } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DraftEditor } from '@/components/DraftEditor';
import { ReviewScreen } from '@/components/ReviewScreen';
import { ImportScreen } from '@/components/ImportScreen';

interface EditorProps {
  selection: Selection;
  item: Item | null;
  /** Description Styles: raw persisted styles JSON + the global editor opener. */
  stylesRaw: string | null;
  onEditStyles: () => void;
  updateItem: UpdateItem;
  toast: (msg: string) => void;
  onImported: (result: BatchResult) => void;
  /** Open an item from the import summary screen. */
  onOpenItem: (id: number) => void;
  /** Land on the batch board scoped to a finished import (plan §C). */
  onOpenBoard: (result: BatchResult) => void;
  /** "New batch" wants the folder picker opened on entry (audit §2.4). */
  autoPickImport: boolean;
  onAutoPickConsumed: () => void;
  /** Review resolution finished: reload items, then select nextId (null → Home). */
  onReviewResolved: (nextId: number | null) => void;
  /** "Listed, fill next" batch posting flow (see DraftEditor). */
  nextDraft: { id: number; title: string } | null;
  autoFillId: number | null;
  onAutoFillConsumed: () => void;
  onMarkListedAndNext: (nextId: number) => void;
  /** R3 fill hotkey signal — passed through to the DraftEditor. */
  fillSignal: number;
  /** Fill-activity report — passed through to the DraftEditor (updater guard). */
  onFillingChange?: (busy: boolean) => void;
  /** §E8: a duplicate draft was created — reload and select it. */
  onDuplicated?: (newId: number) => void;
}

export function Editor({ selection, item, stylesRaw, onEditStyles, updateItem, toast, onImported, onOpenItem, onOpenBoard, onReviewResolved, nextDraft, autoFillId, onAutoFillConsumed, onMarkListedAndNext, autoPickImport, onAutoPickConsumed, fillSignal, onFillingChange, onDuplicated }: EditorProps) {
  // §J: pin draft-vs-review to the SELECTION, not to every items refresh — a
  // background reload (import streaming, etc.) must never yank an open draft
  // editor to the Review screen mid-edit. The mode recomputes when the user
  // navigates (item id changes); the one live transition allowed on the same
  // id is review → draft, because resolving a review group converts it into a
  // draft in place and the editor should follow.
  const wantsReview = !!item && (item.status === 'needs_review' || !item.content?.title);
  const [reviewMode, setReviewMode] = useState(wantsReview);
  const itemId = item?.id ?? null;
  useEffect(() => {
    setReviewMode(wantsReview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  useEffect(() => {
    if (reviewMode && !wantsReview) setReviewMode(false); // review → draft upgrade only
  }, [reviewMode, wantsReview]);

  let content: ReactNode;
  if (selection === 'import') {
    content = <ImportScreen toast={toast} onImported={onImported} onOpenItem={onOpenItem} onOpenBoard={onOpenBoard} autoPick={autoPickImport} onAutoPickConsumed={onAutoPickConsumed} />;
  } else if (!item) {
    content = <div className="flex h-full items-center justify-center text-muted-foreground">Select an item from the queue.</div>;
  } else if (reviewMode || !item.content) {
    // !item.content: a draft editor can't render without content at all —
    // the (pathological) safety valve; a mere status flip keeps the pin.
    content = <ReviewScreen item={item} toast={toast} onResolved={onReviewResolved} />;
  } else {
    content = (
      <DraftEditor
        item={item}
        update={(recipe) => updateItem(item.id, recipe)}
        stylesRaw={stylesRaw}
        onEditStyles={onEditStyles}
        toast={toast}
        nextDraft={nextDraft && nextDraft.id !== item.id ? nextDraft : null}
        autoFill={autoFillId === item.id}
        onAutoFillConsumed={onAutoFillConsumed}
        onMarkListedAndNext={onMarkListedAndNext}
        fillSignal={fillSignal}
        onFillingChange={onFillingChange}
        onDuplicated={onDuplicated}
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="min-h-full">{content}</div>
    </ScrollArea>
  );
}
