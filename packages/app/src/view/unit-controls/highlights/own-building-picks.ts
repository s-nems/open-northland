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
  settlerTribeOf,
  siteTribeOf,
  trainingHouseOf,
} from '../../../game/snapshot.js';

/** The slice of a building type these picks read. */
type BuildingInfo = Pick<BuildingType, 'kind' | 'workers'>;

/**
 * A pick over the player's own buildings: every candidate of a selected member's owner lights up, green
 * when it is one member's tribe and accepts that member, red otherwise. The simulation command re-checks
 * the walk on arrival.
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
  /** The components whose entities may be candidates; a building's alone when absent. */
  readonly kinds?: readonly string[];
  /** Which buildings are candidates at all; the rest are skipped, never tinted. */
  readonly candidate: (building: SnapshotEntity, byType: ReadonlyMap<number, BuildingInfo>) => boolean;
  /** Whether a candidate of the settler's own tribe takes this settler. */
  readonly accepts: (building: SnapshotEntity, settler: SnapshotEntity, snapshot: WorldSnapshot) => boolean;
}

function ownBuildingPick(rule: PickRule): OwnBuildingPick {
  const kinds = rule.kinds ?? BUILDINGS_ONLY;
  const fits = (building: SnapshotEntity, settler: SnapshotEntity, snapshot: WorldSnapshot): boolean =>
    siteTribeOf(building) === settlerTribeOf(settler) && rule.accepts(building, settler, snapshot);
  return {
    highlight(snapshot, settlerIds, byType) {
      const settlers = settlersIn(snapshot, settlerIds);
      const items: BuildingHighlightItem[] = [];
      if (settlers.length === 0) return items;
      for (const kind of kinds) {
        for (const e of entitiesWith(snapshot, kind)) {
          if (!rule.candidate(e, byType)) continue;
          const owned = settlers.filter((settler) => ownerPlayerOf(e) === ownerPlayerOf(settler));
          if (owned.length > 0)
            items.push({ id: e.id, ok: owned.some((settler) => fits(e, settler, snapshot)) });
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
      return fits(building, settler, snapshot);
    },
  };
}

const BUILDINGS_ONLY: readonly string[] = ['Building'];

/** The foundations, damaged buildings, wall sites and road sites a builder may be pinned to; a full
 *  repair crew refuses more. */
export const sitePick: OwnBuildingPick = ownBuildingPick({
  kinds: ['Building', 'Palisade', 'RoadSite'],
  candidate: (site) =>
    isBuilding(site)
      ? site.components.UnderConstruction !== undefined || site.components.Damaged !== undefined
      : isRoadSite(site) || (isPalisade(site) && site.components.UnderConstruction !== undefined),
  accepts: (building, settler, snapshot) => builderCrewHasRoom(snapshot, building, settler),
});

const finishedOfType =
  (is: (def: BuildingInfo) => boolean) =>
  (building: SnapshotEntity, byType: ReadonlyMap<number, BuildingInfo>): boolean => {
    if (!isFinishedBuilding(building)) return false;
    const typeId = buildingTypeOf(building);
    const def = typeId !== undefined ? byType.get(typeId) : undefined;
    return def !== undefined && is(def);
  };

/** The standing barracks a settler may drill at; the one it already drills at refuses a repeat. */
export const drillPick: OwnBuildingPick = ownBuildingPick({
  candidate: finishedOfType(systems.isBarracksType),
  accepts: (building, settler) => trainingHouseOf(settler) !== building.id,
});

/** The standing schools; the course dialog a pick opens decides per course who may still learn it. */
export const schoolPick: OwnBuildingPick = ownBuildingPick({
  candidate: finishedOfType(systems.isSchoolType),
  accepts: () => true,
});
