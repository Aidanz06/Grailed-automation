import { useState, type ReactNode } from 'react';
import { BookOpenText, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/Modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HowItWorksSteps, TrustContract } from '@/components/Onboarding';
import { ShortcutRows } from '@/components/ShortcutHelp';
import { cn } from '@/lib/utils';

/*
 * In-app Guide (friend-beta Part G): the reopenable reference behind the "?"
 * button in both headers. Collapsible sections, plain language throughout.
 * The shortcut list is generated from lib/shortcuts.ts — the same table the
 * key handler reads — so the guide can never drift from the real bindings.
 * "How it works" and the trust contract are the exact Part A components.
 */

export type GuideSection = 'how' | 'screens' | 'shortcuts' | 'contract' | 'troubleshooting' | 'glossary';

const SCREENS: Array<{ name: string; body: string }> = [
  {
    name: 'Home',
    body: 'The overview: what needs your attention, drafts waiting to post, what’s live on Grailed, and past import batches (albums) you can hide when they’re done.',
  },
  {
    name: 'Import',
    body: 'Pick a folder of photos. Tailor groups them by item and turns confident groups into priced drafts; anything uncertain goes to Review instead of guessing.',
  },
  {
    name: 'Review',
    body: 'Photo groups the import wasn’t sure about. Confirm “these are one item”, split photos out, or move them onto another item.',
  },
  {
    name: 'Draft editor',
    body: 'One listing: photos, title, description, details, and price with the sold comps behind it. The checklist on the right shows exactly what’s left; click a row to jump to it.',
  },
  {
    name: 'Confirm drafts',
    body: 'One card per draft that still needs something: the six fields you know instantly (brand, category, size, condition, price, floor) up top, the AI’s text below to glance over, and J/K to walk the queue. Drafts that are already complete are skipped.',
  },
  {
    name: 'Fill + Chrome',
    body: 'Launch Chrome from the app, sign in to Grailed yourself, open a Sell form, then click Fill on a draft. Tailor types the listing in; you review and click Publish yourself.',
  },
];

const TROUBLESHOOTING: Array<{ q: string; a: string }> = [
  {
    q: 'Chrome shows “not connected”',
    a: 'Click Launch Chrome (on Home or next to the status chip). Sign in to Grailed in that window if asked — signing in is always you.',
  },
  {
    q: 'A field didn’t fill',
    a: 'Set it directly in the Chrome form — the fill card in the editor lists exactly which fields went in and why one didn’t.',
  },
  {
    q: 'The price shows no confidence',
    a: 'Click Recompute on the price card — it refreshes the sold comparables and adds a confidence rating.',
  },
  {
    q: 'Pricing and Fill are paused',
    a: 'That’s the safety pause: something looked off with the Grailed account, so the app stopped touching it. Nothing was submitted. Contact whoever set this up.',
  },
  {
    q: 'Nothing works on my first import',
    a: 'This copy is probably missing its API key — a banner at the top will say so. Reach out to whoever shared the app with you.',
  },
];

const GLOSSARY: Array<{ term: string; def: string }> = [
  { term: 'draft', def: 'A listing Tailor wrote that hasn’t been posted yet — yours to edit.' },
  { term: 'needs review', def: 'A photo group the import wasn’t sure about; confirm or fix it on the Review screen.' },
  { term: 'listed', def: 'You told Tailor you published it on Grailed, so it moved to the listed shelf.' },
  { term: 'ready', def: 'Every required field is set — this draft can be filled whenever you want.' },
  { term: 'needs attention', def: 'At least one required field is still missing; the chip names the next one.' },
];

function Section({
  id,
  title,
  openId,
  setOpenId,
  children,
}: {
  id: GuideSection;
  title: string;
  openId: GuideSection | null;
  setOpenId: (s: GuideSection | null) => void;
  children: ReactNode;
}) {
  const open = openId === id;
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-secondary/50',
          open && 'rounded-b-none border-b'
        )}
        onClick={() => setOpenId(open ? null : id)}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        {title}
      </button>
      {open && <div className="p-3.5">{children}</div>}
    </section>
  );
}

interface Props {
  open: boolean;
  initialSection?: GuideSection;
  onClose: () => void;
}

export function GuideMenu({ open, initialSection = 'how', onClose }: Props) {
  const [openId, setOpenId] = useState<GuideSection | null>(initialSection);
  if (!open) return null;
  return (
    // U6: deliberately X-button-only — no backdrop/Escape close until the
    // owner opts in (Modal defaults are already off).
    <Modal
      title="Guide"
      onClose={onClose}
      className="rise-in left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card shadow-xl"
    >
        <div className="flex items-center gap-2 border-b px-5 py-3.5">
          <BookOpenText className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Guide</h2>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="close guide">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-5">
            <Section id="how" title="How it works" openId={openId} setOpenId={setOpenId}>
              <HowItWorksSteps />
            </Section>
            <Section id="screens" title="What each screen does" openId={openId} setOpenId={setOpenId}>
              <ul className="space-y-2.5">
                {SCREENS.map((s) => (
                  <li key={s.name}>
                    <span className="block text-sm- font-medium">{s.name}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{s.body}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section id="shortcuts" title="Keyboard shortcuts" openId={openId} setOpenId={setOpenId}>
              {/* Generated from lib/shortcuts.ts — always matches the bindings. */}
              <ShortcutRows />
            </Section>
            <Section id="contract" title="What Tailor does — and doesn’t" openId={openId} setOpenId={setOpenId}>
              <TrustContract />
            </Section>
            <Section id="troubleshooting" title="Troubleshooting" openId={openId} setOpenId={setOpenId}>
              <ul className="space-y-2.5">
                {TROUBLESHOOTING.map((t) => (
                  <li key={t.q}>
                    <span className="block text-sm- font-medium">{t.q}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{t.a}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section id="glossary" title="Glossary" openId={openId} setOpenId={setOpenId}>
              <ul className="space-y-1.5">
                {GLOSSARY.map((g) => (
                  <li key={g.term} className="text-xs leading-relaxed">
                    <span className="font-medium">{g.term}</span>
                    <span className="text-muted-foreground"> — {g.def}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </ScrollArea>
    </Modal>
  );
}
