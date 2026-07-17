import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Human-readable date for stored timestamps. Real items store full ISO strings
 * (e.g. "2026-07-03T17:20:04.174Z"); mock/legacy values may be date-only
 * ("2026-06-25"). Date-only is parsed as local midnight to avoid a TZ off-by-one.
 */
export function formatWhen(value?: string | null): string {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? value + 'T00:00:00' : value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(
    undefined,
    dateOnly
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  );
}

/** Relative "time ago" for the save indicator. */
export function agoLabel(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

/**
 * The user-facing message from a (possibly IPC-wrapped) error. The packaged
 * app has no console, so every failure toast must carry the real message —
 * "see console" is a dead end (UX review Q2). Strips Electron's
 * "Error invoking remote handler…" wrapper so the actionable text shows.
 */
export function errorMessage(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(
    /^Error invoking remote handler on channel '[^']*': (?:Error: )?/,
    ''
  );
}

/** First segment of a collab brand string ("Supreme x Comme des Garçons" →
 * "Supreme"). Grailed's designer list has NO collab entries (verified live),
 * so the fill always sends the primary label — this mirrors the twin
 * normalization in ui/main.js buildFillPayload. Splits ONLY on "x"/"×" with
 * whitespace around it, so "Dolce & Gabbana" and hyphenated brands survive. */
export function primaryBrand(raw: string | null | undefined): string {
  return String(raw ?? '').split(/\s+[x×]\s+/i)[0].trim();
}

/** True when a brand string is a collab the designer field can't take as-is. */
export function isCollabBrand(raw: string | null | undefined): boolean {
  return /\s+[x×]\s+/i.test(String(raw ?? ''));
}
