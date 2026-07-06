import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagEditor({ tags, onChange }: Props) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag, i) => (
        <Badge key={tag + i} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1 font-normal">
          {tag}
          <button
            aria-label={`remove ${tag}`}
            className="rounded-full px-1 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(tags.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        placeholder="+ add tag"
        className="h-7 w-32 text-xs"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onChange([...tags, draft.trim().toLowerCase()]);
            setDraft('');
          }
        }}
      />
    </div>
  );
}
