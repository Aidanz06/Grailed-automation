import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

/*
 * Thin Radix Dialog primitives (M-1). Unlike stock shadcn, DialogContent does
 * NOT impose centering — each modal keeps its own position/box classes so the
 * migration is visually 1:1. The scrim is the standardized /50 (QW-8).
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/50', className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  // Radix conveys modality by aria-hiding the rest of the tree; the explicit
  // aria-modal is additive and spec-correct on role=dialog.
  <DialogPrimitive.Content ref={ref} aria-modal="true" className={cn('fixed z-50 focus:outline-none', className)} {...props} />
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export { Dialog, DialogTrigger, DialogPortal, DialogClose, DialogTitle, DialogDescription, DialogOverlay, DialogContent };
