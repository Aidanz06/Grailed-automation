import { AlertTriangle, CheckCircle2, ExternalLink, Play, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useChromeStatus, useLaunchChrome, useOpenSellTab } from '@/components/ChromeStatusChip';

/* Home-screen Chrome notifier: the same read-only probe as the workspace
 * header chip (shared useChromeStatus — 4s poll while mounted; the two never
 * mount together), rendered as a full-width status row so a new user sees the
 * fill-browser precondition before opening any draft. When nothing is
 * connected it carries the in-app launcher (chrome:launch — spawn only; the
 * user signs in to Grailed themselves and opens the Sell form, PRD §8.2). */

export function ChromeNotifier({ toast }: { toast?: (msg: string) => void }) {
  const status = useChromeStatus();
  const { launching, launchChrome } = useLaunchChrome(toast);
  const { opening, openSellTab } = useOpenSellTab(toast);

  if (!status) return null; // first probe still in flight

  const state = !status.connected
    ? {
        cls: 'border-input bg-card',
        icon: <Unplug className="h-4 w-4 shrink-0 text-muted-foreground" />,
        label: 'Chrome isn’t running',
        desc: 'Filling listings happens in the app’s own Chrome window. Launch it here — you sign in to Grailed yourself.',
      }
    : status.loggedIn === false
      ? {
          cls: 'border-warning/50 bg-warning/10',
          icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />,
          label: 'Sign in to Grailed',
          desc: 'That Chrome is on a Grailed login page — sign in there yourself (always manual), then open grailed.com/sell/new.',
        }
      : !status.ready
        ? {
            cls: 'border-warning/40 bg-warning/5',
            icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />,
            label: 'Chrome connected — open a Sell form',
            desc: 'Fill needs a fresh grailed.com/sell/new tab to type into. Open one here or in that Chrome window.',
          }
        : {
            cls: 'border-success/30 bg-success/10',
            icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />,
            label: 'Chrome ready',
            desc: 'A fresh Sell form is open — Fill and Dock will target it.',
          };

  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-3', state.cls)}>
      {state.icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{state.label}</div>
        <div className="text-xs text-muted-foreground">{state.desc}</div>
      </div>
      {!status.connected && (
        <Button
          size="sm"
          className="shrink-0"
          disabled={launching}
          onClick={launchChrome}
          title="Starts the dedicated Chrome the app fills into. You sign in to Grailed there yourself, then open grailed.com/sell/new."
        >
          <Play className="h-3.5 w-3.5" />
          {launching ? 'Launching…' : 'Launch Chrome'}
        </Button>
      )}
      {status.connected && status.loggedIn !== false && !status.ready && (
        <Button
          size="sm"
          className="shrink-0"
          disabled={opening}
          onClick={openSellTab}
          title="Opens a new grailed.com/sell/new tab in the launched Chrome. Your other tabs are untouched; if Grailed asks you to sign in there, that stays manual."
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {opening ? 'Opening…' : 'Open Sell form'}
        </Button>
      )}
    </div>
  );
}
