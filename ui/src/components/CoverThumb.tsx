import type { ReactNode } from 'react';
import type { Photo } from '@/types';
import { cn } from '@/lib/utils';

/*
 * Shared cover thumbnail (M-2): the tinted-box + <img onError> pattern that
 * was duplicated across Home, Sidebar, TriageBoard, ConfirmScreen,
 * ConfirmCard and CommandPalette. Size/shape comes from `className`; badge
 * overlays ride in as `children` so call sites keep their own markup.
 *
 * Fallback: the photo's `tint` when present (real imports get one from
 * lib/api.ts — manifest U5 keeps that data value), else theme-aware
 * `bg-muted` — fixing the near-black chip the '#333' literal produced in
 * light theme. PhotoRow's richer PhotoTile deliberately stays its own thing.
 */

interface Props {
  /** The cover photo (usually photos[0]); absent → plain bg-muted box. */
  photo?: Photo | null;
  /** Size/shape per call site, e.g. "h-10 w-8 rounded". */
  className?: string;
  children?: ReactNode;
}

export function CoverThumb({ photo, className, children }: Props) {
  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden bg-muted', className)}
      style={photo?.tint ? { background: photo.tint } : undefined}
    >
      {photo?.src && (
        <img
          src={photo.src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {children}
    </span>
  );
}
