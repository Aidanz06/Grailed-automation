import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, Unplug } from 'lucide-react';
import { api, type ChromeStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn, errorMessage } from '@/lib/utils';

/* Chrome precondition chip (audit §3.2): makes the launched Chrome's state
 * glanceable in the workspace header. Fed by the read-only status probe
 * (HTTP /json/list only — the probe never touches the page), polled every 4s
 * while this chip is mounted (workspace only — it unmounts elsewhere). It
 * shares the same launched Chrome as Fill and Dock, so it also answers "will
 * those work?" implicitly. When nothing is connected the chip grows a
 * "Launch Chrome" action (chrome:launch — spawn only, sign-in stays manual);
 * the same 4s poll then walks the chip through the state change. */

const POLL_MS = 4000;

/** Polled Chrome status (read-only probe, 4s while mounted). Shared by this
 * chip and the Home ChromeNotifier — they mount on different screens, so only
 * one poll runs at a time. Null until the first probe answers. */
export function useChromeStatus(): ChromeStatus | null {
  const [status, setStatus] = useState<ChromeStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .getChromeStatus()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {
          /* probe never throws by design; an IPC hiccup keeps the last state */
        });
    check();
    const t = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return status;
}

/** In-app Chrome launcher button state (chrome:launch — spawn only, no-op if
 * already up; sign-in stays manual, PRD §8.2). Result copy lands in `toast`. */
export function useLaunchChrome(toast?: (msg: string) => void) {
  const [launching, setLaunching] = useState(false);
  const launchChrome = () => {
    setLaunching(true);
    api
      .launchChrome()
      .then((r) => toast?.(r.message))
      .catch((err) => toast?.(`Couldn’t launch Chrome: ${errorMessage(err)}`))
      .finally(() => setLaunching(false));
  };
  return { launching, launchChrome };
}

/** Open-a-Sell-form-tab button state (chrome:openSellTab — creates a NEW tab
 * via the DevTools HTTP endpoint; never navigates an existing one). The
 * status poll picks up the new tab within one cycle. */
export function useOpenSellTab(toast?: (msg: string) => void) {
  const [opening, setOpening] = useState(false);
  const openSellTab = () => {
    setOpening(true);
    api
      .openSellTab()
      .then((r) => toast?.(r.message))
      .catch((err) => toast?.(`Couldn’t open the tab: ${errorMessage(err)}`))
      .finally(() => setOpening(false));
  };
  return { opening, openSellTab };
}

export function ChromeStatusChip({ toast }: { toast?: (msg: string) => void }) {
  const status = useChromeStatus();
  const { launching, launchChrome } = useLaunchChrome(toast);

  if (!status) return null; // first probe still in flight

  const state = !status.connected
    ? {
        cls: 'border-input bg-secondary/60 text-muted-foreground',
        icon: <Unplug className="h-3.5 w-3.5" />,
        label: 'Chrome not connected',
        tip: 'No app-connected Chrome is running — Launch Chrome starts one (you still sign in to Grailed yourself).',
      }
    : !status.ready
      ? {
          cls: 'border-transparent bg-warning/15 text-warning',
          icon: <AlertTriangle className="h-3.5 w-3.5" />,
          label: status.loggedIn === false ? 'Sign in to Grailed' : 'Open a Sell form',
          tip:
            status.loggedIn === false
              ? 'That Chrome is on a Grailed login page — sign in there first (always manual).'
              : 'Point that Chrome at grailed.com/sell/new so Fill has a fresh form.',
        }
      : {
          cls: 'border-transparent bg-success/15 text-success',
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          label: 'Chrome ready',
          tip: 'A fresh Sell form is open in the launched Chrome — Fill and Dock will target it.',
        };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        title={state.tip}
        className={cn(
          'inline-flex cursor-default items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
          state.cls
        )}
      >
        {state.icon}
        {state.label}
      </span>
      {!status.connected && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={launching}
          onClick={launchChrome}
          title="Starts the dedicated Chrome the app fills into. You sign in to Grailed there yourself, then open grailed.com/sell/new."
        >
          <Play className="h-3.5 w-3.5" />
          {launching ? 'Launching…' : 'Launch Chrome'}
        </Button>
      )}
    </span>
  );
}
