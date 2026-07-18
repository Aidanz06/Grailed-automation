import { useEffect } from 'react';

/*
 * Toast stack (QW-3): replaces App's single `toastMsg` string so a fill
 * summary and an unrelated failure can no longer erase each other. The
 * `toast: (msg: string) => void` contract threaded through consumers is
 * unchanged — only App's implementation moved here. Card styling is the
 * single toast's, verbatim.
 */

export interface Toast {
  id: number;
  msg: string;
}

/** Visible at once — older toasts drop off the top when a 4th arrives. */
export const TOAST_CAP = 3;

/** Length-scaled auto-dismiss, kept from the single-toast era (App.tsx:172):
 * fill summaries and error guidance need longer than 2.8s. */
export function toastDuration(msg: string): number {
  return Math.max(2800, Math.min(9000, msg.length * 55));
}

/** Append a toast, capped at TOAST_CAP (oldest dropped first). Pure. */
export function appendToast(list: Toast[], t: Toast): Toast[] {
  return [...list, t].slice(-TOAST_CAP);
}

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: (id: number) => void }) {
  // Each toast owns its timer — a new toast never resets an older one's.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(t.id), toastDuration(t.msg));
    return () => clearTimeout(timer);
  }, [t.id, t.msg, onDismiss]);
  return (
    <div className="flex items-start gap-2.5 rounded-md border bg-card px-4 py-2.5 text-sm shadow-lg">
      <span className="min-w-0">{t.msg}</span>
      <button
        aria-label="dismiss notification"
        className="ml-auto shrink-0 px-1 leading-none text-muted-foreground hover:text-foreground"
        onClick={() => onDismiss(t.id)}
      >
        ✕
      </button>
    </div>
  );
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: Props) {
  return (
    // Always-mounted polite live region (screen readers need the region to
    // exist BEFORE content arrives to announce insertions).
    <div aria-live="polite" className="fixed bottom-5 left-1/2 flex max-w-[70%] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
