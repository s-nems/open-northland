import type { Graphics } from 'pixi.js';
import type { SpriteKind } from '../../data/sprites/index.js';

/**
 * The markers a pooled entity draws when no atlas frame binds it: flat, depth-sortable geometry
 * coloured by kind.
 */

type BoxKind = Exclude<SpriteKind, 'projectile'>;

/**
 * The in-flight munition marker's authored parts, in feet-local px pointing screen-east (+x) so the pool
 * can rotate the whole graphic to the flight heading; `halfSpan` is a part's half-height off the shaft
 * line. Only the head reaches the forward extreme and it is the brightest part, so a player reads which
 * way the shot travels. Authored proportions: 32 px tip to tail beside a 24 px settler body.
 */
export const ARROW = {
  shaft: { colour: 0x7a4a24, tailX: -16, width: 2 },
  head: { colour: 0xd6dee8, tipX: 16, baseX: 8, halfSpan: 2 },
  fletching: { colour: 0x9c3b2e, apexX: -8, endX: -16, halfSpan: 2, width: 2 },
} as const;

/** Placeholder box colour per kind. */
const KIND_COLOURS: Record<BoxKind, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
  berrybush: 0xb03050, // red berries on a fruited bush
  stockpile: 0xb08040, // a sandy heap or delivery flag
  stump: 0x6b4a2a, // brown felled-tree debris
  grounddrop: 0x8a5a2a, // a log-brown trunk on the ground
  signpost: 0xdeb060, // a pale-wood guidepost
};

/** Half-extents (world px) of the ground footprint diamond a box placeholder stands on. The drawn
 *  diamond and the stamped hit box read the same two numbers, so they cannot drift apart. */
const FOOTPRINT_HALF_W = 9;
const FOOTPRINT_HALF_H = 5;

/** How high (world px) above its ground anchor the arrow flies - roughly a settler's torso, so a shot
 *  crosses between fighters instead of skimming their feet. A drawn-look approximation. */
export const PROJECTILE_FLIGHT_HEIGHT = 14;

/**
 * Paint {@link ARROW}, rotated by the pool to the flight heading. A drawn-shape approximation: no arrow
 * bob exists in the extracted `[bobseq]` lanes, so this is the named fallback until the effects bmds are
 * decoded.
 */
function drawArrow(g: Graphics): Graphics {
  const { shaft, head, fletching } = ARROW;
  g.moveTo(shaft.tailX, 0).lineTo(head.baseX, 0).stroke({ color: shaft.colour, width: shaft.width });
  g.moveTo(head.tipX, 0)
    .lineTo(head.baseX, -head.halfSpan)
    .lineTo(head.baseX, head.halfSpan)
    .closePath()
    .fill({ color: head.colour });
  g.moveTo(fletching.apexX, 0)
    .lineTo(fletching.endX, -fletching.halfSpan)
    .moveTo(fletching.apexX, 0)
    .lineTo(fletching.endX, fletching.halfSpan)
    .stroke({ color: fletching.colour, width: fletching.width });
  return g;
}

/** Feet-local body dimensions of the placeholder marker, by kind. */
function placeholderBody(kind: SpriteKind): { bodyW: number; bodyH: number } {
  if (kind === 'building') return { bodyW: 28, bodyH: 40 };
  if (kind === 'stockpile') return { bodyW: 20, bodyH: 12 }; // a low, wide heap or flag base
  // The arrow's own extent, tip to tail and across the head.
  if (kind === 'projectile') {
    return { bodyW: ARROW.head.tipX - ARROW.shaft.tailX, bodyH: 2 * ARROW.head.halfSpan };
  }
  return { bodyW: 14, bodyH: 24 };
}

export interface PlaceholderBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Cached per kind: the pool asks every frame it draws a placeholder. */
const boundsByKind = new Map<SpriteKind, PlaceholderBounds>();

/**
 * The feet-local box a placeholder occupies: its body box widened to at least the ground footprint
 * diamond and floored at the diamond's lower tip, so the whole drawn marker is clickable.
 */
export function placeholderBounds(kind: SpriteKind): PlaceholderBounds {
  let box = boundsByKind.get(kind);
  if (box === undefined) {
    const { bodyW, bodyH } = placeholderBody(kind);
    const halfW = Math.max(FOOTPRINT_HALF_W, bodyW / 2);
    box = { minX: -halfW, minY: -bodyH, maxX: halfW, maxY: FOOTPRINT_HALF_H };
    boundsByKind.set(kind, box);
  }
  return box;
}

/**
 * Draw a feet-anchored placeholder into `g` about its container origin `(0,0)`: a small footprint
 * diamond on the ground and a body box rising from it, coloured by kind. Built once per entity, since
 * kind is stable; only its visibility toggles per frame.
 */
export function drawPlaceholder(g: Graphics, kind: SpriteKind): Graphics {
  if (kind === 'projectile') return drawArrow(g); // an arrow, not a box
  const colour = KIND_COLOURS[kind];
  const { bodyW, bodyH } = placeholderBody(kind);
  g.moveTo(0, -FOOTPRINT_HALF_H)
    .lineTo(FOOTPRINT_HALF_W, 0)
    .lineTo(0, FOOTPRINT_HALF_H)
    .lineTo(-FOOTPRINT_HALF_W, 0)
    .closePath()
    .fill({ color: 0x000000, alpha: 0.3 });
  g.rect(-bodyW / 2, -bodyH, bodyW, bodyH)
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  return g;
}
