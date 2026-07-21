import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/*
 * Grailed-style color dropdown: every option (and the trigger) shows a color
 * circle next to the name, like Grailed's own color picker. One component so
 * the board card, the draft editor, and the confirm pass all render color the
 * same way. Options still come from grailed-selectors.json via
 * getAutofillOptions() — this map only styles the swatch for the FIXED
 * Grailed palette; an unknown option safely renders a neutral dot.
 */

const SWATCH: Record<string, string> = {
  Black: '#1a1a1a',
  White: '#ffffff',
  Gray: '#9096a0',
  Brown: '#7b4a2d',
  Beige: '#d9c7a4',
  Yellow: '#f2c230',
  Red: '#cf3b2e',
  Orange: '#ef8a33',
  Pink: '#f0a3c0',
  Purple: '#8d5cc4',
  Blue: '#3a6ac2',
  Green: '#42904c',
  Silver: '#c3c7cf',
  Gold: '#cfa53f',
};
// Multi gets a color wheel — a flat chip can't say "multicolor".
const MULTI_BG = 'conic-gradient(#cf3b2e, #ef8a33, #f2c230, #42904c, #3a6ac2, #8d5cc4, #cf3b2e)';

export function ColorDot({ color, className }: { color?: string | null; className?: string }) {
  const bg = color === 'Multi' ? MULTI_BG : color ? SWATCH[color] ?? 'hsl(var(--muted-foreground))' : undefined;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-3 w-3 shrink-0 rounded-full border',
        // No color yet → an empty dashed circle, clearly a blank, not a value.
        bg ? 'border-black/20 dark:border-white/25' : 'border-dashed border-muted-foreground/60',
        className
      )}
      style={bg ? { background: bg } : undefined}
    />
  );
}

interface Props {
  value: string | null | undefined;
  colors: string[];
  onChange: (color: string) => void;
  /** 'sm' = the board card's compact single-line variant. */
  size?: 'default' | 'sm';
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

export function ColorSelect({ value, colors, onChange, size = 'default', placeholder = 'not set — skipped', ariaLabel = 'Grailed color', className }: Props) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(size === 'sm' && 'h-6 gap-1 rounded border-transparent px-1 py-0 text-xs shadow-none hover:border-input', className)}
      >
        {/* Extra wrapper: the base trigger's [&>span]:line-clamp-1 turns its
            direct-child span into a -webkit-box, which kills flex gap — the
            inner span keeps the dot + label on a real flex row. */}
        <span className="min-w-0">
          <span className={cn('flex min-w-0 items-center', size === 'sm' ? 'gap-1.5' : 'gap-2')}>
            <ColorDot color={value} />
            <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {colors.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="flex items-center gap-2">
              <ColorDot color={c} />
              {c}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
