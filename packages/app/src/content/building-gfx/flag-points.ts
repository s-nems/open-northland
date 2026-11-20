import type { ErasedRegion, FiringPost, FiringPostLookup } from '@open-northland/render';
import {
  GARRISON_FINIALS,
  PLACED_GARRISON_MASTS,
  type PlacedGarrisonMast,
  TOWER_FIRING_POSTS,
} from '../../catalog/building-tweaks.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import type { BuildingBobRow, BuildingFlagPointRow, ContentIr } from '../ir/rows.js';
import { CANONICAL_EDIT_NAME, perTypeHouseRows, rowsByType } from './families.js';

/** A building's marker anchor in screen px from its bob draw anchor, +y down. */
export interface FlagPoint {
  readonly x: number;
  readonly y: number;
}

/** A garrison mast, the height from which down its flag draws behind the building, and the finial the
 *  flag replaces. */
export interface MastPoint extends FlagPoint {
  readonly behindFrom?: number;
  readonly replaces?: ErasedRegion;
}

/** A flag-point row, or a garrison mast the catalog places where no record authors one. */
type MastRow = BuildingFlagPointRow & Pick<PlacedGarrisonMast, 'behindFrom'>;

/**
 * The per-typeId sign-post anchor from the IR's `buildingFlagPoints` lane (`GfxFlagPoint`), for one tribe's
 * skin: the point is a per-skin pixel offset, so another tribe's value would misplace the chain. A typeId
 * with no row keeps the caller's derived fallback anchor.
 */
export function flagPointByType(ir: ContentIr | null, tribeId: number): ReadonlyMap<number, FlagPoint> {
  return pointsByType(perTypeHouseRows(ir)?.buildingFlagPoints, tribeId);
}

/**
 * The per-typeId garrison mast from the IR's `buildingSoldierFlagPoints` lane (`gfxsoldierflagpoint`),
 * resolved like {@link flagPointByType}. The tribe key earns its keep here: the frank tower authors a
 * different height from the viking one on the same typeId. Only the viking and frank tower records
 * author the key; the other towers take `PLACED_GARRISON_MASTS`.
 */
export function soldierFlagPointByType(
  ir: ContentIr | null,
  tribeId: number,
): ReadonlyMap<number, MastPoint> {
  const perType = perTypeHouseRows(ir);
  const authored = perType?.buildingSoldierFlagPoints ?? [];
  const rows = [...authored, ...placedMastRows(perType?.buildingBobs ?? [], authored)];
  return pointsByType(rows, tribeId, GARRISON_FINIALS);
}

/** The firing post of each `(tribe, typeId)` whose house rows name a record `TOWER_FIRING_POSTS` measures;
 *  any other building keeps the renderer's default post. */
export function firingPostLookup(ir: ContentIr | null): FiringPostLookup {
  const posts = new Map<string, FiringPost>();
  for (const { tribeId, typeId, editName } of perTypeHouseRows(ir)?.buildingBobs ?? []) {
    const post = editName === undefined ? undefined : TOWER_FIRING_POSTS.get(editName);
    if (post !== undefined) posts.set(`${tribeId}:${typeId}`, post);
  }
  return (tribe, buildingType) => posts.get(`${tribe}:${buildingType}`);
}

/** A mast row per level of each tower record the catalog places a mast on, unless the record's
 *  `(tribe, type)` authors its own. */
function placedMastRows(
  bobs: readonly BuildingBobRow[],
  authored: readonly BuildingFlagPointRow[],
): MastRow[] {
  const masted = new Set(authored.map((row) => `${row.tribeId}:${row.typeId}`));
  const out: MastRow[] = [];
  for (const { tribeId, typeId, level, editName } of bobs) {
    if (editName === undefined) continue;
    const mast = PLACED_GARRISON_MASTS.get(editName);
    if (mast === undefined || masted.has(`${tribeId}:${typeId}`)) continue;
    out.push({ tribeId, typeId, level, editName, ...mast });
  }
  return out;
}

/** The typeIds a tribe draws with a body of its own. A tribe that skins a type but authors no anchor for
 *  it must not borrow another tribe's, whose offsets belong to a differently shaped building. */
export function skinnedTypesOf(ir: ContentIr | null, tribeId: number): ReadonlySet<number> {
  const out = new Set<number>();
  for (const row of ir?.buildingBobs ?? []) if (row.tribeId === tribeId) out.add(row.typeId);
  return out;
}

/** A building type's sign post and garrison mast, as one tribe's skin authors them. */
export interface BuildingSignAnchors {
  readonly flagPoint?: FlagPoint | undefined;
  readonly mastPoint?: MastPoint | undefined;
}

/**
 * The per-`(typeId, tribe)` sign anchors of a world fielding `tribes`, the first of which is the base.
 * A tribe resolves through its own rows and borrows the base tribe's only for a type it does not skin:
 * the offsets are measured against one body, so on a tribe's own differently shaped body they would
 * plant the post or the mast off the roof. Such a type keeps the caller's derived anchor instead.
 */
export function buildingSignAnchorsFor(
  ir: ContentIr | null,
  tribes: WorldTribes,
): (typeId: number, tribe: number | undefined) => BuildingSignAnchors {
  const base = tribes[0];
  const byTribe = new Map(
    tribes.map((tribe) => [
      tribe,
      {
        flag: flagPointByType(ir, tribe),
        mast: soldierFlagPointByType(ir, tribe),
        skinned: skinnedTypesOf(ir, tribe),
      },
    ]),
  );
  return (typeId, tribe) => {
    const own = tribe !== undefined ? byTribe.get(tribe) : undefined;
    const fallback = own?.skinned.has(typeId) === true ? undefined : byTribe.get(base);
    const flagPoint = own?.flag.get(typeId) ?? fallback?.flag.get(typeId);
    const mastPoint = own?.mast.get(typeId) ?? fallback?.mast.get(typeId);
    return {
      ...(flagPoint !== undefined ? { flagPoint } : {}),
      ...(mastPoint !== undefined ? { mastPoint } : {}),
    };
  };
}

function pointsByType(
  rows: readonly MastRow[] | undefined,
  tribeId: number,
  finials?: ReadonlyMap<string, ErasedRegion>,
): ReadonlyMap<number, MastPoint> {
  const out = new Map<number, MastPoint>();
  for (const [typeId, group] of rowsByType(rows ?? [], tribeId)) {
    const row = pickFlagPointRow(typeId, group);
    if (row === undefined) continue;
    const { x, y, behindFrom } = row;
    const replaces = row.editName !== undefined ? finials?.get(row.editName) : undefined;
    out.set(typeId, {
      x,
      y,
      ...(behindFrom !== undefined ? { behindFrom } : {}),
      ...(replaces !== undefined ? { replaces } : {}),
    });
  }
  return out;
}

/** The {@link CANONICAL_EDIT_NAME} row when named, else highest level, then the lowest offset - mirroring
 *  `pickCanonicalBuildingRow`'s ladder with a value tiebreak, since a flag-point row carries no bobId.
 *  Accepted divergence: a multi-variant typeId without a canonical name may take its point from a different
 *  variant record than the drawn bob; in the extracted data no such collision differs in value, on either
 *  lane, for any of the five civilizations. */
function pickFlagPointRow<T extends BuildingFlagPointRow>(typeId: number, rows: readonly T[]): T | undefined {
  let candidates = rows;
  const canonName = CANONICAL_EDIT_NAME[typeId];
  if (canonName !== undefined) {
    const named = rows.filter((r) => r.editName === canonName);
    if (named.length > 0) candidates = named;
  }
  let best: T | undefined;
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
