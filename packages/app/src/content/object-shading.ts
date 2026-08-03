import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import type { BrightnessField } from '@open-northland/render';
import type { ContentIr } from './ir/rows.js';

/**
 * The `[landscapetype]` names whose objects the original draws full-bright, exempt from the baked `embr`
 * shading. Measured on the bridge-map corpus (source basis "brightness"): tree canopies keep full
 * luminance even on embr=0 border cells (ratio ≈ 1.0, n=118), while mine decals, stones and grass track
 * the lane (×0.58 → ×1.58). Only standing trees were measured, so grouping `tree falling` with them is an
 * approximation beyond that boundary.
 */
const UNSHADED_LANDSCAPE_TYPES: ReadonlySet<string> = new Set(['tree', 'tree falling']);

/** Resolved from the IR `[landscapetype]` table by name, so no numeric id is hardcoded. */
export function unshadedLogicTypeIds(landscape: ContentIr['landscape']): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const t of landscape ?? []) {
    if (t.typeId !== undefined && t.name !== undefined && UNSHADED_LANDSCAPE_TYPES.has(t.name)) {
      ids.add(t.typeId);
    }
  }
  return ids;
}

/**
 * The multiplier one object placed at half-cell node `(hx, hy)` is graded by: the mean of the lane over
 * the ground cells its footprint covers. A footprint-less record has nothing to average over, so its own
 * cell stands. Approximation: the original folds a single shade argument into a bob's alpha blit, and no
 * readable source says which cell it reads for a bob spanning many.
 */
export function footprintBrightness(
  field: BrightnessField,
  hx: number,
  hy: number,
  footprint: readonly FootprintCell[],
): number {
  if (footprint.length === 0) return field.brightnessAt(hx / 2, hy / 2);
  let sum = 0;
  // The odd-row parity shift (`footprintCellDx`) keeps the sampled ground the cells the sim blocks.
  for (const cell of footprint) {
    sum += field.brightnessAt((hx + footprintCellDx(hy, cell)) / 2, (hy + cell.dy) / 2);
  }
  return sum / footprint.length;
}
