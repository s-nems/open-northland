import type { Graphics } from 'pixi.js';
import type { SpriteKind } from '../../data/sprites/index.js';

/**
 * The placeholder markers a pooled entity draws when no atlas frame binds it (or no sheet is loaded) —
 * flat, depth-sortable geometry coloured by kind, built ONCE per entity.
 */

/** Placeholder body colour per drawable sprite kind (drawn when no atlas frame binds the entity). */
const KIND_COLOURS: Record<SpriteKind, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
  stockpile: 0xb08040, // a sandy heap/flag marker, distinct from the green resource node
  stump: 0x6b4a2a, // a brown stump/debris marker (the felled-tree remnant), distinct from both
  grounddrop: 0x8a5a2a, // a log-brown marker for a freshly-felled trunk lying on the ground
};

/** The feet-local body dimensions the placeholder marker is drawn at, by kind (see {@link drawPlaceholder}). */
export function placeholderBody(kind: SpriteKind): { bodyW: number; bodyH: number } {
  if (kind === 'building') return { bodyW: 28, bodyH: 40 };
  if (kind === 'stockpile') return { bodyW: 20, bodyH: 12 }; // a low, wide heap/flag base
  return { bodyW: 14, bodyH: 24 };
}

/**
 * Draw a feet-anchored sprite placeholder into `g`, relative to its container origin `(0,0)`: a small
 * footprint diamond on the ground + a body box rising from it, coloured by kind — so an unbound entity
 * (or the no-atlas default) still shows depth-sortable geometry. Built ONCE per entity (kind is stable);
 * only its visibility toggles per frame.
 */
export function drawPlaceholder(g: Graphics, kind: SpriteKind): Graphics {
  const colour = KIND_COLOURS[kind];
  const { bodyW, bodyH } = placeholderBody(kind);
  g.moveTo(0, -5).lineTo(9, 0).lineTo(0, 5).lineTo(-9, 0).closePath().fill({ color: 0x000000, alpha: 0.3 });
  g.rect(-bodyW / 2, -bodyH, bodyW, bodyH)
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  return g;
}
