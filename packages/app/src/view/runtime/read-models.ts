import { lastByTypeId } from '@open-northland/data';
import { type Simulation, systems } from '@open-northland/sim';
import { buildingSignAnchorsFor } from '../../content/building-gfx/index.js';
import { loadIr } from '../../content/ir/load.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { workerRoleOf } from '../../game/sandbox/index.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { makeOverlayFrameSource, makeSignpostOverlaySource } from '../placement-overlay.js';
import {
  type BuildingDoorInfo,
  type BuildingDoorInfoOf,
  createSnapshotProjections,
  type FogGates,
  type GeometryBuildingInfo,
  type HeartSelection,
} from '../projections/index.js';

export interface ViewReadModelDeps {
  readonly placementTribe?: number;
  readonly sim: Simulation;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly localPlayer: number;
  readonly fogGates: FogGates;
  /** The civilizations this world fields: the tribes whose building anchors are indexed. */
  readonly tribes: WorldTribes;
  /** Owner slot → team-colour slot for the life hearts; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** Owner slot → the roster's authored seat name for the stats header; absent = the slot id. */
  readonly seatNameOf?: ((player: number) => string | undefined) | undefined;
  /** The selection the life-heart projection reads; absent = nothing selected. */
  readonly selection?: HeartSelection | undefined;
}

/** The building read models: the geometry every type shares, plus the per-skin sign-post and
 *  garrison-mast anchors. */
export function buildingModels(
  buildings: Simulation['content']['buildings'],
  ir: ContentIr | null,
  tribes: WorldTribes,
): { readonly byType: ReadonlyMap<number, GeometryBuildingInfo>; readonly infoOf: BuildingDoorInfoOf } {
  const byType = new Map(
    [...lastByTypeId(buildings)].map(([typeId, b]) => [
      typeId,
      { id: b.id, footprint: b.footprint } satisfies GeometryBuildingInfo,
    ]),
  );
  const anchorsOf = buildingSignAnchorsFor(ir, tribes);
  // Memoized per `(typeId, tribe)`: the door-badge and sign projections ask for every building on every
  // new snapshot, and the answer only changes when the content does.
  const cache = new Map<string, BuildingDoorInfo | undefined>();
  const infoOf: BuildingDoorInfoOf = (typeId, tribe) => {
    if (typeId === undefined) return undefined;
    const key = `${typeId}:${tribe ?? tribes[0]}`;
    const held = cache.get(key);
    if (held !== undefined || cache.has(key)) return held;
    const geometry = byType.get(typeId);
    const info = geometry === undefined ? undefined : { ...geometry, ...anchorsOf(typeId, tribe) };
    cache.set(key, info);
    return info;
  };
  return { byType, infoOf };
}

export interface ViewReadModels extends ReturnType<typeof createSnapshotProjections> {
  /** A good's display name by sim goodType, falling back to its id. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** Per-type geometry for the debug overlay; the per-tribe anchors travel with the projections. */
  readonly buildingDoors: ReadonlyMap<number, GeometryBuildingInfo>;
  /** The memoized build-mode band probe and its erect-signpost twin. */
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
}

export async function createViewReadModels(deps: ViewReadModelDeps): Promise<ViewReadModels> {
  const { sim, mapSize, localPlayer, fogGates } = deps;
  const goodLabelByType = new Map(sim.content.goods.map((g) => [g.typeId, g.name ?? g.id]));
  const ir = await loadIr();
  const buildings = buildingModels(sim.content.buildings, ir, deps.tribes);
  return {
    goodLabel: (typeId) => goodLabelByType.get(typeId),
    buildingDoors: buildings.byType,
    overlayFrame: makeOverlayFrameSource(sim, mapSize, localPlayer, deps.placementTribe),
    signpostOverlayFrame: makeSignpostOverlaySource(sim, mapSize, localPlayer),
    ...createSnapshotProjections(
      localPlayer,
      buildings.infoOf,
      workerRoleOf,
      fogGates,
      {
        // The same content read the sim's capture drive keys on.
        isLivestockTribe: (tribe) => systems.isCatchableAnimal(sim.content, tribe),
        playerColourOf: deps.playerColourOf,
        selection: deps.selection,
      },
      deps.seatNameOf,
    ),
  };
}
