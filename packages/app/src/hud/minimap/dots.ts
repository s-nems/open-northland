import {
  fogTileVisible,
  halfCellToScreen,
  ONE,
  tileToScreenX,
  tileToScreenY,
  type WorldBounds,
} from '@open-northland/render';
import { roadShardOf } from '@open-northland/render/data';
import {
  cellOfNode,
  type DiplomacyState,
  entitiesWith,
  entityById,
  FOG_STATE,
  type FogView,
  type WorldSnapshot,
} from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import {
  isWildlife,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  workFlagOf,
} from '../../game/snapshot.js';
import type { MinimapFilters, MinimapScope } from './filters.js';
import type { MinimapMark } from './stamps.js';

/** Fallback dot colour for a player outside the swatch table. */
const UNKNOWN_PLAYER_DOT_COLOUR = 0xffffff;
/** Animals keep one fauna tint whoever owns them, so a herd never reads as a crowd of settlers. */
export const ANIMAL_DOT_COLOUR = 0xd8c595;
/** Laid roads are ground, drawn as a faint earth line; ordered road sites a shade darker. */
export const ROAD_DOT_COLOUR = 0xd2bf8f;
export const ROAD_SITE_DOT_COLOUR = 0x9a8a6a;

export interface MinimapDotContext {
  readonly fog: FogView | null;
  readonly bounds: WorldBounds;
  /** Raster px per projected world px. */
  readonly scale: number;
  /** The map's width in half-cell nodes, the stride of a road shard's node ids. */
  readonly nodeWidth: number;
  readonly filters: MinimapFilters;
  /** A soldier or hero trade, read from the running content's job roles. */
  readonly isFighterJob: (jobType: number) => boolean;
  /** The seat the view shows; null on a whole-map view, where every scope shows every owner. */
  readonly viewer: number | null;
  /** The viewer seat's stance toward `owner`. */
  readonly stanceToward: (owner: number) => DiplomacyState;
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** A plotted marker: raster-px centre `(bx, by)`, its shape and packed `0xRRGGBB` colour. Loose primitives
 *  keep the sink itself free of allocation. */
export type MinimapDotSink = (bx: number, by: number, mark: MinimapMark, colour: number) => void;

/** Whether an owned marker of `owner` passes the scope as seen from `viewer`. */
export function scopeAdmits(
  scope: MinimapScope,
  owner: number,
  viewer: number | null,
  stanceToward: (owner: number) => DiplomacyState,
): boolean {
  if (scope === 'everyone' || viewer === null) return true;
  if (owner === viewer) return scope === 'mine';
  if (scope === 'mine') return false;
  return stanceToward(owner) === (scope === 'friendly' ? 'friend' : 'enemy');
}

/** The component indexes the plot reads, for the frame's index registry. */
export function readMinimapIndexes(snapshot: WorldSnapshot): void {
  for (const name of ['Building', 'Settler', 'Signpost', 'WorkFlag', 'RoadSite'])
    entitiesWith(snapshot, name);
}

/**
 * Plot the enabled layers of `snapshot` in the ground raster's px, bottom to top: roads, signposts and
 * flags, buildings, animals and people, vehicles. Each layer walks only its own component index, so a
 * replot costs the plotted entities and road nodes, never the whole entity list.
 */
export function forEachMinimapDot(
  snapshot: WorldSnapshot,
  ctx: MinimapDotContext,
  sink: MinimapDotSink,
): void {
  const { layers, scope } = ctx.filters;
  const { fog, bounds, scale } = ctx;
  const admits = (owner: number): boolean => scopeAdmits(scope, owner, ctx.viewer, ctx.stanceToward);
  const colourOf = (player: number): number =>
    PLAYER_SWATCH_COLORS[(ctx.playerColourOf?.(player) ?? player) % PLAYER_SWATCH_COLORS.length] ??
    UNKNOWN_PLAYER_DOT_COLOUR;
  // Only currently-visible ground plots an entity; the viewer's own forces always see their own cell.
  const plot = (e: SnapshotEntity, mark: MinimapMark, colour: number): void => {
    const at = positionOf(e);
    if (at === undefined) return;
    const col = at.x / ONE;
    const row = at.y / ONE;
    if (fog !== null && !fogTileVisible(fog, col, row)) return;
    sink(
      (tileToScreenX(col, row) - bounds.minX) * scale,
      (tileToScreenY(row) - bounds.minY) * scale,
      mark,
      colour,
    );
  };

  if (layers.roads) {
    // Laid roads are ground paint: they show wherever the ground does, explored or visible.
    for (const carrier of entitiesWith(snapshot, 'RoadShard')) {
      const shard = roadShardOf(carrier);
      if (shard === null) continue;
      for (const node of shard.nodes) {
        const hx = node % ctx.nodeWidth;
        const hy = (node - hx) / ctx.nodeWidth;
        if (fog !== null) {
          const cell = cellOfNode(hx, hy);
          if (fog.stateAt(cell.cx, cell.cy) === FOG_STATE.UNEXPLORED) continue;
        }
        const at = halfCellToScreen(hx, hy);
        sink((at.x - bounds.minX) * scale, (at.y - bounds.minY) * scale, 'road', ROAD_DOT_COLOUR);
      }
    }
    for (const site of entitiesWith(snapshot, 'RoadSite')) {
      const owner = ownerPlayerOf(site);
      if (owner === undefined || admits(owner)) plot(site, 'roadSite', ROAD_SITE_DOT_COLOUR);
    }
  }

  if (layers.signposts) {
    for (const post of entitiesWith(snapshot, 'Signpost')) {
      const owner = ownerPlayerOf(post);
      if (owner !== undefined && admits(owner)) plot(post, 'signpost', colourOf(owner));
    }
    // A delivery flag carries no owner; its gatherer's is the flag's, one gatherer per flag.
    for (const gatherer of entitiesWith(snapshot, 'WorkFlag')) {
      const owner = ownerPlayerOf(gatherer);
      const flagId = workFlagOf(gatherer);
      if (owner === undefined || flagId === undefined || !admits(owner)) continue;
      const flag = entityById(snapshot, flagId);
      if (flag !== undefined) plot(flag, 'signpost', colourOf(owner));
    }
  }

  if (layers.buildings) {
    for (const building of entitiesWith(snapshot, 'Building')) {
      const owner = ownerPlayerOf(building);
      if (owner !== undefined && admits(owner)) plot(building, 'building', colourOf(owner));
    }
  }

  if (layers.civilians || layers.soldiers || layers.animals) {
    for (const settler of entitiesWith(snapshot, 'Settler')) {
      const owner = ownerPlayerOf(settler);
      if (isWildlife(settler)) {
        // Wildlife has no owner and ignores the scope; claimed livestock follows its owner's.
        if (layers.animals && (owner === undefined || admits(owner)))
          plot(settler, 'animal', ANIMAL_DOT_COLOUR);
        continue;
      }
      if (owner === undefined || !admits(owner)) continue;
      const job = settlerJobType(settler);
      const soldier = job !== undefined && ctx.isFighterJob(job);
      if (soldier ? layers.soldiers : layers.civilians)
        plot(settler, soldier ? 'soldier' : 'civilian', colourOf(owner));
    }
  }

  if (layers.vehicles) {
    for (const vehicle of entitiesWith(snapshot, 'Vehicle')) {
      const owner = ownerPlayerOf(vehicle);
      // A vehicle a ship carries stands nowhere on the map.
      const carrier = (vehicle.components.Vehicle as { carrier?: unknown }).carrier ?? null;
      if (owner !== undefined && carrier === null && admits(owner)) plot(vehicle, 'vehicle', colourOf(owner));
    }
  }
}
