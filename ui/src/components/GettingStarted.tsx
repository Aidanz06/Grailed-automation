import { ExternalLink, Play } from 'lucide-react';
import type { Item } from '@/types';
import { Button } from '@/components/ui/button';
import { AnimatedCheck, PendingDot } from '@/components/motion';
import { useChromeStatus, useLaunchChrome, useOpenSellTab } from '@/components/ChromeStatusChip';
import { cn } from '@/lib/utils';

/*
 * Home "Get started" checklist (friend-beta Part B): a LIVE do-this-next path
 * for a brand-new seller, driven by real state — it ticks itself off. Step 2
 * folds the Chrome notifier's status + actions in (same useChromeStatus poll,
 * same launch/open-Sell-form hooks — never duplicated copy). Home hides this
 * once anything is listed and shows the plain ChromeNotifier instead.
 */

interface Props {
  items: Item[];
  onNewBatch: () => void;
  /** Open the first draft (step 3's action). */
  onOpenDraft: ((id: number) => void) | null;
  firstDraftId: number | null;
  toast?: (msg: string) => void;
}

export function GettingStarted({ items, onNewBatch, onOpenDraft, firstDraftId, toast }: Props) {
  const status = useChromeStatus();
  const { launching, launchChrome } = useLaunchChrome(toast);
  const { opening, openSellTab } = useOpenSellTab(toast);

  const imported = items.length > 0;
  const chromeReady = !!status?.ready;
  const filled = items.some((it) => it.status === 'submitted');

  const chromeSub = !status
    ? 'checking Chrome…'
    : !status.connected
      ? 'Filling happens in the app’s own Chrome window — launch it, then sign in to Grailed yourself.'
      : status.loggedIn === false
        ? 'That Chrome is on a Grailed login page — sign in there yourself (always manual).'
        : !status.ready
          ? 'Signed-in Chrome is up — open a Sell form so Fill has somewhere to type.'
          : 'Chrome is ready on a fresh Sell form.';

  const steps = [
    {
      done: imported,
      title: 'Import a batch of photos',
      sub: imported
        ? `${items.length} item${items.length === 1 ? '' : 's'} in the app`
        : 'Point Tailor at a folder of item photos — it drafts titles, prices, and details for every piece.',
      action: !imported && (
        <Button size="sm" className="shrink-0" onClick={onNewBatch}>
          Import photos
        </Button>
      ),
    },
    {
      done: chromeReady,
      title: 'Connect Chrome & sign in to Grailed',
      sub: chromeSub,
      action:
        status && !status.connected ? (
          <Button size="sm" className="shrink-0" disabled={launching} onClick={launchChrome}>
            <Play className="h-3.5 w-3.5" />
            {launching ? 'Launching…' : 'Launch Chrome'}
          </Button>
        ) : status && status.connected && status.loggedIn !== false && !status.ready ? (
          <Button size="sm" className="shrink-0" disabled={opening} onClick={openSellTab}>
            <ExternalLink className="h-3.5 w-3.5" />
            {opening ? 'Opening…' : 'Open Sell form'}
          </Button>
        ) : null,
    },
    {
      done: filled,
      title: 'Open a draft and Fill it',
      sub: filled
        ? 'First listing done — you’re rolling.'
        : 'Fill types the draft into the Sell form; you review and click Publish yourself. The app never submits.',
      action: !filled && firstDraftId != null && onOpenDraft && (
        <Button size="sm" className="shrink-0" onClick={() => onOpenDraft(firstDraftId)}>
          Open first draft
        </Button>
      ),
    },
  ];

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Get started</h2>
      <ul className="space-y-3">
        {steps.map((s) => (
          <li key={s.title} className="flex items-center gap-3">
            {s.done ? <AnimatedCheck /> : <PendingDot />}
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-medium', s.done && 'text-muted-foreground line-through decoration-success/60')}>
                {s.title}
              </div>
              <div className="text-xs text-muted-foreground">{s.sub}</div>
            </div>
            {s.action}
          </li>
        ))}
      </ul>
    </section>
  );
}
