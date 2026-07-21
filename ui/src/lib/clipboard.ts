/*
 * Clipboard with an honest fallback chain (UX audit #18): async clipboard →
 * execCommand textarea (extracted from ErrorBoundary.copy — the async API
 * rejects when the window isn't focused, e.g. clicking Copy right after
 * switching from Chrome). Resolves false instead of throwing, and NEVER
 * "logs to console" as a fallback — the packaged app has no console
 * (lib/utils.ts documents this); callers show the manual-copy modal instead.
 */

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to execCommand */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}
