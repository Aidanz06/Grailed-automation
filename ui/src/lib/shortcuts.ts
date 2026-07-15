/*
 * Keyboard shortcuts — SINGLE source of truth (UX streamlining R3 + beta
 * readiness Part G). The workspace key handler AND the in-app guide both read
 * this table, so the documented keys can never drift from the real bindings.
 *
 * Rules of the road:
 * - Shortcuts assist navigation/fill only — fill remains one manual keypress
 *   per item (F is exactly the Fill button), and nothing here submits.
 * - Plain-letter shortcuts never fire while the user is typing in a field;
 *   only shortcuts marked `worksInInputs` (modifier chords) do.
 */

export type ShortcutId = 'nextDraft' | 'prevDraft' | 'saveAndNext' | 'fill' | 'help' | 'palette';

export interface Shortcut {
  id: ShortcutId;
  /** Display keys for the guide, e.g. ['J', '↓']. */
  keys: string[];
  label: string;
  /** Plain-language description for the guide (no jargon). */
  description: string;
  /** Fires even while focus is in a text field (modifier chords only). */
  worksInInputs?: boolean;
  /** Does this event match the binding? Keep ALL matching logic here. */
  match: (e: KeyboardEvent) => boolean;
}

const noMods = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey;

/** Cmd on macOS, Ctrl elsewhere — displayed as one key in the guide. */
export const MOD_LABEL = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'nextDraft',
    keys: ['J', '↓'],
    label: 'Next draft',
    description: 'Jump to the next draft in the sidebar without touching the mouse.',
    match: (e) => noMods(e) && !e.shiftKey && (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown'),
  },
  {
    id: 'prevDraft',
    keys: ['K', '↑'],
    label: 'Previous draft',
    description: 'Jump back to the draft above.',
    match: (e) => noMods(e) && !e.shiftKey && (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp'),
  },
  {
    id: 'saveAndNext',
    keys: [`${MOD_LABEL} Enter`],
    label: 'Save & next draft',
    description: 'Save the draft you’re editing and move straight to the next one — works while typing.',
    worksInInputs: true,
    match: (e) => (e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Enter',
  },
  {
    id: 'fill',
    keys: ['F'],
    label: 'Fill this draft in Chrome',
    description:
      'Same as clicking the Fill button — only proceeds when Chrome is ready on a fresh Sell form, and never submits.',
    match: (e) => noMods(e) && !e.shiftKey && (e.key === 'f' || e.key === 'F'),
  },
  {
    id: 'help',
    keys: ['?'],
    label: 'Open the guide',
    description: 'Open the how-it-works guide (including this shortcut list).',
    match: (e) => noMods(e) && e.key === '?',
  },
  {
    id: 'palette',
    keys: [`${MOD_LABEL} K`],
    label: 'Command palette',
    description: 'Search your drafts and jump anywhere — works from every screen, even mid-typing.',
    worksInInputs: true,
    match: (e) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K'),
  },
];

/**
 * True when the keystroke belongs to whatever the user is focused on —
 * typing in a field, or operating a dropdown/menu with arrow keys — so plain
 * shortcuts must stay out of the way. Modifier chords (worksInInputs) skip
 * the text-field part but still respect open menus via the caller.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

/** Interactive widgets where arrows/letters have their own meaning (Radix
 * selects render as combobox/listbox buttons). */
export function isWidgetTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest('[role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"], button');
}

/**
 * Resolve a keydown to a shortcut id, or null when it should be ignored
 * (typing in a field, or focused on a widget that owns the key). This is the
 * one gate both the handler and any future surface must go through.
 */
export function matchShortcut(e: KeyboardEvent): ShortcutId | null {
  const typing = isTypingTarget(e.target);
  const widget = isWidgetTarget(e.target);
  for (const s of SHORTCUTS) {
    if (!s.match(e)) continue;
    if (typing && !s.worksInInputs) return null; // never disrupt typing
    if (widget && !s.worksInInputs) return null; // arrows/letters belong to the widget
    return s.id;
  }
  return null;
}
