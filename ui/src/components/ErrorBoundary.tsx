import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/*
 * Error boundary (M-5) — class component because boundaries can't be hooks.
 * Without one, any uncaught render error unmounts the whole tree, and the
 * packaged app has NO visible console (lib/utils.ts documents this), so the
 * seller would see a dead white window. The fallback keeps the surrounding
 * chrome alive, shows the REAL error text (the app's "every failure carries
 * its message" rule), and offers Copy / remount / Home.
 */

interface Props {
  children: ReactNode;
  /** Escape hatch — renders a "Back to Home" button when provided. */
  onBackHome?: () => void;
  /** When this changes (e.g. selected draft), a stuck error state clears so
   * navigating away from the broken screen recovers by itself. */
  resetKey?: string | number;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
  /** Bumped by "Reload this screen" — remounts the subtree via key. */
  mountKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false, mountKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Dev console must still see the full error even though the UI catches it.
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  private reset = () => {
    this.setState((s) => ({ error: null, componentStack: null, copied: false, mountKey: s.mountKey + 1 }));
  };

  private copy = () => {
    const { error, componentStack } = this.state;
    const text = `${String(error)}\n${error?.stack ?? ''}\n${componentStack ?? ''}`.trim();
    const done = () => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1500);
    };
    // execCommand fallback: the async clipboard rejects when the window isn't
    // focused (e.g. clicking Copy right after switching from Chrome).
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) done();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(legacy);
    else legacy();
  };

  render() {
    const { error, componentStack, copied, mountKey } = this.state;
    if (!error) return <Fragment key={mountKey}>{this.props.children}</Fragment>;
    // First app frame of the component stack, so "where" survives minification
    // at least as a component name.
    const where = componentStack?.split('\n').find((l) => l.trim());
    return (
      <div className="flex h-full min-h-[280px] flex-1 items-center justify-center p-6">
        <div className="max-w-[440px] rounded-lg border border-l-[3px] border-l-destructive bg-card px-5 py-4">
          <h3 className="mb-1.5 text-sm font-medium">This screen hit an error</h3>
          <p className="mb-2.5 text-xs text-muted-foreground">
            Your drafts are safe — they're saved in the app's database as you type (an edit from the last second or two may
            need retyping). Nothing was sent to Grailed.
          </p>
          <pre className="mb-3 max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-secondary px-2.5 py-2 font-mono text-2xs text-destructive">
            {String(error)}
            {where ? `\n${where.trim()}` : ''}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={this.reset}>
              Reload this screen
            </Button>
            <Button size="sm" variant="outline" onClick={this.copy}>
              {copied ? 'Copied' : 'Copy error'}
            </Button>
            {this.props.onBackHome && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  this.reset();
                  this.props.onBackHome?.();
                }}
              >
                Back to Home
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
