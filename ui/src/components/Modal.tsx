import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';

/*
 * Shared modal wrapper (M-1): dialog role + aria-modal, focus trap, focus
 * restore, scrim, Escape — the semantics every hand-rolled backdrop lacked.
 * Radix-based (battle-tested trap; Radix Select portals inside stay operable
 * through the shared dismissable-layer stack).
 *
 * Close affordances are PER-MODAL props because the shipped modals genuinely
 * differ (manifest R8 table) — both default OFF so a migration can only add
 * an affordance deliberately: StyleEditor/DefaultsMenu close on backdrop,
 * GuideMenu/Onboarding are X-button-only (U6 keeps it that way), the Updater
 * must be un-closeable while an update is applying.
 *
 * Callers keep their `{open && <Modal…>}` conditional-render pattern — the
 * Dialog root is always "open"; closing goes through onClose.
 */

interface Props {
  /** Accessible name for the dialog (rendered as an sr-only title). */
  title: string;
  onClose: () => void;
  /** Clicking the scrim closes (R8: StyleEditor, DefaultsMenu, CommandPalette). */
  closeOnBackdrop?: boolean;
  /** Escape closes (QW-8 adds this where the R8 table allows). */
  closeOnEscape?: boolean;
  /** Position + box classes for the content — kept verbatim per modal. */
  className?: string;
  /** Intercept Escape before the close decision (e.g. StyleEditor's
   * cancel-rename-first). Return true to consume the keypress. */
  onEscapeCapture?: () => boolean;
  onOpenAutoFocus?: ComponentProps<typeof DialogContent>['onOpenAutoFocus'];
  children: ReactNode;
}

export function Modal({
  title,
  onClose,
  closeOnBackdrop = false,
  closeOnEscape = false,
  className,
  onEscapeCapture,
  onOpenAutoFocus,
  children,
}: Props) {
  // Focus restore: callers unmount the whole Dialog root (`{open && …}`), an
  // exit too abrupt for Radix's own restore — so capture the opener during
  // the FIRST render (before Radix's autofocus effect moves focus into the
  // trap) and put focus back on unmount.
  const [restoreTo] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(
    () => () => {
      restoreTo?.focus?.();
    },
    [restoreTo]
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          aria-describedby={undefined}
          className={className}
          onOpenAutoFocus={onOpenAutoFocus}
          onEscapeKeyDown={(e) => {
            if (onEscapeCapture?.()) return e.preventDefault();
            if (!closeOnEscape) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!closeOnBackdrop) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!closeOnBackdrop) e.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {children}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
