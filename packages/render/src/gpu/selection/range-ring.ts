import { Mesh, MeshGeometry, Texture } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';

export const RANGE_RING_KINDS = ['work', 'defence', 'blessing'] as const;
export type RangeRingKind = (typeof RANGE_RING_KINDS)[number];

/** The distance a range is counted in: Manhattan half-cell nodes, or map points (hex distance). */
export type RangeMetric = 'manhattan' | 'hex';

/** One range circle: the entity it centres on, its radius in half-cell nodes counted in `metric`, and what
 *  the range is of. */
export interface RangeRing {
  readonly entity: number;
  readonly radiusNodes: number;
  readonly metric: RangeMetric;
  readonly kind: RangeRingKind;
}

/** A dashed, unfilled outline, so the ground under it still reads: amber for where a worker works, red for
 *  where a defence-mode building shoots, pale blue for a temple blessing. */
const RANGE_RING_COLOR: Readonly<Record<RangeRingKind, number>> = {
  work: 0xffc020,
  defence: 0xe03a2a,
  blessing: 0xc5edff,
};
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
 * The share of a range's radius its ellipse spans east-west and north-south, the largest ellipse that fits
 * inside the range's true shape, so it never promises ground the range does not cover. A Manhattan range is
 * a diamond whose inscribed ellipse spans 1/√2 of it both ways. A map-point range is a hexagon with flat
 * north and south sides: its inscribed ellipse touches them and spans √3/2 of it east-west.
 */
const INSCRIBED_SHARE: Readonly<Record<RangeMetric, { readonly x: number; readonly y: number }>> = {
  manhattan: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  hex: { x: Math.sqrt(3) / 2, y: 1 },
};

/** The ring's stroke as triangles, for a mesh that owns its buffers. */
export interface RangeRingStroke {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** A flat ground ellipse inside a `metric` range of `radiusNodes` around the origin, in the colour of
 *  `kind`. It draws from its own geometry, never from buffers Pixi pools between Graphics, and frees that
 *  geometry when destroyed. */
export function mintRangeRing(radiusNodes: number, metric: RangeMetric, kind: RangeRingKind): Mesh {
  const rx = radiusNodes * NODE_WIDTH_PX;
  const share = INSCRIBED_SHARE[metric];
  const { positions, indices } = rangeRingStroke(rx * share.x, rx * ISO_RATIO * share.y);
  const geometry = new MeshGeometry({ positions, uvs: new Float32Array(positions.length), indices });
  geometry.batchMode = 'no-batch';
  const ring = new Mesh({ geometry, texture: Texture.WHITE });
  ring.tint = RANGE_RING_COLOR[kind];
  ring.alpha = RANGE_RING_ALPHA;
  ring.once('destroyed', () => geometry.destroy());
  return ring;
}

/** An ellipse's outline as dashes of {@link RANGE_RING_DASH} split by {@link RANGE_RING_GAP}, measured
 *  along the outline so the flattened north and south arcs dash as densely as the east and west ones. Each
 *  dash is one strip {@link RANGE_RING_WIDTH} wide. */
export function rangeRingStroke(rx: number, ry: number): RangeRingStroke {
  const positions: number[] = [];
  const indices: number[] = [];
  const circumference = 2 * Math.PI * Math.max(rx, ry);
  const steps = Math.ceil((circumference / RANGE_RING_DASH) * RANGE_RING_STEPS_PER_DASH);
  let px = rx;
  let py = 0;
  let along = 0;
  let pen = true;
  let dash: number[] = [px, py];
  for (let i = 1; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    if (pen) {
      dash.push(x, y);
    } else {
      appendStrip(dash, positions, indices);
      dash = [x, y];
    }
    along += Math.hypot(x - px, y - py);
    if (along >= (pen ? RANGE_RING_DASH : RANGE_RING_GAP)) {
      along = 0;
      pen = !pen;
    }
    px = x;
    py = y;
  }
  appendStrip(dash, positions, indices);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Append the polyline `points` (x, y pairs) as a strip {@link RANGE_RING_WIDTH} wide: two vertices per
 *  point, offset across the direction its neighbours run in. A lone point draws nothing. */
function appendStrip(points: readonly number[], positions: number[], indices: number[]): void {
  const count = points.length / 2;
  if (count < 2) return;
  const first = positions.length / 2;
  const half = RANGE_RING_WIDTH / 2;
  for (let i = 0; i < count; i++) {
    const before = Math.max(0, i - 1);
    const after = Math.min(count - 1, i + 1);
    const dx = (points[2 * after] ?? 0) - (points[2 * before] ?? 0);
    const dy = (points[2 * after + 1] ?? 0) - (points[2 * before + 1] ?? 0);
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    const x = points[2 * i] ?? 0;
    const y = points[2 * i + 1] ?? 0;
    positions.push(x + nx, y + ny, x - nx, y - ny);
    if (i === 0) continue;
    const a = first + 2 * (i - 1);
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}
