import { type ReactNode } from 'react';
import type { DescProfile, Item } from '@/types';
import type { Selection, UpdateItem } from '@/App';
import type { BatchResult } from '@/lib/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DraftEditor } from '@/components/DraftEditor';
import { ReviewScreen } from '@/components/ReviewScreen';
import { ImportScreen } from '@/components/ImportScreen';

interface EditorProps {
  selection: Selection;
  item: Item | null;
  defaultProfile: DescProfile;
  setDefaultProfile: (p: DescProfile) => void;
  updateItem: UpdateItem;
  toast: (msg: string) => void;
  onImported: (result: BatchResult) => void;
  /** Open an item from the import summary screen. */
  onOpenItem: (id: number) => void;
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
}

export function Editor({ selection, item, defaultProfile, setDefaultProfile, updateItem, toast, onImported, onOpenItem, onReviewResolved, nextDraft, autoFillId, onAutoFillConsumed, onMarkListedAndNext, autoPickImport, onAutoPickConsumed }: EditorProps) {
  let content: ReactNode;
  if (selection === 'import') {
    content = <ImportScreen toast={toast} onImported={onImported} onOpenItem={onOpenItem} autoPick={autoPickImport} onAutoPickConsumed={onAutoPickConsumed} />;
  } else if (!item) {
    content = <div className="flex h-full items-center justify-center text-muted-foreground">Select an item from the queue.</div>;
  } else if (item.status === 'needs_review' || !item.content?.title) {
    content = <ReviewScreen item={item} toast={toast} onResolved={onReviewResolved} />;
  } else {
    content = (
      <DraftEditor
        item={item}
        update={(recipe) => updateItem(item.id, recipe)}
        defaultProfile={defaultProfile}
        setDefaultProfile={setDefaultProfile}
        toast={toast}
        nextDraft={nextDraft && nextDraft.id !== item.id ? nextDraft : null}
        autoFill={autoFillId === item.id}
        onAutoFillConsumed={onAutoFillConsumed}
        onMarkListedAndNext={onMarkListedAndNext}
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="min-h-full">{content}</div>
    </ScrollArea>
  );
}
