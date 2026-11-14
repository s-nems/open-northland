import type { BuildingType, ContentSet } from '@open-northland/data';
import type { TargetMark } from '@open-northland/render';
import { entitiesWith, entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { entitiesUnder, idsGroupedBy } from '../../../game/snapshot/id-index.js';
import {
  builderCrewHasRoom,
  buildingTypeOf,
  isBuilding,
  isFinishedBuilding,
  isPalisade,
  isRoadSite,
  isSettler,
  ownerPlayerOf,
  type SnapshotEntity,
  settlersIn,
  trainingHouseOf,
} from '../../../game/snapshot/index.js';
import { coinDrillersAt } from '../orders/coin-drill.js';
import { markOf } from './target-mark.js';

/** The slice of a building type these picks read. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/**
 * A pick over the player's own buildings: every candidate of a selected member's owner is judged, lit
 * when it accepts one member, refused otherwise. The simulation command re-checks the walk on arrival.
 */
export interface OwnBuildingPick {
  highlight(
    snapshot: WorldSnapshot,
    settlerIds: readonly number[],
    byType: ReadonlyMap<number, BuildingInfo>,
  ): TargetMark[];
  assignableAt(
    snapshot: WorldSnapshot,
    buildingId: number,
    settlerId: number,
    byType: ReadonlyMap<number, BuildingInfo>,
  ): boolean;
}

interface PickRule {
  /** `owner`'s entities that may be candidates; every building, filtered by owner, when absent. */
  readonly ownedBy?: (snapshot: WorldSnapshot, owner: number) => readonly SnapshotEntity[];
  /** Which buildings are candidates at all; the rest are skipped, never marked. */
  readonly candidate: (building: SnapshotEntity, byType: ReadonlyMap<number, BuildingInfo>) => boolean;
  /** Whether a candidate takes this settler. */
  readonly accepts: (building: SnapshotEntity, settler: SnapshotEntity, snapshot: WorldSnapshot) => boolean;
}

function ownBuildingPick(rule: PickRule): OwnBuildingPick {
  return {
    highlight(snapshot, settlerIds, byType) {
      const settlers = settlersIn(snapshot, settlerIds);
      const items: TargetMark[] = [];
      if (settlers.length === 0) return items;
      if (rule.ownedBy === undefined) {
        for (const e of entitiesWith(snapshot, 'Building')) {
          if (!rule.candidate(e, byType)) continue;
          const owned = settlers.filter((settler) => ownerPlayerOf(e) === ownerPlayerOf(settler));
          if (owned.length > 0)
            items.push(
              markOf(
                e.id,
                owned.some((settler) => rule.accepts(e, settler, snapshot)),
              ),
            );
        }
        return items;
      }
      const owners = new Set(settlers.map(ownerPlayerOf));
      for (const owner of owners) {
        if (owner === undefined) continue;
        const owned = settlers.filter((settler) => ownerPlayerOf(settler) === owner);
        for (const e of rule.ownedBy(snapshot, owner)) {
          if (rule.candidate(e, byType))
            items.push(
              markOf(
                e.id,
                owned.some((settler) => rule.accepts(e, settler, snapshot)),
              ),
            );
        }
      }
      return items;
    },
    assignableAt(snapshot, buildingId, settlerId, byType) {
      const settler = entityById(snapshot, settlerId);
      const building = entityById(snapshot, buildingId);
      if (settler === undefined || !isSettler(settler) || building === undefined) return false;
      if (!rule.candidate(building, byType) || ownerPlayerOf(building) !== ownerPlayerOf(settler))
        return false;
      return rule.accepts(building, settler, snapshot);
    },
  };
}

function isBuilderSite(site: SnapshotEntity): boolean {
  return isBuilding(site)
    ? site.components.UnderConstruction !== undefined || site.components.Damaged !== undefined
    : isRoadSite(site) || (isPalisade(site) && site.components.UnderConstruction !== undefined);
}

/** Each owner's foundations, damaged buildings, wall sites and road sites, kept per change: a settled
 *  map's standing walls never enter it. */
const BUILDER_SITES_BY_OWNER = idsGroupedBy(
  (e) => (isBuilderSite(e) ? ownerPlayerOf(e) : undefined),
  'builder sites by owner',
  { values: ['Owner'], presence: ['Building', 'Palisade', 'RoadSite', 'UnderConstruction', 'Damaged'] },
);

/** `owner`'s sites a builder may be pinned to. */
export function builderSitesOf(snapshot: WorldSnapshot, owner: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, BUILDER_SITES_BY_OWNER, owner);
}

/** The foundations, damaged buildings, wall sites and road sites a builder may be pinned to; a full
 *  repair crew refuses more. */
export const sitePick: OwnBuildingPick = ownBuildingPick({
  ownedBy: builderSitesOf,
  candidate: isBuilderSite,
  accepts: (building, settler, snapshot) => builderCrewHasRoom(snapshot, building, settler),
});

/** A standing house of the type or its foundation: a settler sent to a foundation waits at its door. */
const houseOrFoundationOfType =
  (is: (def: BuildingInfo) => boolean) =>
  (building: SnapshotEntity, byType: ReadonlyMap<number, BuildingInfo>): boolean => {
    const foundation = isBuilding(building) && building.components.UnderConstruction !== undefined;
    if (!foundation && !isFinishedBuilding(building)) return false;
    const typeId = buildingTypeOf(building);
    const def = typeId !== undefined ? byType.get(typeId) : undefined;
    return def !== undefined && is(def);
  };

const isBarracksOrFoundation = houseOrFoundationOfType(systems.isBarracksType);

/** The barracks a settler may drill at; the one it already drills at refuses a repeat. */
export const drillPick: OwnBuildingPick = ownBuildingPick({
  candidate: isBarracksOrFoundation,
  accepts: (building, settler) => trainingHouseOf(settler) !== building.id,
});

/** The barracks and barracks foundations of the soldiers' owners, lit where a press would send at least
 *  one of `fighterIds` to coin-drill, refused otherwise. */
export function coinDrillHighlight(
  content: ContentSet,
  snapshot: WorldSnapshot,
  fighterIds: readonly number[],
  byType: ReadonlyMap<number, BuildingInfo>,
): TargetMark[] {
  const fighters = settlersIn(snapshot, fighterIds);
  const items: TargetMark[] = [];
  if (fighters.length === 0) return items;
  for (const e of entitiesWith(snapshot, 'Building')) {
    if (!isBarracksOrFoundation(e, byType)) continue;
    const owned = fighters.filter((settler) => ownerPlayerOf(settler) === ownerPlayerOf(e)).map((f) => f.id);
    if (owned.length > 0)
      items.push(markOf(e.id, coinDrillersAt(content, snapshot, e.id, owned, byType).length > 0));
  }
  return items;
}

/** The schools; the course dialog a pick opens decides per course who may still learn it. */
export const schoolPick: OwnBuildingPick = ownBuildingPick({
  candidate: houseOrFoundationOfType(systems.isSchoolType),
  accepts: () => true,
});
