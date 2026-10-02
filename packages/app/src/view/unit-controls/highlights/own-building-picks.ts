import type { BuildingType } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import { entitiesWith, entityById, systems, type WorldSnapshot } from '@open-northland/sim';
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
} from '../../../game/snapshot.js';
import { entitiesUnder, idsGroupedBy } from '../../../game/snapshot-id-index.js';

/** The slice of a building type these picks read. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/**
 * A pick over the player's own buildings: every candidate of a selected member's owner lights up, green
 * when it accepts one member, red otherwise. The simulation command re-checks the walk on arrival.
 */
export interface OwnBuildingPick {
  highlight(
    snapshot: WorldSnapshot,
    settlerIds: readonly number[],
    byType: ReadonlyMap<number, BuildingInfo>,
  ): BuildingHighlightItem[];
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
  /** Which buildings are candidates at all; the rest are skipped, never tinted. */
  readonly candidate: (building: SnapshotEntity, byType: ReadonlyMap<number, BuildingInfo>) => boolean;
  /** Whether a candidate takes this settler. */
  readonly accepts: (building: SnapshotEntity, settler: SnapshotEntity, snapshot: WorldSnapshot) => boolean;
}

function ownBuildingPick(rule: PickRule): OwnBuildingPick {
  return {
    highlight(snapshot, settlerIds, byType) {
      const settlers = settlersIn(snapshot, settlerIds);
      const items: BuildingHighlightItem[] = [];
      if (settlers.length === 0) return items;
      if (rule.ownedBy === undefined) {
        for (const e of entitiesWith(snapshot, 'Building')) {
          if (!rule.candidate(e, byType)) continue;
          const owned = settlers.filter((settler) => ownerPlayerOf(e) === ownerPlayerOf(settler));
          if (owned.length > 0)
            items.push({ id: e.id, ok: owned.some((settler) => rule.accepts(e, settler, snapshot)) });
        }
        return items;
      }
      const owners = new Set(settlers.map(ownerPlayerOf));
      for (const owner of owners) {
        if (owner === undefined) continue;
        const owned = settlers.filter((settler) => ownerPlayerOf(settler) === owner);
        for (const e of rule.ownedBy(snapshot, owner)) {
          if (rule.candidate(e, byType))
            items.push({ id: e.id, ok: owned.some((settler) => rule.accepts(e, settler, snapshot)) });
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

/** The barracks a settler may drill at; the one it already drills at refuses a repeat. */
export const drillPick: OwnBuildingPick = ownBuildingPick({
  candidate: houseOrFoundationOfType(systems.isBarracksType),
  accepts: (building, settler) => trainingHouseOf(settler) !== building.id,
});

/** The schools; the course dialog a pick opens decides per course who may still learn it. */
export const schoolPick: OwnBuildingPick = ownBuildingPick({
  candidate: houseOrFoundationOfType(systems.isSchoolType),
  accepts: () => true,
});
