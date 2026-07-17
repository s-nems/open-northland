import type { BuildingHighlightItem } from '@open-northland/render';
import { ONE, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTypeOf,
  builtFractionOf,
  entityById,
  familiesByHome,
  type HomeFamily,
  isAdult,
  isBuilding,
  isSettler,
  marriageOf,
  ownerPlayerOf,
  type SnapshotEntity,
} from '../../../game/snapshot.js';

/**
 * The "przypisz dom" (assign a home) highlight — the pure snapshot projection behind the action-ring
 * button + the green/red house tint, the residential twin of `assign-highlight.ts`. Green = an own,
 * built `home` with a free family slot for this settler's family (`homeSize` — the original
 * `logichomesize` 1..5 by level — counts FAMILIES, see {@link familiesByHome}). The sim's `assignHouse`
 * command re-validates on click; this is the at-a-glance candidacy the player reads. KNOWN GAP: like
 * the workplace wash, signpost confinement is not mirrored — under `setSignpostNavigation` an
 * out-of-area home still washes green and the click is refused by the sim (ticketed:
 * docs/tickets/app/assign-builder-refusal-cue.md).
 */

/** The slice of a building type this projection needs: the residence discriminant + its capacity. */
export interface HouseInfo {
  readonly kind?: string | undefined;
  readonly homeSize?: number | undefined;
}

/** The settler's household — itself, its living spouse, their still-growing child (the sim `familyOf`
 *  mirrored over the snapshot). */
export function familyIdsOf(snapshot: WorldSnapshot, settlerId: number): number[] {
  const e = entityById(snapshot, settlerId);
  if (e === undefined || !isSettler(e)) return [];
  const family = [settlerId];
  const marriage = marriageOf(e);
  if (marriage !== undefined) {
    if (entityById(snapshot, marriage.spouse) !== undefined) family.push(marriage.spouse);
    const childId = marriage.child;
    const child = childId !== null ? entityById(snapshot, childId) : undefined;
    if (childId !== null && child !== undefined && !isAdult(child)) family.push(childId);
  }
  return family;
}

/** True when the building is a completed residence (`built` at ONE and a `home`-kind type). */
function isBuiltHome(e: SnapshotEntity, housesByType: ReadonlyMap<number, HouseInfo>): boolean {
  if (!isBuilding(e) || e.components.UnderConstruction !== undefined) return false;
  const built = builtFractionOf(e);
  if (built === undefined || built < ONE) return false;
  const typeId = buildingTypeOf(e);
  return typeId !== undefined && housesByType.get(typeId)?.kind === 'home';
}

/** Whether `house` may take this settler's family: a free family slot beside the OTHER households
 *  already living there (the mover's own family keeps its slot on a same-home re-assign). */
function houseFitsFamily(
  house: SnapshotEntity,
  family: readonly number[],
  families: readonly HomeFamily[] | undefined,
  housesByType: ReadonlyMap<number, HouseInfo>,
): boolean {
  const typeId = buildingTypeOf(house);
  const size = (typeId !== undefined ? housesByType.get(typeId)?.homeSize : undefined) ?? 0;
  const members = new Set(family);
  const others = (families ?? []).filter((fam) => !fam.members.some((m) => members.has(m))).length;
  return others + 1 <= size;
}

/**
 * The house-assignment verdicts for a selected settler over every own built home: green when the
 * family fits, red otherwise. Non-home buildings (and other owners') are skipped, never tinted.
 */
export function computeHouseHighlight(
  snapshot: WorldSnapshot,
  settlerId: number,
  housesByType: ReadonlyMap<number, HouseInfo>,
): BuildingHighlightItem[] {
  const settler = entityById(snapshot, settlerId);
  if (settler === undefined || !isSettler(settler)) return [];
  const family = familyIdsOf(snapshot, settlerId);
  const families = familiesByHome(snapshot);
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    if (!isBuiltHome(e, housesByType)) continue;
    if (ownerPlayerOf(e) !== ownerPlayerOf(settler)) continue; // only the settler's own homes
    items.push({ id: e.id, ok: houseFitsFamily(e, family, families.get(e.id), housesByType) });
  }
  return items;
}

/**
 * The click-resolution twin of {@link computeHouseHighlight} for ONE building: true when the click
 * should issue `assignHouse` (a green home), false when it cancels (red / not a home at all).
 */
export function houseAssignableAt(
  snapshot: WorldSnapshot,
  buildingId: number,
  settlerId: number,
  housesByType: ReadonlyMap<number, HouseInfo>,
): boolean {
  const settler = entityById(snapshot, settlerId);
  const house = entityById(snapshot, buildingId);
  if (settler === undefined || !isSettler(settler) || house === undefined) return false;
  if (!isBuiltHome(house, housesByType)) return false;
  if (ownerPlayerOf(house) !== ownerPlayerOf(settler)) return false;
  const families = familiesByHome(snapshot).get(buildingId);
  return houseFitsFamily(house, familyIdsOf(snapshot, settlerId), families, housesByType);
}
