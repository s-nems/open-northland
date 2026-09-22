import type { BuildingType } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTribeOf,
  buildingTypeOf,
  isBuilding,
  isFinishedBuilding,
  isSettler,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerTribeOf,
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
  /** Which buildings are candidates at all; the rest are skipped, never tinted. */
  readonly candidate: (building: SnapshotEntity, byType: ReadonlyMap<number, BuildingInfo>) => boolean;
  /** Whether a candidate of the settler's own tribe takes this settler. */
  readonly accepts: (building: SnapshotEntity, settler: SnapshotEntity) => boolean;
}

function ownBuildingPick(rule: PickRule): OwnBuildingPick {
  const fits = (building: SnapshotEntity, settler: SnapshotEntity): boolean =>
    buildingTribeOf(building) === settlerTribeOf(settler) && rule.accepts(building, settler);
  return {
    highlight(snapshot, settlerIds, byType) {
      const settlers: SnapshotEntity[] = [];
      for (const id of settlerIds) {
        const settler = entityById(snapshot, id);
        if (settler !== undefined && isSettler(settler)) settlers.push(settler);
      }
      const items: BuildingHighlightItem[] = [];
      if (settlers.length === 0) return items;
      for (const e of snapshot.entities) {
        if (!rule.candidate(e, byType)) continue;
        const owned = settlers.filter((settler) => ownerPlayerOf(e) === ownerPlayerOf(settler));
        if (owned.length > 0) items.push({ id: e.id, ok: owned.some((settler) => fits(e, settler)) });
      }
      return items;
    },
    assignableAt(snapshot, buildingId, settlerId, byType) {
      const settler = entityById(snapshot, settlerId);
      const building = entityById(snapshot, buildingId);
      if (settler === undefined || !isSettler(settler) || building === undefined) return false;
      if (!rule.candidate(building, byType) || ownerPlayerOf(building) !== ownerPlayerOf(settler))
        return false;
      return fits(building, settler);
    },
  };
}

/** The foundations a builder may be pinned to. */
export const sitePick: OwnBuildingPick = ownBuildingPick({
  candidate: (building) => isBuilding(building) && building.components.UnderConstruction !== undefined,
  accepts: () => true,
});

/** The standing training houses a settler may drill at; the one it already drills at refuses a repeat. */
export const drillPick: OwnBuildingPick = ownBuildingPick({
  candidate: (building, byType) => {
    if (!isFinishedBuilding(building)) return false;
    const typeId = buildingTypeOf(building);
    const def = typeId !== undefined ? byType.get(typeId) : undefined;
    return def !== undefined && systems.isBarracksType(def);
  },
  accepts: (building, settler) => trainingHouseOf(settler) !== building.id,
});
