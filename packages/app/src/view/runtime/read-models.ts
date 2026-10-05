import { buildingFootprintFor, lastByTypeId } from '@open-northland/data';
import type { BuildingTypeBinding } from '@open-northland/render';
import type { SignpostReachView } from '@open-northland/sim';
import { systems } from '@open-northland/sim';
import { buildingSignAnchorsFor } from '../../content/building-gfx/index.js';
import { loadIr } from '../../content/ir/load.js';
import type { ContentIr } from '../../content/ir/rows.js';
import { workerRoleOf } from '../../game/sandbox/index.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import type { SessionHost } from '../../session/index.js';
import {
  makeDockOverlaySource,
  makeLitOverlaySource,
  makeOverlayFrameSource,
  makeSignpostOverlaySource,
} from '../placement-overlay.js';
import {
  type BuildingDoorInfo,
  type BuildingDoorInfoOf,
  createSnapshotProjections,
  type FogGates,
  type GeometryBuildingInfo,
  type GeometryBuildingInfoOf,
  type HeartSelection,
} from '../projections/index.js';
import type { PlacementProbeViews } from './placement-gates.js';

export interface ViewReadModelDeps {
  readonly authoredBuildings?: BuildingTypeBinding['byEntity'];
  readonly signpostReach?: (player: number) => SignpostReachView | null;
  readonly inventoryVersion?: () => number;
  /** The placement answers the overlays walk, shared with the click gates. */
  readonly probes: PlacementProbeViews;
  readonly host: SessionHost;
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The seat that places and probes; the HUD figures follow `viewer` instead. */
  readonly localPlayer: number;
  readonly viewer: ViewerSeat;
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

/** The building read models by type and tribe: the footprint the tribe builds the type with, plus the
 *  per-skin sign-post and garrison-mast anchors. */
export function buildingModels(
  buildings: SessionHost['content']['buildings'],
  ir: ContentIr | null,
  tribes: WorldTribes,
  authored?: BuildingTypeBinding['byEntity'],
): { readonly geometryOf: GeometryBuildingInfoOf; readonly infoOf: BuildingDoorInfoOf } {
  const byType = lastByTypeId(buildings);
  const anchorsOf = buildingSignAnchorsFor(ir, tribes);
  // Memoized per `(typeId, tribe)`: the door-badge and sign projections ask for every building on every
  // new snapshot, and the answer only changes when the content does.
  const geometryCache = new Map<string, GeometryBuildingInfo | undefined>();
  const geometryOf: GeometryBuildingInfoOf = (typeId, tribe) => {
    if (typeId === undefined) return undefined;
    const skin = tribe ?? tribes[0];
    const key = `${typeId}:${skin}`;
    const held = geometryCache.get(key);
    if (held !== undefined || geometryCache.has(key)) return held;
    const b = byType.get(typeId);
    const geometry = b === undefined ? undefined : { id: b.id, footprint: buildingFootprintFor(b, skin) };
    geometryCache.set(key, geometry);
    return geometry;
  };
  const cache = new Map<string, BuildingDoorInfo | undefined>();
  const canonicalInfoOf: BuildingDoorInfoOf = (typeId, tribe) => {
    if (typeId === undefined) return undefined;
    const key = `${typeId}:${tribe ?? tribes[0]}`;
    const held = cache.get(key);
    if (held !== undefined || cache.has(key)) return held;
    const geometry = geometryOf(typeId, tribe);
    const info = geometry === undefined ? undefined : { ...geometry, ...anchorsOf(typeId, tribe) };
    cache.set(key, info);
    return info;
  };
  const authoredInfo = new Map<number, BuildingDoorInfo>();
  for (const [id, row] of authored ?? []) {
    const info = canonicalInfoOf(row.typeId, row.tribe);
    if (info !== undefined) authoredInfo.set(id, { ...info, flagPoint: row.flagPoint });
  }
  const infoOf: BuildingDoorInfoOf = (typeId, tribe, entity) => {
    const row = entity === undefined ? undefined : authored?.get(entity);
    if (entity !== undefined && row !== undefined && row.typeId === typeId && row.tribe === tribe) {
      return authoredInfo.get(entity);
    }
    return canonicalInfoOf(typeId, tribe);
  };
  return { geometryOf, infoOf };
}

export interface ViewReadModels extends ReturnType<typeof createSnapshotProjections> {
  /** A good's display name by sim goodType, falling back to its id. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** Per-type, per-tribe geometry for the debug overlay; the anchors travel with the projections. */
  readonly buildingGeometry: GeometryBuildingInfoOf;
  /** The memoized build-mode band probe and its erect-signpost twin. */
  readonly overlayFrame: ReturnType<typeof makeOverlayFrameSource>;
  readonly signpostOverlayFrame: ReturnType<typeof makeSignpostOverlaySource>;
  /** The wash that lights a started line's reach or another tool's node set. */
  readonly litOverlayFrame: ReturnType<typeof makeLitOverlaySource>;
  readonly dockOverlayFrame: ReturnType<typeof makeDockOverlaySource>;
}

export async function createViewReadModels(deps: ViewReadModelDeps): Promise<ViewReadModels> {
  const { host, mapSize, localPlayer, fogGates } = deps;
  const goodLabelByType = new Map(host.content.goods.map((g) => [g.typeId, g.name ?? g.id]));
  const ir = await loadIr();
  const buildings = buildingModels(host.content.buildings, ir, deps.tribes, deps.authoredBuildings);
  return {
    goodLabel: (typeId) => goodLabelByType.get(typeId),
    buildingGeometry: buildings.geometryOf,
    overlayFrame: makeOverlayFrameSource(deps.probes, host, mapSize, localPlayer),
    signpostOverlayFrame: makeSignpostOverlaySource(deps.probes, host, mapSize, localPlayer),
    litOverlayFrame: makeLitOverlaySource(deps.probes, host, mapSize, localPlayer),
    dockOverlayFrame: makeDockOverlaySource(deps.probes, host, mapSize, localPlayer),
    ...createSnapshotProjections(
      deps.viewer,
      buildings.infoOf,
      workerRoleOf,
      fogGates,
      {
        // The same content read the sim's capture drive keys on.
        isLivestockTribe: (tribe) => systems.isCatchableAnimal(host.content, tribe),
        playerColourOf: deps.playerColourOf,
        selection: deps.selection,
      },
      deps.seatNameOf,
      deps.signpostReach,
      deps.inventoryVersion,
    ),
  };
}
