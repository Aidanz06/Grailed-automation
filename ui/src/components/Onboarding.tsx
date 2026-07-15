import { FolderOpen, Globe, MousePointerClick, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/*
 * First-run orientation (friend-beta Part A): a one-time welcome that shows
 * the 3-step path and the does/does-not trust contract (strategy §6 — the
 * "never submits" framing is the app's best trust asset, so it leads). Gated
 * on localStorage 'tailor.onboarded' in App; the header "?" reopens the same
 * content inside the Guide. The step list and contract panel are exported so
 * the Guide renders the identical copy — one source, no drift.
 */

export const ONBOARDED_KEY = 'tailor.onboarded';

const STEPS = [
  {
    icon: FolderOpen,
    title: 'Import a folder of item photos',
    body: 'Tailor groups the photos by item, then drafts titles, descriptions, prices from sold comps, and details for every piece.',
  },
  {
    icon: Globe,
    title: 'Launch Chrome and sign in to Grailed',
    body: 'The app opens its own Chrome window; signing in is always you — Tailor never touches your login.',
  },
  {
    icon: MousePointerClick,
    title: 'Open a draft, click Fill, then publish yourself',
    body: 'Fill types the draft into the Grailed Sell form. You review everything there and click Publish yourself — the app never submits.',
  },
];

export function HowItWorksSteps() {
  return (
    <ol className="space-y-3">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-sm text-primary">
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <s.icon className="h-3.5 w-3.5 text-primary" /> {s.title}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{s.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TrustContract() {
  return (
    <div className="rounded-lg border border-l-[3px] border-l-success bg-secondary/30 p-3.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-success">
        <ShieldCheck className="h-3.5 w-3.5" /> What Tailor does — and doesn’t
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium">Does</div>
          <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <li>· Organizes your photos into items</li>
            <li>· Drafts titles, descriptions, and tags</li>
            <li>· Pulls sold comparables to suggest a price</li>
            <li>· Fills the Grailed form — only when you click</li>
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium">Does not</div>
          <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <li>· Log in for you — signing in is always you</li>
            <li>· Submit or publish anything, ever</li>
            <li>· Bump, message, or send offers on its own</li>
            <li>· Touch your account while you’re away</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

interface Props {
  onImport: () => void;
  onClose: () => void;
}

export function Onboarding({ onImport, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="rise-in w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
        <div className="mb-1 flex items-start">
          <h2 className="font-display text-xl tracking-tight">
            How <span className="italic text-primary">Tailor</span> works
          </h2>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="close welcome">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">Three steps from a pile of photos to your first listing.</p>
        <div className="mb-4">
          <HowItWorksSteps />
        </div>
        <div className="mb-5">
          <TrustContract />
        </div>
        <Button className="glow-primary w-full" onClick={onImport}>
          Import your first batch
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          You can reopen this any time from the “?” button up top.
        </p>
      </div>
    </div>
  );
}
