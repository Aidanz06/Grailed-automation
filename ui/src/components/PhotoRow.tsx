import { useRef, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Item, Photo } from '@/types';
import { GRAILED_PHOTO_LIMIT } from '@/lib/readiness';

const PALETTE = ['#1d3f8a', '#7a1420', '#2f6b3a', '#6b4a2b', '#5a3a6b', '#2a2f38'];

export function PhotoTile({
  photo,
  thumbnail,
  position,
  overLimit,
  children,
}: {
  photo: Photo;
  thumbnail?: boolean;
  /** 1-based LIVE position from the render index (plan §E) — photo.label is a
   * stale caption (filename / import-time name) and must not number tiles. */
  position: number;
  /** Past Grailed's photo cap at its current position — won't fit on the form. */
  overLimit?: boolean;
  children?: ReactNode;
}) {
  // The thumbnail (position 1 — what buyers see in the Grailed feed) renders
  // notably larger than the rest so it's obvious which photo leads the listing.
  return (
    <div
      className={`relative flex flex-col justify-end overflow-hidden rounded-md border p-1.5 ${
        thumbnail ? 'h-[375px] w-[300px]' : 'aspect-square w-full'
      } ${overLimit ? 'border-warning ring-1 ring-warning' : ''}`}
      title={overLimit ? `Past Grailed's ${GRAILED_PHOTO_LIMIT}-photo limit — drag it into the first ${GRAILED_PHOTO_LIMIT} or delete it` : undefined}
      style={{ background: photo.tint }}
    >
      {photo.src && (
        <img
          src={photo.src}
          alt={photo.label}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {/* Position badge on EVERY tile — this is also the Grailed upload order,
          so reordering/deleting renumbers instantly. */}
      <span className="absolute left-1 top-1 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">
        {thumbnail ? '1 · thumbnail' : position}
      </span>
      {children}
      <span className="relative z-10 truncate text-[11px] text-white [text-shadow:0_1px_2px_rgba(0,0,0,.5)]">{photo.label}</span>
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      aria-label="delete photo"
      className="absolute right-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/55 text-[13px] leading-none text-white hover:bg-destructive"
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      ×
    </button>
  );
}

interface Props {
  item: Item;
  update: (recipe: (draft: Item) => void) => void;
}

export function PhotoRow({ item, update }: Props) {
  const dragFrom = useRef<number | null>(null);
  const over = item.photos.length - GRAILED_PHOTO_LIMIT;

  const move = (from: number, to: number) =>
    update((d) => {
      if (from === to) return;
      const moved = d.photos.splice(from, 1)[0];
      if (!moved) return;
      d.photos.splice(to, 0, moved);
      d.dirty = true;
    });

  return (
    <section className="mb-5">
      <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-foreground">
        Photos (<span className={over > 0 ? 'text-warning' : undefined}>{item.photos.length}</span>){' '}
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          — drag to reorder · position 1 is the Grailed thumbnail
        </span>
      </label>
      {over > 0 && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-l-[3px] border-l-warning bg-secondary/40 p-2.5 text-[13px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Grailed allows {GRAILED_PHOTO_LIMIT} photos per listing — remove {over} photo{over === 1 ? '' : 's'}{' '}
            (the outlined tiles are past the limit; the fill won’t upload until this is {GRAILED_PHOTO_LIMIT} or fewer).
          </span>
        </div>
      )}
      {/* Streamlined layout: the tall thumbnail sits left; the rest pack an
          auto-fill grid beside it whose tiles GROW with the window (min 132px,
          square) — no dead space at any width. */}
      <div className="flex items-start gap-2">
        {item.photos.slice(0, 1).map((p) => (
          <div
            key={p.id}
            className="shrink-0"
            draggable
            onDragStart={() => {
              dragFrom.current = 0;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null) move(dragFrom.current, 0);
              dragFrom.current = null;
            }}
          >
            <PhotoTile photo={p} thumbnail position={1}>
              <DeleteButton onDelete={() => update((d) => { d.photos.splice(0, 1); d.dirty = true; })} />
            </PhotoTile>
          </div>
        ))}
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(132px,1fr))] content-start gap-2">
          {item.photos.slice(1).map((p, iRest) => {
            const i = iRest + 1;
            return (
              <div
                key={p.id}
                draggable
                onDragStart={() => {
                  dragFrom.current = i;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom.current !== null) move(dragFrom.current, i);
                  dragFrom.current = null;
                }}
              >
                <PhotoTile photo={p} position={i + 1} overLimit={i + 1 > GRAILED_PHOTO_LIMIT}>
                  <DeleteButton onDelete={() => update((d) => { d.photos.splice(i, 1); d.dirty = true; })} />
                </PhotoTile>
              </div>
            );
          })}
          <button
            onClick={() =>
              update((d) => {
                const n = d.photos.length + 1;
                d.photos.push({ id: 'p' + Date.now(), label: 'photo ' + n, tint: PALETTE[n % PALETTE.length] });
                d.dirty = true;
              })
            }
            className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-input bg-secondary/40 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            + add photo
          </button>
        </div>
      </div>
    </section>
  );
}
