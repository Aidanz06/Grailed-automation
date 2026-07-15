import { useEffect, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import type { DescProfile } from '@/types';
import { api } from '@/lib/api';
import { PRESETS } from '@/lib/description';
import { errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
 * Saved defaults (refinement plan §E4, the honest V1 slice): the two
 * repetitive-typing killers that actually apply to this app — tags added to
 * every new draft (a seller's standing shop tags), and the default
 * description detail level. Everything else the plan lists (brand, condition,
 * size) is per-item truth and deliberately NOT defaultable. Defaults shape
 * new drafts only; existing drafts and per-draft overrides are untouched.
 */

interface Props {
  defaultProfile: DescProfile;
  setDefaultProfile: (p: DescProfile) => void;
  toast: (msg: string) => void;
}

export function DefaultsMenu({ defaultProfile, setDefaultProfile, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    api
      .getDefaultTags()
      .then((v) => {
        setTags(v);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  const saveTags = () => {
    setSaving(true);
    api
      .setDefaultTags(tags)
      .then(() => {
        const n = tags.split(',').map((t) => t.trim()).filter(Boolean).length;
        toast(n ? `Saved — ${n} tag${n === 1 ? '' : 's'} will be added to every new draft.` : 'Default tags cleared.');
        setOpen(false);
      })
      .catch((err) => toast(`Couldn’t save: ${errorMessage(err)}`))
      .finally(() => setSaving(false));
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        title="Defaults — tags added to every new draft, default description detail"
        aria-label="open defaults"
        onClick={() => setOpen(true)}
      >
        <Settings2 />
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[16vh]" onMouseDown={() => setOpen(false)}>
          <div
            className="rise-in w-[480px] max-w-[90vw] rounded-lg border bg-card p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Defaults</span>
              <span className="flex-1" />
              <button aria-label="close defaults" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Tags added to every new draft</div>
                <Input
                  value={tags}
                  placeholder="e.g. vintage, my-shop-name (comma-separated)"
                  disabled={!loaded}
                  onChange={(e) => setTags(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTags();
                  }}
                />
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  Appended when a draft is generated (import, review-confirm, Regenerate) — after the item’s own tags,
                  never duplicated, 10 tags max total. Existing drafts are untouched.
                </p>
              </div>

              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Default description detail</div>
                <div className="flex items-center gap-1.5">
                  {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((name) => (
                    <Button
                      key={name}
                      variant={defaultProfile.preset === name ? 'secondary' : 'outline'}
                      size="sm"
                      className={cn('h-7 px-2.5 text-xs', defaultProfile.preset === name && 'border-primary text-primary')}
                      onClick={() => setDefaultProfile({ preset: name, sections: { ...PRESETS[name] } })}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  What new drafts show by default — a draft’s own detail setting (in its editor) always wins.
                </p>
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button size="sm" disabled={!loaded || saving} onClick={saveTags}>
                  {saving ? 'Saving…' : 'Save tags'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
