import { Graphics } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';

export const RANGE_RING_KINDS = ['work', 'defence'] as const;
export type RangeRingKind = (typeof RANGE_RING_KINDS)[number];

/** One range circle: the entity it centres on, its radius in half-cell nodes and what the range is of. */
export interface RangeRing {
  readonly entity: number;
  readonly radiusNodes: number;
  readonly kind: RangeRingKind;
}

/** A dashed, unfilled outline, so the ground under it still reads: amber for where a worker works, red for
 *  where a defence-mode building shoots. */
const RANGE_RING_COLOR: Readonly<Record<RangeRingKind, number>> = { work: 0xffc020, defence: 0xe03a2a };
const RANGE_RING_WIDTH = 2;
const RANGE_RING_ALPHA = 0.8;
/** Dash and gap lengths along the outline, in world px. */
const RANGE_RING_DASH = 16;
const RANGE_RING_GAP = 12;
/** Outline segments per dash, so a dash ends close to its length on any radius. */
const RANGE_RING_STEPS_PER_DASH = 4;
/** World px one half-cell node spans east-west, the unit a range radius is carried in. */
const NODE_WIDTH_PX = TILE_HALF_W;
/** Ground-ellipse squash: a ground circle spans a cell width (2·halfW) E–W but only a row step (halfH) N–S
 *  under the staggered raster. */
const ISO_RATIO = TILE_HALF_H / (2 * TILE_HALF_W);

/**
 * The share of a range's radius its ellipse is drawn at, so the ellipse fits inside the range's true shape
 * and never promises ground the range does not cover. A work area is counted in Manhattan nodes, a diamond
 * whose sides sit 1/√2 of its radius off the centre; a defence range in map points, a hexagon whose slanted
 * sides sit 2/√5 off.
 */
const INSCRIBED_SHARE: Readonly<Record<RangeRingKind, number>> = {
  work: Math.SQRT1_2,
  defence: 2 / Math.sqrt(5),
};

/** A flat ground ellipse inside a range of `radiusNodes` half-cell nodes around the origin, in the colour of
 *  `kind`. */
export function mintRangeRing(radiusNodes: number, kind: RangeRingKind): Graphics {
  const rx = radiusNodes * INSCRIBED_SHARE[kind] * NODE_WIDTH_PX;
  const g = new Graphics();
  traceDashedEllipse(g, rx, rx * ISO_RATIO);
  return g.stroke({ width: RANGE_RING_WIDTH, color: RANGE_RING_COLOR[kind], alpha: RANGE_RING_ALPHA });
}

/** Trace an ellipse's outline as dashes of {@link RANGE_RING_DASH} split by {@link RANGE_RING_GAP}, measured
 *  along the outline so the flattened north and south arcs dash as densely as the east and west ones. */
function traceDashedEllipse(g: Graphics, rx: number, ry: number): void {
  const circumference = 2 * Math.PI * Math.max(rx, ry);
  const steps = Math.ceil((circumference / RANGE_RING_DASH) * RANGE_RING_STEPS_PER_DASH);
  let px = rx;
  let py = 0;
  let along = 0;
  let pen = true;
  g.moveTo(px, py);
  for (let i = 1; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    if (pen) g.lineTo(x, y);
    else g.moveTo(x, y);
    along += Math.hypot(x - px, y - py);
    if (along >= (pen ? RANGE_RING_DASH : RANGE_RING_GAP)) {
      along = 0;
      pen = !pen;
    }
    px = x;
    py = y;
  }
}
