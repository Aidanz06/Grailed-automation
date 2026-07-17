import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import {
  BUILTIN_STYLES,
  DEFAULT_ACTIVE,
  chipValues,
  composeDescription,
  finalizeDescription,
  resolveStyles,
  serializeStyles,
  styleFooter,
  type ResolvedStyles,
} from '@/lib/description';
import { ChipTemplateEditor } from '@/components/ChipTemplateEditor';
import { errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/*
 * Description Styles editor (Phase 1, docs/DESIGN-description-styles.md).
 * One template per named style: plain typed text is CONSTANT (footer, labels
 * like "Condition:"), chips are dynamic — data chips substitute from the
 * item's attributes, prose chips are written by the AI; an empty chip drops
 * its whole line. The template is edited inline in ChipTemplateEditor (details
 * render as atomic pills among typed text); it still round-trips to the same
 * persisted [token] string the engine composes from.
 */

// The sample item behind the live preview — rich enough that every chip has a
// value, so inserting one always visibly changes the output.
const SAMPLE_ATTRS = {
  resembles_brand: 'Carhartt',
  brand_confidence: 0.9,
  primary_color: 'brown',
  materials: ['duck canvas'],
  era_style: '90s workwear',
  visible_text: 'DETROIT J97',
  condition_rating: 'Gently used',
};
const SAMPLE_PARTS = {
  overview: 'Brown duck canvas work jacket with blanket lining.',
  condition_note: 'light fading at the cuffs',
  fit: 'Runs boxy through the shoulders.',
  flaws: 'Small stain on the left sleeve.',
};

interface Props {
  stylesRaw: string | null;
  onSaved: (raw: string | null) => void;
  onClose: () => void;
  toast: (msg: string) => void;
}

export function StyleEditor({ stylesRaw, onSaved, onClose, toast }: Props) {
  const [resolved, setResolved] = useState<ResolvedStyles>(() => resolveStyles(stylesRaw));
  const [selected, setSelected] = useState(resolved.active);
  const [template, setTemplate] = useState(
    () => resolveStyles(stylesRaw).styles.find((s) => s.name === resolveStyles(stylesRaw).active)?.template ?? ''
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = resolved.styles.find((s) => s.name === selected);
  const isBuiltin = !!current?.builtin;
  const baseline = BUILTIN_STYLES.find((b) => b.name === selected)?.template;
  const dirty = template !== (current?.template ?? '');

  const preview = useMemo(() => {
    const body = composeDescription(template, chipValues(SAMPLE_ATTRS, SAMPLE_PARTS));
    return finalizeDescription(body, template);
  }, [template]);
  const footer = useMemo(() => styleFooter(template), [template]);

  const switchTo = (name: string) => {
    setSelected(name);
    setTemplate(resolved.styles.find((s) => s.name === name)?.template ?? '');
    setRenaming(null);
  };

  const persist = (next: ResolvedStyles, note?: string) => {
    setSaving(true);
    const raw = serializeStyles(next);
    const value = JSON.parse(raw).styles.length === 0 && next.active === DEFAULT_ACTIVE ? null : raw;
    api
      .setDescriptionStyles(value)
      .then(() => {
        setResolved(next);
        onSaved(value);
        if (note) toast(note);
      })
      .catch((err) => toast(`Couldn’t save styles: ${errorMessage(err)}`))
      .finally(() => setSaving(false));
  };

  const saveTemplate = () => {
    const next: ResolvedStyles = {
      ...resolved,
      styles: resolved.styles.map((s) => (s.name === selected ? { ...s, template } : s)),
    };
    persist(next, `Saved “${selected}”.`);
  };

  const addStyle = () => {
    let n = 1;
    while (resolved.styles.some((s) => s.name === `My style ${n}`)) n++;
    const name = `My style ${n}`;
    const next: ResolvedStyles = {
      ...resolved,
      styles: [...resolved.styles, { name, template, builtin: false }],
    };
    persist(next, `Added “${name}” (a copy of the current template).`);
    setSelected(name);
    setRenaming(name);
  };

  const removeStyle = () => {
    if (isBuiltin) return;
    const styles = resolved.styles.filter((s) => s.name !== selected);
    const active = resolved.active === selected ? DEFAULT_ACTIVE : resolved.active;
    const nextSel = active;
    persist({ active, styles }, `Deleted “${selected}”.`);
    setSelected(nextSel);
    setTemplate(styles.find((s) => s.name === nextSel)?.template ?? '');
  };

  const rename = (to: string) => {
    const name = to.trim();
    setRenaming(null);
    if (!name || name === selected || resolved.styles.some((s) => s.name === name)) return;
    const next: ResolvedStyles = {
      active: resolved.active === selected ? name : resolved.active,
      styles: resolved.styles.map((s) => (s.name === selected ? { ...s, name } : s)),
    };
    persist(next);
    setSelected(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[8vh]" onMouseDown={onClose}>
      <div
        className="rise-in flex max-h-[84vh] w-[860px] max-w-[94vw] flex-col rounded-lg border bg-card p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <Pencil className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Description styles</span>
          <span className="text-xs text-muted-foreground">
            typed text is constant · chips fill from the item · empty chips drop their line
          </span>
          <span className="flex-1" />
          <button aria-label="close style editor" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={selected} onValueChange={switchTo}>
            <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resolved.styles.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                  {s.name === resolved.active ? ' · default' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {renaming === selected ? (
            <Input
              autoFocus
              defaultValue={selected}
              className="h-8 w-[160px] text-xs"
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            !isBuiltin && (
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setRenaming(selected)}>
                Rename
              </Button>
            )
          )}
          {resolved.active !== selected ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={saving}
              title="New drafts compose their description with the default style"
              onClick={() => persist({ ...resolved, active: selected }, `“${selected}” is now the default style.`)}
            >
              <Check /> Use as default
            </Button>
          ) : (
            <span className="rounded-full border border-success/60 px-2 py-0.5 text-[11px] text-success">default style</span>
          )}
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={addStyle}>
            <Plus /> New style
          </Button>
          {isBuiltin && baseline != null && template !== baseline && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              title="Restore this built-in preset's original template"
              onClick={() => setTemplate(baseline)}
            >
              <RotateCcw /> Reset preset
            </Button>
          )}
          {!isBuiltin && (
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={saving} onClick={removeStyle}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Template — click a detail to insert it at the caret
            </div>
            <ChipTemplateEditor value={template} onChange={setTemplate} />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              {footer
                ? `Constant footer (always the last line, on every draft): “${footer.split('\n')[0]}${footer.includes('\n') ? '…' : ''}”`
                : 'No constant footer — end the template with plain text to add one.'}
            </p>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Live preview — sample jacket</div>
            <pre className="min-h-[220px] flex-1 overflow-auto whitespace-pre-wrap rounded-md border bg-secondary/40 p-2.5 text-xs leading-relaxed">
              {preview || '(empty template)'}
            </pre>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Details the AI can’t see on a real item drop out automatically — the sample has everything, so every chip
              shows here.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3">
          <span className="mr-auto text-[11px] text-muted-foreground">
            Applies to newly generated drafts (import, confirm, Regenerate). Existing text is untouched until you regenerate.
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={saveTemplate}>
            {saving ? 'Saving…' : `Save “${selected}”`}
          </Button>
        </div>
      </div>
    </div>
  );
}
