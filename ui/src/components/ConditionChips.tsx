import { cn } from '@/lib/utils';

/*
 * Condition as a segmented chip row (§F resale-native components): the
 * vocabulary is four fixed values, so show them — one click to set, no
 * dropdown round-trip. 'Unclear' is an AI state (vision couldn't judge from
 * the photos), not a seller choice, so pickers render the other three;
 * callers show their own "judge it yourself" note while it's Unclear.
 */

// Single source of the condition vocabulary (was DraftEditor's export).
export const CONDITIONS = ['New with tags', 'Gently used', 'Used', 'Unclear'];
export const PICKABLE_CONDITIONS = CONDITIONS.filter((c) => c !== 'Unclear');

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export function ConditionChips({ value, onChange, className }: Props) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} role="radiogroup" aria-label="condition">
      {PICKABLE_CONDITIONS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={cn(
            'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
            value === c
              ? 'border-primary bg-primary/15 font-medium text-primary'
              : 'border-input bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
          )}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
