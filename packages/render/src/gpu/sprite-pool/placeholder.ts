import type { Graphics } from 'pixi.js';
import type { SpriteKind } from '../../data/sprites/index.js';

/**
 * The placeholder markers a pooled entity draws when no atlas frame binds it (or no sheet is loaded) —
 * flat, depth-sortable geometry coloured by kind, built once per entity.
 */

/** Placeholder body colour per drawable sprite kind (drawn when no atlas frame binds the entity). */
const KIND_COLOURS: Record<SpriteKind, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
  berrybush: 0xb03050, // a red-berry marker (a fruited bush), distinct from the green resource node
  stockpile: 0xb08040, // a sandy heap/flag marker, distinct from the green resource node
  stump: 0x6b4a2a, // a brown stump/debris marker (the felled-tree remnant), distinct from both
  grounddrop: 0x8a5a2a, // a log-brown marker for a freshly-felled trunk lying on the ground
  signpost: 0xdeb060, // a pale-wood post marker (the scout's guidepost), distinct from the darker trunk
  projectile: 0xe8dcc0, // the pale wooden arrow shaft — read by drawArrow (not the generic box path)
};

/** The arrow's shaft length / head size / stroke width (px at world scale) — sized to read as a
 *  munition next to a ~24 px settler without dominating it. */
const ARROW_LENGTH = 22;
const ARROW_HEAD = 5;
const ARROW_STROKE = 2;

/** How high (world px) above its ground anchor the arrow flies — roughly a settler's torso, so a shot
 *  crosses between fighters instead of skimming their feet. A drawn-look choice, tunable by eye. */
export const PROJECTILE_FLIGHT_HEIGHT = 14;

/**
 * The in-flight munition marker: a fletched arrow authored pointing screen-east (+x) so the pool
 * rotates it to the {@link import('../../data/scene/draw-item.js').DrawItem.rotation} flight heading.
 * A drawn-shape approximation: no decoded arrow bob exists in the extracted `[bobseq]` lanes (only
 * character bodies), so this minimal sprite is the named fallback until the effects bmds are decoded.
 */
function drawArrow(g: Graphics): Graphics {
  const colour = KIND_COLOURS.projectile;
  const tail = -ARROW_LENGTH / 2;
  const tip = ARROW_LENGTH / 2;
  g.moveTo(tail, 0).lineTo(tip, 0).stroke({ color: colour, width: ARROW_STROKE });
  g.moveTo(tip, 0)
    .lineTo(tip - ARROW_HEAD, -ARROW_HEAD / 2)
    .lineTo(tip - ARROW_HEAD, ARROW_HEAD / 2)
    .closePath()
    .fill({ color: 0x707070 }); // an iron head, darker than the shaft
  g.moveTo(tail, 0)
    .lineTo(tail + ARROW_HEAD, -ARROW_HEAD / 2)
    .moveTo(tail, 0)
    .lineTo(tail + ARROW_HEAD, ARROW_HEAD / 2)
    .stroke({ color: colour, width: 1 }); // the fletching
  return g;
}

/** The feet-local body dimensions the placeholder marker is drawn at, by kind (see {@link drawPlaceholder}). */
export function placeholderBody(kind: SpriteKind): { bodyW: number; bodyH: number } {
  if (kind === 'building') return { bodyW: 28, bodyH: 40 };
  if (kind === 'stockpile') return { bodyW: 20, bodyH: 12 }; // a low, wide heap/flag base
  if (kind === 'projectile') return { bodyW: ARROW_LENGTH, bodyH: ARROW_HEAD }; // the arrow's own extent
  return { bodyW: 14, bodyH: 24 };
}

/**
 * Draw a feet-anchored sprite placeholder into `g`, relative to its container origin `(0,0)`: a small
 * footprint diamond on the ground + a body box rising from it, coloured by kind — so an unbound entity
 * (or the no-atlas default) still shows depth-sortable geometry. Built once per entity (kind is stable);
 * only its visibility toggles per frame.
 */
export function drawPlaceholder(g: Graphics, kind: SpriteKind): Graphics {
  if (kind === 'projectile') return drawArrow(g); // an arrow, not a box — rotated to its flight heading
  const colour = KIND_COLOURS[kind];
  const { bodyW, bodyH } = placeholderBody(kind);
  g.moveTo(0, -5).lineTo(9, 0).lineTo(0, 5).lineTo(-9, 0).closePath().fill({ color: 0x000000, alpha: 0.3 });
  g.rect(-bodyW / 2, -bodyH, bodyW, bodyH)
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  return g;
}
