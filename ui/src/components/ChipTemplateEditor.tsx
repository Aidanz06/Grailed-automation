import { useEffect, useRef } from 'react';
import { CHIP_DEFS } from '@/lib/description';
import { cn } from '@/lib/utils';

/*
 * Inline chip-in-text template editor (Description Styles Phase 1 UI).
 * The template's MODEL is an ordered list of segments — constant text and
 * [detail] chips — whose serialization is the existing plain-text token
 * template ("Condition: [condition_rating]"), so the persisted format, the
 * engine (composeDescription/finalizeDescription), and saved styles are
 * untouched: this component only changes how that string is edited.
 *
 * contenteditable ground rules (the React gotchas):
 *  - UNCONTROLLED: the DOM is only (re)rendered from the `value` prop when it
 *    differs from what this editor last emitted (load / style switch / reset) —
 *    never on keystrokes, so the caret stays put.
 *  - The DOM stays FLAT: text nodes (newlines included — the editor is
 *    whitespace-pre-wrap and Enter inserts "\n") and atomic chip spans
 *    (contentEditable=false, data-chip). No divs/brs to normalize, but the
 *    serializer still folds them to "\n" defensively (e.g. drag-dropped text).
 *  - Paste is forced to plain text.
 *  - Chip insertion lands at the caret (palette buttons preventDefault on
 *    mousedown so the selection survives the click); with no caret it appends.
 */

type Segment = { type: 'text'; value: string } | { type: 'chip'; key: string };

const CHIP_BY_KEY = new Map(CHIP_DEFS.map((c) => [c.key, c]));
const TOKEN_RE = /\[([a-z_]+)\]/g;

/** Token string → ordered segments. Unknown [tokens] stay constant text,
 * matching the engine's composeDescription. */
export function parseTemplate(template: string): Segment[] {
  const segs: Segment[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(template))) {
    if (!CHIP_BY_KEY.has(m[1])) continue;
    if (m.index > last) segs.push({ type: 'text', value: template.slice(last, m.index) });
    segs.push({ type: 'chip', key: m[1] });
    last = m.index + m[0].length;
  }
  if (last < template.length) segs.push({ type: 'text', value: template.slice(last) });
  return segs;
}

function chipEl(key: string): HTMLElement {
  const def = CHIP_BY_KEY.get(key);
  const span = document.createElement('span');
  span.dataset.chip = key;
  span.contentEditable = 'false';
  span.title = def?.hint ?? key;
  span.className = cn(
    'group/chip mx-0.5 inline-flex select-none items-center gap-0.5 rounded-full border px-1.5 py-px align-baseline font-sans text-2xs leading-4',
    def?.kind === 'prose' ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-secondary text-foreground/80'
  );
  const label = document.createElement('span');
  label.textContent = def?.label ?? key;
  span.appendChild(label);
  if (def?.kind === 'prose') {
    const ai = document.createElement('span');
    ai.className = 'opacity-60';
    ai.textContent = '· AI';
    span.appendChild(ai);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.dataset.chipX = '1';
  x.setAttribute('aria-label', `remove ${def?.label ?? key}`);
  x.tabIndex = -1;
  x.className = 'w-3 text-center opacity-0 transition-opacity hover:text-destructive group-hover/chip:opacity-100';
  x.textContent = '×';
  span.appendChild(x);
  return span;
}

/** Editor DOM → token string. */
function domToTemplate(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.chip) {
      out += `[${node.dataset.chip}]`;
      return;
    }
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    if (/^(DIV|P)$/.test(node.tagName) && out && !out.endsWith('\n')) out += '\n';
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

function renderTemplate(root: HTMLElement, template: string) {
  root.textContent = '';
  for (const seg of parseTemplate(template)) {
    root.appendChild(seg.type === 'chip' ? chipEl(seg.key) : document.createTextNode(seg.value));
  }
}

interface Props {
  value: string;
  onChange: (template: string) => void;
}

export function ChipTemplateEditor({ value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  // Render from state ONLY when the value came from outside (load, style
  // switch, reset-preset) — an echo of our own emit must not touch the DOM.
  useEffect(() => {
    if (!ref.current || value === lastEmitted.current) return;
    renderTemplate(ref.current, value);
    lastEmitted.current = value;
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const t = domToTemplate(ref.current);
    lastEmitted.current = t;
    onChange(t);
  };

  const insert = (key: string) => {
    const editor = ref.current;
    if (!editor) return;
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0);
      range.deleteContents();
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const chip = chipEl(key);
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.focus();
    emit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      // Keep the DOM flat: a "\n" text insert instead of the browser's <div>.
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed) return;
      const { anchorNode, anchorOffset } = sel;
      let prev: Node | null = null;
      if (anchorNode?.nodeType === Node.TEXT_NODE) {
        if (anchorOffset > 0) return; // normal in-text backspace
        prev = anchorNode.previousSibling;
      } else if (anchorNode instanceof HTMLElement && anchorNode === ref.current) {
        prev = anchorNode.childNodes[anchorOffset - 1] ?? null;
      }
      if (prev instanceof HTMLElement && prev.dataset.chip) {
        e.preventDefault();
        prev.remove();
        emit();
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const x = (e.target as HTMLElement).closest?.('[data-chip-x]');
    if (x) {
      x.closest('[data-chip]')?.remove();
      emit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {CHIP_DEFS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.hint}
            onMouseDown={(e) => e.preventDefault() /* keep the editor's caret */}
            onClick={() => insert(c.key)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-2xs leading-4 transition-colors',
              c.kind === 'prose'
                ? 'border-primary/40 text-primary hover:bg-primary/10'
                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            + {c.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        aria-label="description template"
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={onClick}
        className="min-h-[220px] flex-1 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2.5 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
