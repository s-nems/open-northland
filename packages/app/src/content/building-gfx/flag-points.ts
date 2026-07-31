import type { BuildingFlagPointRow, ContentIr } from '../ir/rows.js';
import { CANONICAL_EDIT_NAME, rowsByType, VIKING_TRIBE } from './families.js';

/** A building's sign-post anchor in screen px from its bob draw anchor (+y down) - `GfxFlagPoint`. */
export interface FlagPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The per-typeId sign-post anchor from the IR's `buildingFlagPoints` lane, restricted to the tribe skin
 * the render draws ({@link VIKING_TRIBE} - the point is a per-skin pixel offset, so another tribe's
 * value would misplace the chain on our sprite). Variant rows sharing one typeId resolve like the bob
 * binding: the {@link CANONICAL_EDIT_NAME} row when named (the HQ), else highest level, then the
 * lexicographically lowest offset - deterministic and insertion-order-independent. A typeId with no row
 * keeps the caller's derived fallback anchor.
 */
export function flagPointByType(ir: ContentIr | null): ReadonlyMap<number, FlagPoint> {
  const out = new Map<number, FlagPoint>();
  const byType = rowsByType(ir?.buildingFlagPoints ?? [], VIKING_TRIBE);
  for (const [typeId, rows] of byType) {
    const row = pickFlagPointRow(typeId, rows);
    if (row !== undefined) out.set(typeId, { x: row.x, y: row.y });
  }
  return out;
}

/** Mirrors `pickCanonicalBuildingRow`'s name+level policy with a value tiebreak instead of bobId
 *  (a flag-point row has none). Accepted divergence: a multi-variant typeId without a canonical name
 *  may take its point from a different variant record than the drawn bob; for the real viking data
 *  every such collision is value-identical. */
function pickFlagPointRow(
  typeId: number,
  rows: readonly BuildingFlagPointRow[],
): BuildingFlagPointRow | undefined {
  let candidates = rows;
  const canonName = CANONICAL_EDIT_NAME[typeId];
  if (canonName !== undefined) {
    const named = rows.filter((r) => r.editName === canonName);
    if (named.length > 0) candidates = named;
  }
  let best: BuildingFlagPointRow | undefined;
  for (const r of candidates) {
    if (
      best === undefined ||
      r.level > best.level ||
      (r.level === best.level && (r.x < best.x || (r.x === best.x && r.y < best.y)))
    ) {
      best = r;
    }
  }
  return best;
}
