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
 * line. Only the head reaches the forward extreme and it is the palest part, so a player reads which way
 * the shot travels. Its narrow 24 px silhouette stays subordinate to the actor art while surviving the
 * ×2 world view. Approximation: no arrow bob exists in the extracted `[bobseq]` lanes, so this is the
 * fallback until the effects bmds are decoded.
 */
export const ARROW = {
  shaft: { colour: 0x946d49, tailX: -12, width: 1.25 },
  head: { colour: 0x9ba3a0, edgeColour: 0x5f6663, tipX: 12, baseX: 8.5, halfSpan: 1.5 },
  fletching: { colour: 0x9a8e7f, apexX: -7, endX: -11, innerX: -10, halfSpan: 1.25 },
} as const;

const KIND_COLOURS: Record<BoxKind, number> = {
  building: 0xc8a04a,
  palisade: 0x8b5a2b,
  settler: 0xe8e0d0,
  fish: 0x5da9c9,
  resource: 0x2f7d32,
  berrybush: 0xb03050, // red berries on a fruited bush
  stockpile: 0xb08040, // a sandy heap or delivery flag
  stump: 0x6b4a2a, // brown felled-tree debris
  chest: 0x9a6a2e, // a banded wooden chest
  grounddrop: 0x8a5a2a, // a log-brown trunk on the ground
  signpost: 0xdeb060, // a pale-wood guidepost
  craftfx: 0xe07a30, // an ember-orange staged effect
  vehicle: 0x8c6a3c, // a cart-wood brown hull
};

/** Half-extents (world px) of the ground footprint diamond a box placeholder stands on. The drawn
 *  diamond and the stamped hit box read the same two numbers, so they cannot drift apart. */
const FOOTPRINT_HALF_W = 9;
const FOOTPRINT_HALF_H = 5;

/** How high (world px) above its ground anchor the arrow flies - roughly a settler's torso, so a shot
 *  crosses between fighters instead of skimming their feet. A drawn-look approximation. */
export const PROJECTILE_FLIGHT_HEIGHT = 14;

/** Paint {@link ARROW}, rotated by the pool to the flight heading. */
function drawArrow(g: Graphics): Graphics {
  const { shaft, head, fletching } = ARROW;

  // Two slim swept vanes read as feathering instead of the bright V of a map marker. Paint them under
  // the shaft so the wooden spine remains continuous through the tail at normal play scale.
  g.moveTo(fletching.apexX, 0)
    .lineTo(fletching.endX, -fletching.halfSpan)
    .lineTo(fletching.innerX, -0.25)
    .closePath()
    .fill({ color: fletching.colour });
  g.moveTo(fletching.apexX, 0)
    .lineTo(fletching.endX, fletching.halfSpan)
    .lineTo(fletching.innerX, 0.25)
    .closePath()
    .fill({ color: fletching.colour });
  g.moveTo(shaft.tailX, 0)
    .lineTo(head.baseX, 0)
    .stroke({ color: shaft.colour, width: shaft.width, cap: 'round' });
  g.moveTo(head.tipX, 0)
    .lineTo(head.baseX, -head.halfSpan)
    .lineTo(head.baseX, head.halfSpan)
    .closePath()
    .fill({ color: head.colour })
    .stroke({ color: head.edgeColour, width: 0.5, join: 'round' });
  return g;
}

/** Feet-local body dimensions of the placeholder marker, by kind. */
function placeholderBody(kind: SpriteKind): { bodyW: number; bodyH: number } {
  if (kind === 'building') return { bodyW: 28, bodyH: 40 };
  if (kind === 'stockpile') return { bodyW: 20, bodyH: 12 }; // a low, wide heap or flag base
  if (kind === 'fish') return { bodyW: 18, bodyH: 8 };
  if (kind === 'vehicle') return { bodyW: 26, bodyH: 18 }; // a low, wide hull
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
 * diamond on the ground and a body box rising from it, coloured by kind.
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
