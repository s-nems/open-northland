import { lastByTypeId } from '@open-northland/data';
import type { Simulation } from '@open-northland/sim';
import { flagPointByType } from '../../content/building-gfx/index.js';
import { loadIr } from '../../content/ir/load.js';
import { workerRoleOf } from '../../game/sandbox/index.js';
import { makeOverlayFrameSource, makeSignpostOverlaySource } from '../placement-overlay.js';
import {
  type BuildingDoorInfo,
  createSnapshotProjections,
  type FogGates,
  type GeometryBuildingInfo,
} from '../projections/index.js';

export interface ViewReadModelDeps {
  readonly sim: Simulation;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly localPlayer: number;
  readonly fogGates: FogGates;
}

/** What both readers of the index need: the geometry overlay's slice plus the sign chain's anchor.
 *  Neither consumer's own type covers the other, so the index publishes their union. */
export interface ViewBuildingInfo extends GeometryBuildingInfo, Pick<BuildingDoorInfo, 'flagPoint'> {}

/** One shared index for the door badges and the geometry overlay, each type carrying its extracted
 *  sign-post anchor when the content has one. */
export function buildingIndex(
  buildings: Simulation['content']['buildings'],
  flagPoints: ReadonlyMap<number, { readonly x: number; readonly y: number }>,
): ReadonlyMap<number, ViewBuildingInfo> {
  return new Map(
    [...lastByTypeId(buildings)].map(([typeId, b]) => [
      typeId,
      { id: b.id, footprint: b.footprint, flagPoint: flagPoints.get(typeId) },
    ]),
  );
}

export interface ViewReadModels extends ReturnType<typeof createSnapshotProjections> {
  /** A good's display name by sim goodType, falling back to its id. The one localized name source, so
   *  the ground-pile tooltip and the admin spawn palette cannot drift apart. */
  readonly goodLabel: (typeId: number) => string | undefined;
  readonly buildingDoors: ReadonlyMap<number, ViewBuildingInfo>;
  /** The memoized build-mode band probe and its erect-signpost twin (shown while the scout's placement
   *  click is pending). */
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
}

export async function createViewReadModels(deps: ViewReadModelDeps): Promise<ViewReadModels> {
  const { sim, mapSize, localPlayer, fogGates } = deps;
  const goodLabelByType = new Map(sim.content.goods.map((g) => [g.typeId, g.name ?? g.id]));
  const buildingDoors = buildingIndex(sim.content.buildings, flagPointByType(await loadIr()));
  return {
    goodLabel: (typeId) => goodLabelByType.get(typeId),
    buildingDoors,
    overlayFrame: makeOverlayFrameSource(sim, mapSize, localPlayer),
    signpostOverlayFrame: makeSignpostOverlaySource(sim, mapSize, localPlayer),
    ...createSnapshotProjections(buildingDoors, workerRoleOf, fogGates),
  };
}
