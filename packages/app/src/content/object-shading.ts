import type { FootprintCell } from '@open-northland/data';
import type { BrightnessField } from '@open-northland/render';
import type { ContentIr } from './ir/rows.js';

/**
 * The `[landscapetype]` names whose objects the original draws full-bright, exempt from the baked
 * `embr` shading: standing + felled trees. Measured on the bridge-map corpus (source basis
 * "brightness"): tree canopies keep full luminance even anchored on embr=0 border cells (ratio ≈ 1.0
 * across the lane, n=118), while mine decals, stones and grass track the lane (masked opaque-pixel
 * ratio ×0.58 → ×1.58). Only standing trees were measured; `tree falling` is grouped with them by
 * kinship (same art family mid-fall), not by measurement. The true engine rule is unknown, so this
 * name-pinned exemption is the measured boundary and an approximation beyond it.
 */
const UNSHADED_LANDSCAPE_TYPES: ReadonlySet<string> = new Set(['tree', 'tree falling']);

/**
 * The logicType ids whose objects stay full-bright ({@link UNSHADED_LANDSCAPE_TYPES}), resolved from
 * the IR `[landscapetype]` table by name so no numeric id hardcodes.
 */
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
 * the ground cells its footprint covers. A footprint-less record (the flat decals) has nothing to
 * average over, so its own cell stands.
 *
 * Approximation: the original folds a single shade argument into a bob's alpha blit, and no readable
 * source says which cell it reads for a bob spanning many.
 */
export function footprintBrightness(
  field: BrightnessField,
  hx: number,
  hy: number,
  footprint: readonly FootprintCell[],
): number {
  if (footprint.length === 0) return field.brightnessAt(hx / 2, hy / 2);
  let sum = 0;
  for (const cell of footprint) sum += field.brightnessAt((hx + cell.dx) / 2, (hy + cell.dy) / 2);
  return sum / footprint.length;
}
