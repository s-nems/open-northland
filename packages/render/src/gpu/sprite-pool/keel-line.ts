import type { AtlasFrame } from '../../data/sprites/atlas.js';
import type { AlphaMask } from './alpha-mask.js';
import { maskSolidAt } from './alpha-mask.js';

/** Columns sampled across a frame for its keel line. */
const KEEL_COLUMNS = 24;

/** Per frame, so a hull's scan runs once per bob rather than per drawn frame. */
const keelCache = new WeakMap<AtlasFrame, Int16Array>();

/**
 * The bottom edge of the lowest solid texel in each of {@link KEEL_COLUMNS} columns across `frame`, as
 * frame-local `(x, y)` pairs; empty columns are skipped. For a hull drawn above the water, that edge is
 * where it meets the water.
 */
export function keelLine(mask: AlphaMask, frame: AtlasFrame): Int16Array {
  const cached = keelCache.get(frame);
  if (cached !== undefined) return cached;
  const points: number[] = [];
  const columns = Math.min(KEEL_COLUMNS, frame.width);
  for (let c = 0; c < columns; c++) {
    const lx = Math.floor(((c + 0.5) * frame.width) / columns);
    for (let ly = frame.height - 1; ly >= 0; ly--) {
      if (!maskSolidAt(mask, frame.x + lx, frame.y + ly)) continue;
      points.push(lx, ly + 1);
      break;
    }
  }
  const keel = Int16Array.from(points);
  keelCache.set(frame, keel);
  return keel;
}
