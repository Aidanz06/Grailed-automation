import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import { api, type UpdateProgress, type UpdateStep } from '@/lib/api';
import { cn, errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/*
 * In-app one-click updater (renderer half). The main process does the real
 * work (ui/updater.js: git pull --ff-only → npm install → ui:build →
 * relaunch); this file is the banner, the "Check for updates" action, and the
 * step-by-step progress modal. Hidden entirely when update:check reports
 * supported:false (not a git clone).
 */

const STEP_ORDER: UpdateStep[] = ['download', 'install', 'build', 'restart'];
const STEP_LABEL: Record<UpdateStep, string> = {
  download: 'Downloading',
  install: 'Installing',
  build: 'Building',
  restart: 'Restarting',
};

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

interface UpdateError {
  step: UpdateStep | null;
  message: string;
  output: string[];
  cancelled: boolean;
}

export interface Updater {
  /** false until update:check confirms this is a git clone — hide all UI. */
  supported: boolean;
  updateAvailable: boolean;
  behind: number;
  checking: boolean;
  bannerDismissed: boolean;
  dismissBanner: () => void;
  /** Manual "Check for updates" — always toasts the outcome. */
  checkNow: () => void;
  /** Start the update (opens the modal). */
  apply: () => void;
  modal: {
    open: boolean;
    close: () => void;
    applying: boolean;
    steps: Record<UpdateStep, StepStatus>;
    lines: string[];
    error: UpdateError | null;
    buildStarted: boolean;
    cancel: () => void;
  };
}

const FRESH_STEPS: Record<UpdateStep, StepStatus> = { download: 'pending', install: 'pending', build: 'pending', restart: 'pending' };

/**
 * Owns all updater state. `isBusy` reports whether an import or fill is
 * running right now — main refuses to rebuild under a live job.
 */
export function useUpdater(toast: (msg: string) => void, isBusy: () => boolean): Updater {
  const [supported, setSupported] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [behind, setBehind] = useState(0);
  const [checking, setChecking] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [steps, setSteps] = useState<Record<UpdateStep, StepStatus>>({ ...FRESH_STEPS });
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<UpdateError | null>(null);
  const buildStarted = steps.build !== 'pending';

  // Live step stream (main sends update:progress while applying).
  useEffect(() => {
    return api.onUpdateProgress((p: UpdateProgress) => {
      if (p.status === 'start') {
        setSteps((s) => ({ ...s, [p.step]: 'running' }));
        if (p.label) setLines((l) => [...l.slice(-5), p.label!]);
      } else if (p.status === 'done') {
        setSteps((s) => ({ ...s, [p.step]: 'done' }));
      } else if (p.status === 'failed') {
        setSteps((s) => ({ ...s, [p.step]: 'failed' }));
      } else if (p.status === 'output' && p.line) {
        setLines((l) => [...l.slice(-5), p.line!]);
      }
    });
  }, []);

  const runCheck = useCallback(
    (quiet: boolean) => {
      setChecking(true);
      api
        .checkForUpdate()
        .then((r) => {
          setSupported(r.supported);
          if (!r.supported) return;
          setUpdateAvailable(!!r.updateAvailable);
          setBehind(r.behind ?? 0);
          if (r.updateAvailable) setBannerDismissed(false);
          if (!quiet) {
            if (r.error) toast(`Couldn’t check for updates: ${r.error}`);
            else if (r.updateAvailable) toast(`A new version is available (${r.behind} update${(r.behind ?? 0) === 1 ? '' : 's'} behind).`);
            else toast('You’re up to date.');
          }
        })
        .catch((err) => {
          // Never crash the app over an update check.
          if (!quiet) toast(`Couldn’t check for updates: ${errorMessage(err)}`);
        })
        .finally(() => setChecking(false));
    },
    [toast]
  );

  // One quiet check on launch — the banner appears only if something's there.
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    runCheck(true);
  }, [runCheck]);

  const apply = useCallback(() => {
    if (isBusy()) {
      toast('Finish the import or fill that’s running first, then update.');
      return;
    }
    setSteps({ ...FRESH_STEPS });
    setLines([]);
    setError(null);
    setOpen(true);
    setApplying(true);
    api
      .applyUpdate({ busy: isBusy() })
      .then((res) => {
        if (res.ok) {
          // Main relaunches in ~1s; leave the modal on "Restarting…".
          setSteps((s) => ({ ...s, restart: 'running' }));
          return;
        }
        setError({
          step: res.failedStep ?? null,
          message: res.message || 'The update failed for an unknown reason.',
          output: res.output || [],
          cancelled: !!res.cancelled,
        });
      })
      .catch((err) => {
        setError({ step: null, message: errorMessage(err), output: [], cancelled: false });
      })
      .finally(() => setApplying(false));
  }, [isBusy, toast]);

  const cancel = useCallback(() => {
    api
      .cancelUpdate()
      .then((r) => {
        if (!r.ok && r.message) toast(r.message);
      })
      .catch(() => {});
  }, [toast]);

  return {
    supported,
    updateAvailable,
    behind,
    checking,
    bannerDismissed,
    dismissBanner: () => setBannerDismissed(true),
    checkNow: () => runCheck(false),
    apply,
    modal: { open, close: () => setOpen(false), applying, steps, lines, error, buildStarted, cancel },
  };
}

/** Small non-intrusive strip shown when a newer version exists. */
export function UpdateBanner({ u }: { u: Updater }) {
  if (!u.supported || !u.updateAvailable || u.bannerDismissed || u.modal.open) return null;
  return (
    <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-6 py-2 text-sm">
      <ArrowDownToLine className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        A new version of Tailor is available
        {u.behind > 1 ? ` (${u.behind} updates behind)` : ''}.
      </span>
      <Button size="sm" onClick={u.apply}>
        Update &amp; restart
      </Button>
      <button type="button" aria-label="dismiss update banner" className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={u.dismissBanner}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Header entry: manual "Check for updates". Hidden when unsupported. */
export function CheckUpdatesButton({ u }: { u: Updater }) {
  if (!u.supported) return null;
  return (
    <Button variant="ghost" size="sm" title="Check whether a newer version of Tailor is available" disabled={u.checking} onClick={u.checkNow}>
      <RefreshCw className={u.checking ? 'animate-spin' : ''} />
      {u.checking ? 'Checking…' : 'Check for updates'}
    </Button>
  );
}

function StepRow({ step, status }: { step: UpdateStep; status: StepStatus }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {status === 'done' ? (
        <Check className="h-4 w-4 text-success" />
      ) : status === 'running' ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : status === 'failed' ? (
        <AlertTriangle className="h-4 w-4 text-destructive" />
      ) : (
        <span className="inline-block h-4 w-4 rounded-full border border-muted-foreground/30" />
      )}
      <span className={cn(status === 'pending' && 'text-muted-foreground', status === 'failed' && 'text-destructive')}>
        {STEP_LABEL[step]}
      </span>
    </li>
  );
}

/** The progress modal. Rendered at App root so navigation can't lose it. */
export function UpdateModal({ u, toast }: { u: Updater; toast: (msg: string) => void }) {
  const m = u.modal;
  if (!m.open) return null;
  const err = m.error;
  const finished = !m.applying && (err || m.steps.restart === 'running');

  const copyDetails = () => {
    const text = [
      `Tailor update failed at step: ${err?.step ?? 'unknown'}`,
      `Message: ${err?.message ?? ''}`,
      '',
      'Output tail:',
      ...(err?.output ?? []),
    ].join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast('Details copied — send them to the owner.'))
        .catch(() => {
          console.log('[update] failure details:\n' + text);
          toast('Clipboard blocked — details logged to the console.');
        });
    } else {
      console.log('[update] failure details:\n' + text);
      toast('Details logged to the console.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" role="dialog" aria-modal="true" aria-label="Updating Tailor">
      <div className="w-full max-w-md rounded-xl border bg-card p-5 shadow-xl">
        <div className="mb-3 text-base font-semibold">
          {err ? (err.cancelled ? 'Update cancelled' : 'Update failed') : 'Updating Tailor'}
        </div>

        {!err && (
          <>
            <ol className="space-y-2">
              {STEP_ORDER.map((s) => (
                <StepRow key={s} step={s} status={m.steps[s]} />
              ))}
            </ol>
            {m.lines.length > 0 && (
              <div className="mt-3 max-h-24 overflow-hidden rounded-md bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {m.lines.map((l, i) => (
                  <div key={i} className="truncate">
                    {l}
                  </div>
                ))}
              </div>
            )}
            {m.steps.restart === 'running' && (
              <p className="mt-3 text-sm text-muted-foreground">Done — the app restarts by itself in a moment.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={m.buildStarted || !m.applying}
                title={m.buildStarted ? 'The build has started — let it finish; the app restarts right after.' : 'Stop the update (nothing is rebuilt yet)'}
                onClick={m.cancel}
              >
                Cancel
              </Button>
            </div>
          </>
        )}

        {err && (
          <>
            {err.step && !err.cancelled && (
              <div className="mb-1 text-sm font-medium text-destructive">Failed while {STEP_LABEL[err.step].toLowerCase()}</div>
            )}
            <p className="text-sm">{err.message}</p>
            {err.output.length > 0 && (
              <div className="mt-2 max-h-32 overflow-y-auto rounded-md bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {err.output.slice(-12).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Your listings, settings, and keys are untouched — the app keeps running the current version.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              {!err.cancelled && (
                <Button variant="outline" size="sm" onClick={copyDetails}>
                  <Copy /> Copy details
                </Button>
              )}
              <Button size="sm" onClick={m.close}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
