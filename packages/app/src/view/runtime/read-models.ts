import { lastByTypeId } from '@open-northland/data';
import { type Simulation, systems } from '@open-northland/sim';
import { flagPointByType, soldierFlagPointByType } from '../../content/building-gfx/index.js';
import { loadIr } from '../../content/ir/load.js';
import { workerRoleOf } from '../../game/sandbox/index.js';
import { makeOverlayFrameSource, makeSignpostOverlaySource } from '../placement-overlay.js';
import {
  type BuildingDoorInfo,
  createSnapshotProjections,
  type FogGates,
  type GeometryBuildingInfo,
  type HeartSelection,
} from '../projections/index.js';

export interface ViewReadModelDeps {
  readonly sim: Simulation;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly localPlayer: number;
  readonly fogGates: FogGates;
  /** Owner slot → team-colour slot for the life hearts; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** The selection the life-heart projection reads; absent = nothing selected. */
  readonly selection?: HeartSelection | undefined;
}

/** The union both index readers need: the geometry overlay's slice plus the sign chain's anchors. */
export interface ViewBuildingInfo
  extends GeometryBuildingInfo,
    Pick<BuildingDoorInfo, 'flagPoint' | 'mastPoint'> {}

/** One index per building type, carrying the extracted sign-post and garrison-mast anchors. */
export function buildingIndex(
  buildings: Simulation['content']['buildings'],
  flagPoints: ReadonlyMap<number, { readonly x: number; readonly y: number }>,
  mastPoints: ReadonlyMap<number, { readonly x: number; readonly y: number }> = new Map(),
): ReadonlyMap<number, ViewBuildingInfo> {
  return new Map(
    [...lastByTypeId(buildings)].map(([typeId, b]) => [
      typeId,
      {
        id: b.id,
        footprint: b.footprint,
        flagPoint: flagPoints.get(typeId),
        mastPoint: mastPoints.get(typeId),
      },
    ]),
  );
}

export interface ViewReadModels extends ReturnType<typeof createSnapshotProjections> {
  /** A good's display name by sim goodType, falling back to its id. */
  readonly goodLabel: (typeId: number) => string | undefined;
  readonly buildingDoors: ReadonlyMap<number, ViewBuildingInfo>;
  /** The memoized build-mode band probe and its erect-signpost twin. */
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
}

export async function createViewReadModels(deps: ViewReadModelDeps): Promise<ViewReadModels> {
  const { sim, mapSize, localPlayer, fogGates } = deps;
  const goodLabelByType = new Map(sim.content.goods.map((g) => [g.typeId, g.name ?? g.id]));
  const ir = await loadIr();
  const buildingDoors = buildingIndex(sim.content.buildings, flagPointByType(ir), soldierFlagPointByType(ir));
  return {
    goodLabel: (typeId) => goodLabelByType.get(typeId),
    buildingDoors,
    overlayFrame: makeOverlayFrameSource(sim, mapSize, localPlayer),
    signpostOverlayFrame: makeSignpostOverlaySource(sim, mapSize, localPlayer),
    ...createSnapshotProjections(buildingDoors, workerRoleOf, fogGates, {
      // The same content read the sim's capture drive keys on.
      isLivestockTribe: (tribe) => systems.isCatchableAnimal(sim.content, tribe),
      playerColourOf: deps.playerColourOf,
      selection: deps.selection,
    }),
  };
}
