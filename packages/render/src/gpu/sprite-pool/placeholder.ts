import type { Graphics } from 'pixi.js';
import type { SpriteKind } from '../../data/sprites/index.js';

/**
 * The placeholder markers a pooled entity draws when no atlas frame binds it (or no sheet is loaded) -
 * flat, depth-sortable geometry coloured by kind, built once per entity.
 */

/** Every kind drawn as the generic box marker - all but the projectile, which draws {@link ARROW}. */
type BoxKind = Exclude<SpriteKind, 'projectile'>;

/**
 * The in-flight munition marker's authored parts, in feet-local px pointing screen-east (+x) so the
 * pool can rotate the whole graphic to the flight heading; `halfSpan` is a part's half-height off the
 * shaft line. Which end a player reads as the point IS the direction they see the shot travel, so the
 * head alone reaches the forward extreme and is the brightest part, and the feathers sweep back from
 * their apex. User-tuned proportions: 32 px tip to tail, long and thin beside a 24 px settler body.
 * Data, not literals inside {@link drawArrow}, so those rules are testable without a GPU.
 */
export const ARROW = {
  /** Wood: the dullest part, running from the tail to where the head begins. */
  shaft: { colour: 0x7a4a24, tailX: -16, width: 2 },
  /** Steel: the brightest part and the only one at the forward extreme. */
  head: { colour: 0xd6dee8, tipX: 16, baseX: 8, halfSpan: 2 },
  /** Feathers: swept back from `apexX` to the tail. */
  fletching: { colour: 0x9c3b2e, apexX: -8, endX: -16, halfSpan: 2, width: 2 },
} as const;

/** Placeholder BOX colour per kind (drawn when no atlas frame binds the entity). */
const KIND_COLOURS: Record<BoxKind, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
  berrybush: 0xb03050, // a red-berry marker (a fruited bush), distinct from the green resource node
  stockpile: 0xb08040, // a sandy heap/flag marker, distinct from the green resource node
  stump: 0x6b4a2a, // a brown stump/debris marker (the felled-tree remnant), distinct from both
  grounddrop: 0x8a5a2a, // a log-brown marker for a freshly-felled trunk lying on the ground
  signpost: 0xdeb060, // a pale-wood post marker (the scout's guidepost), distinct from the darker trunk
};

/** Half-extents (world px) of the ground footprint diamond a box placeholder stands on. The drawn diamond
 *  ({@link drawPlaceholder}) and the box the pool stamps for it ({@link placeholderBounds}) read the same
 *  two numbers, so the hit box cannot drift from the graphic. */
const FOOTPRINT_HALF_W = 9;
const FOOTPRINT_HALF_H = 5;

/** How high (world px) above its ground anchor the arrow flies - roughly a settler's torso, so a shot
 *  crosses between fighters instead of skimming their feet. A drawn-look choice, tunable by eye. */
export const PROJECTILE_FLIGHT_HEIGHT = 14;

/**
 * Paint {@link ARROW}, rotated by the pool to the
 * {@link import('../../data/scene/draw-item.js').DrawItem.rotation} flight heading.
 * A drawn-shape approximation: no decoded arrow bob exists in the extracted `[bobseq]` lanes (only
 * character bodies), so this minimal sprite is the named fallback until the effects bmds are decoded.
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

/** The feet-local body dimensions the placeholder marker is drawn at, by kind (see {@link drawPlaceholder}). */
function placeholderBody(kind: SpriteKind): { bodyW: number; bodyH: number } {
  if (kind === 'building') return { bodyW: 28, bodyH: 40 };
  if (kind === 'stockpile') return { bodyW: 20, bodyH: 12 }; // a low, wide heap/flag base
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

/** Cached per kind: the pool asks every frame it draws a placeholder, and the box depends only on `kind`. */
const boundsByKind = new Map<SpriteKind, PlaceholderBounds>();

/**
 * The feet-local box a placeholder marker occupies: its body box widened to at least the ground footprint
 * diamond it stands on, and floored at the diamond's lower tip - so an unbound entity is clickable over
 * the marker {@link drawPlaceholder} actually draws.
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
 * Draw a feet-anchored sprite placeholder into `g`, relative to its container origin `(0,0)`: a small
 * footprint diamond on the ground + a body box rising from it, coloured by kind - so an unbound entity
 * (or the no-atlas default) still shows depth-sortable geometry. Built once per entity (kind is stable);
 * only its visibility toggles per frame.
 */
export function drawPlaceholder(g: Graphics, kind: SpriteKind): Graphics {
  if (kind === 'projectile') return drawArrow(g); // an arrow, not a box - rotated to its flight heading
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
