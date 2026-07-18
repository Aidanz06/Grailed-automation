import { SHORTCUTS } from '@/lib/shortcuts';

/*
 * The shortcut list, generated from lib/shortcuts.ts — the single source of
 * truth the key handler also reads, so docs can't drift from bindings (R3 +
 * beta Part G). Rendered inside the Guide's "Keyboard shortcuts" section.
 */

export function ShortcutRows() {
  return (
    <ul className="space-y-2">
      {SHORTCUTS.map((s) => (
        <li key={s.id} className="flex items-start gap-3">
          <span className="flex w-24 shrink-0 flex-wrap gap-1">
            {s.keys.map((k) => (
              <kbd
                key={k}
                className="rounded border bg-secondary/60 px-1.5 py-0.5 font-mono text-2xs leading-none text-foreground"
              >
                {k}
              </kbd>
            ))}
          </span>
          <span className="min-w-0">
            <span className="block text-sm- font-medium leading-tight">{s.label}</span>
            <span className="block text-xs text-muted-foreground">{s.description}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
