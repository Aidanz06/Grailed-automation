import { useEffect, useState } from 'react';
import { Pencil, Settings2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { resolveStyles, serializeStyles } from '@/lib/description';
import { errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/*
 * Saved defaults (refinement plan §E4, the honest V1 slice): the two
 * repetitive-typing killers that actually apply to this app — tags added to
 * every new draft (a seller's standing shop tags), and the default
 * description STYLE (Description Styles Phase 1 — the named template that
 * composes every new description, constants/footer included). Everything else
 * the plan lists (brand, condition, size) is per-item truth and deliberately
 * NOT defaultable. Defaults shape new drafts only.
 */

interface Props {
  stylesRaw: string | null;
  onStylesChanged: (raw: string | null) => void;
  onEditStyles: () => void;
  toast: (msg: string) => void;
}

export function DefaultsMenu({ stylesRaw, onStylesChanged, onEditStyles, toast }: Props) {
  const resolved = resolveStyles(stylesRaw);
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
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Description style</div>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={resolved.active}
                    onValueChange={(name) => {
                      const raw = serializeStyles({ ...resolved, active: name });
                      const value = JSON.parse(raw).styles.length === 0 && name === 'Standard' ? null : raw;
                      api
                        .setDescriptionStyles(value)
                        .then(() => {
                          onStylesChanged(value);
                          toast(`New drafts will use the “${name}” style.`);
                        })
                        .catch((err) => toast(`Couldn’t save: ${errorMessage(err)}`));
                    }}
                  >
                    <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="default description style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resolved.styles.map((s) => (
                        <SelectItem key={s.name} value={s.name}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onEditStyles}>
                    <Pencil /> Edit styles…
                  </Button>
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  The template every new description is composed with — its constant footer is always the last line.
                  Existing drafts keep their text until you regenerate them.
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
