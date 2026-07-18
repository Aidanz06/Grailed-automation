import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

/*
 * Grouped Department › Category picker (M-7): the same Radix Select the flat
 * pickers used, rendered with department group headers, shared by DraftEditor
 * and ConfirmCard (kills the duplicated catPairs flattening, P15).
 *
 * A PICKER only — the value is the callers' existing `"Dept||Cat"` key and
 * changes flow straight back up. The staged Confirm gate and the
 * grailed_department/category writes STAY in the callers (manifest R11):
 * nothing is applied to the item until their explicit Confirm.
 */

interface Props {
  /** Department → categories, from getAutofillOptions() (grailed-selectors twin). */
  categoryTree: Record<string, string[]>;
  /** Current `"Dept||Cat"` key; undefined/'' = nothing picked yet. */
  value: string | undefined;
  onValueChange: (key: string) => void;
  triggerClassName?: string;
}

export function CategorySelect({ categoryTree, value, onValueChange, triggerClassName }: Props) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger className={triggerClassName}>
        {/* Children override: grouped items read as just "Tops", but the
            closed trigger must keep showing the full "Dept › Cat". */}
        <SelectValue placeholder="choose category">{value ? value.split('||').join(' › ') : undefined}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(categoryTree).map(([dept, cats]) => (
          <SelectGroup key={dept}>
            <SelectLabel>{dept}</SelectLabel>
            {cats.map((cat) => (
              <SelectItem key={`${dept}||${cat}`} value={`${dept}||${cat}`}>
                {cat}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
