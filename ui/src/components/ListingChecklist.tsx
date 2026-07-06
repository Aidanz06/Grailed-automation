import type { Item } from '@/types';
import { suggestGrailedCategory } from '@/lib/grailedCategory';
import { AnimatedCheck, PendingDot, ProgressBar } from '@/components/motion';

// Right-rail readiness checklist (UI redesign 2026-07-04): every row is
// computed from the item itself and clicking a row scrolls to the section
// that fixes it. Required rows drive the n/N counter; tagged rows (verify /
// optional) inform without inflating the count. This is guidance only — it
// gates nothing, and the final review + publish always happens manually in
// Chrome.

type RowState = 'done' | 'warn' | 'todo';
interface Row {
  key: string;
  label: string;
  state: RowState;
  sub: string;
  required: boolean;
  tag?: string; // small chip next to the label ('verify' / 'optional')
  jumpTo: string; // DOM id of the section that edits this
}

function buildRows(item: Item): Row[] {
  const attrs = item.attributes;
  const title = item.content?.title?.trim() ?? '';
  const desc = item.content?.description?.trim() ?? '';
  const confirmed = !!(attrs.grailed_department && attrs.grailed_category);
  const suggestion = suggestGrailedCategory(attrs);
  const highConf = attrs.brand_confidence >= 0.65 && !!attrs.resembles_brand && attrs.resembles_brand !== 'unclear';
  const median = item.range?.median;
  const nPhotos = item.photos.length;

  return [
    {
      key: 'photos',
      label: 'Photos',
      required: true,
      jumpTo: 'sec-photos',
      state: nPhotos ? 'done' : 'todo',
      sub: nPhotos ? `${nPhotos} photo${nPhotos === 1 ? '' : 's'} — uploaded by Fill listing` : 'no photos in this group',
    },
    {
      key: 'title',
      label: 'Title',
      required: true,
      jumpTo: 'sec-title',
      state: title ? 'done' : 'todo',
      sub: title ? `${title.length} characters` : 'write a title (or Regenerate)',
    },
    {
      key: 'brand',
      label: 'Brand check',
      required: false,
      tag: 'verify',
      jumpTo: 'sec-title',
      state: highConf ? 'done' : 'warn',
      sub: highConf ? `${attrs.resembles_brand} — high confidence` : 'low confidence — verify from tags',
    },
    {
      key: 'description',
      label: 'Description',
      required: true,
      jumpTo: 'sec-desc',
      state: desc ? 'done' : 'todo',
      sub: desc ? `${desc.length} characters` : 'write a description (or Regenerate)',
    },
    {
      key: 'category',
      label: 'Grailed category',
      required: true,
      jumpTo: 'sec-category',
      state: confirmed ? 'done' : 'warn',
      sub: confirmed
        ? `${attrs.grailed_department} › ${attrs.grailed_category}`
        : suggestion
          ? `suggested ${suggestion.department} › ${suggestion.category} — confirm it`
          : 'pick + confirm to unlock cascade autofill',
    },
    {
      key: 'size',
      label: 'Size',
      required: true,
      jumpTo: 'sec-details',
      state: attrs.size ? (attrs.size_unclear ? 'warn' : 'done') : 'todo',
      sub: attrs.size
        ? attrs.size_unclear
          ? `“${attrs.size}” guessed — tag unclear, verify`
          : attrs.size
        : 'add a size (needed for cascade autofill)',
    },
    {
      key: 'condition',
      label: 'Condition',
      required: true,
      jumpTo: 'sec-details',
      state: attrs.condition_rating && attrs.condition_rating !== 'Unclear' ? 'done' : attrs.condition_rating === 'Unclear' ? 'warn' : 'todo',
      sub:
        attrs.condition_rating && attrs.condition_rating !== 'Unclear'
          ? attrs.condition_rating
          : attrs.condition_rating === 'Unclear'
            ? 'unclear from photos — judge it yourself'
            : 'pick a condition',
    },
    {
      key: 'colorstyle',
      label: 'Color & style',
      required: false,
      tag: 'optional',
      jumpTo: 'sec-details',
      state: attrs.grailed_color ? 'done' : 'todo',
      sub: attrs.grailed_color
        ? `${attrs.grailed_color}${attrs.grailed_style ? ' · ' + attrs.grailed_style : ''}`
        : 'skipped if blank — Grailed doesn’t require them',
    },
    {
      key: 'price',
      label: 'Price',
      required: true,
      jumpTo: 'sec-price',
      state: median != null ? 'done' : 'todo',
      sub: median != null ? `$${median}` : 'set a price or recompute from comps',
    },
  ];
}

export function ListingChecklist({ item }: { item: Item }) {
  const rows = buildRows(item);
  const req = rows.filter((r) => r.required);
  const done = req.filter((r) => r.state === 'done').length;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-baseline">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Listing checklist</span>
        <span className="ml-auto font-mono text-sm font-medium tabular-nums">
          {done} / {req.length}
        </span>
      </div>
      <ProgressBar pct={(done / req.length) * 100} className="mb-3" />
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => jump(r.jumpTo)}
              title="Jump to this section"
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/60"
            >
              {r.state === 'done' ? (
                <AnimatedCheck />
              ) : r.state === 'warn' ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-[11px] font-bold text-warning">
                  !
                </span>
              ) : (
                <PendingDot />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-tight">
                  {r.label}
                  {r.tag && (
                    <span className="ml-1.5 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                      {r.tag}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 border-t pt-2.5 text-xs text-muted-foreground">
        The last step is always yours: review and publish in the Chrome window — the app never submits.
      </p>
    </section>
  );
}
