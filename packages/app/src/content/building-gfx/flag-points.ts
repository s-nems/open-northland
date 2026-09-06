import type { BuildingFlagPointRow, ContentIr } from '../ir/rows.js';
import { CANONICAL_EDIT_NAME, rowsByType } from './families.js';

/** A building's marker anchor in screen px from its bob draw anchor, +y down. */
export interface FlagPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The per-typeId sign-post anchor from the IR's `buildingFlagPoints` lane (`GfxFlagPoint`), for one tribe's
 * skin: the point is a per-skin pixel offset, so another tribe's value would misplace the chain. A typeId
 * with no row keeps the caller's derived fallback anchor.
 */
export function flagPointByType(ir: ContentIr | null, tribeId: number): ReadonlyMap<number, FlagPoint> {
  return pointsByType(ir?.buildingFlagPoints, tribeId);
}

/**
 * The per-typeId garrison mast from the IR's `buildingSoldierFlagPoints` lane (`gfxsoldierflagpoint`),
 * resolved like {@link flagPointByType}. The tribe key earns its keep here: the frank tower authors a
 * different height from the viking one on the same typeId. Only the tower records carry the key, which is
 * the source's own statement of which buildings hold a garrison.
 */
export function soldierFlagPointByType(
  ir: ContentIr | null,
  tribeId: number,
): ReadonlyMap<number, FlagPoint> {
  return pointsByType(ir?.buildingSoldierFlagPoints, tribeId);
}

/** The typeIds a tribe draws with a body of its own. A tribe that skins a type but authors no anchor for
 *  it must not borrow another tribe's, whose offsets belong to a differently shaped building. */
export function skinnedTypesOf(ir: ContentIr | null, tribeId: number): ReadonlySet<number> {
  const out = new Set<number>();
  for (const row of ir?.buildingBobs ?? []) if (row.tribeId === tribeId) out.add(row.typeId);
  return out;
}

function pointsByType(
  rows: readonly BuildingFlagPointRow[] | undefined,
  tribeId: number,
): ReadonlyMap<number, FlagPoint> {
  const out = new Map<number, FlagPoint>();
  for (const [typeId, group] of rowsByType(rows ?? [], tribeId)) {
    const row = pickFlagPointRow(typeId, group);
    if (row !== undefined) out.set(typeId, { x: row.x, y: row.y });
  }
  return out;
}

/** The {@link CANONICAL_EDIT_NAME} row when named, else highest level, then the lowest offset - mirroring
 *  `pickCanonicalBuildingRow`'s ladder with a value tiebreak, since a flag-point row carries no bobId.
 *  Accepted divergence: a multi-variant typeId without a canonical name may take its point from a different
 *  variant record than the drawn bob; in the extracted data no such collision differs in value, on either
 *  lane, for any of the five civilizations. */
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
