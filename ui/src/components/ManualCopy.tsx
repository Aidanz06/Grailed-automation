import { Button } from '@/components/ui/button';
import { Modal } from '@/components/Modal';

/*
 * Manual-copy fallback (UX audit #18): when both clipboard mechanisms fail
 * (lib/clipboard.ts copyText → false), the text opens here in a selectable
 * textarea — an instruction the user can always follow, unlike "logged to
 * the console" (the packaged app has no console).
 */

interface Props {
  text: string;
  onClose: () => void;
}

export function ManualCopyModal({ text, onClose }: Props) {
  return (
    <Modal
      title="Copy it manually"
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      className="rise-in left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-4 shadow-xl"
    >
      <div className="mb-1.5 text-sm font-semibold">Copy it manually</div>
      <p className="mb-2.5 text-xs text-muted-foreground">
        The clipboard is blocked right now — the text is selected below; press Cmd/Ctrl+C to copy it.
      </p>
      <textarea
        readOnly
        autoFocus
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        className="h-44 w-full resize-none rounded-md border bg-secondary/40 p-2.5 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="mt-2.5 flex justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
