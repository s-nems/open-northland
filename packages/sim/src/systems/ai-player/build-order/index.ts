import type { BuildingType } from '@open-northland/data';
import {
  aiPlayerEntity,
  Building,
  playerPlacementTribes,
  StalledPlacement,
  type StalledPlacementState,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import { seatBaseOf } from '../base.js';
import { AI_DECISION_INTERVAL_TICKS } from '../cadence.js';
import { buildingTypeByContentId } from '../content-lookup.js';
import type { AiPlayerModule } from '../index.js';
import { anchorCentroid, anchorNodeOf } from '../node-geometry.js';
import { ownedBuildings } from '../seat-roster.js';
import {
  BASE_REPLACEMENT_ENTRY,
  type BuildOrderEntry,
  MAX_ACTIVE_CONSTRUCTION_SITES,
  STALLED_PLACEMENT_RETRY_DECISIONS,
} from './entries.js';
import { placementSpot } from './placement.js';
import { entryStatus, type LiveResourceMemo, upgradeCandidate } from './progress.js';
import { firstUncoveredBuilding, towerPlacementSpot } from './tower-coverage.js';

export * from './entries.js';
export {
  collectorGoodsWanted,
  type EntryStatus,
  entryStatuses,
} from './progress.js';
export { TOWER_CONTENT_IDS, TOWER_DEFENCE_RADIUS_NODES } from './tower-coverage.js';

/**
 * Acts on the first unmet entry, so a razed building is re-placed before any entry the seat has not
 * reached yet. An unmet entry with no legal action stalls rather than being skipped: most retry next
 * decision, a placement that found no spot every {@link STALLED_PLACEMENT_RETRY_DECISIONS} decisions.
 * Builders are never pinned to a site; the builder drive picks its own.
 */
export function buildOrderModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'houseBuild',
    run: (world, ctx, player) => runBuildOrder(world, ctx, player, order),
  };
}

function runBuildOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const owned = ownedBuildings(world, player);
  let sites = 0;
  for (const e of owned) {
    if (world.has(e, UnderConstruction)) sites++;
  }
  if (sites >= MAX_ACTIVE_CONSTRUCTION_SITES) return [];

  const tribe = playerPlacementTribes(world, player)?.[0];
  const base = seatBaseOf(world, ctx, player);
  if (base === null) {
    return tribe === undefined ? [] : replaceMissingBase(world, ctx, terrain, player, owned, tribe);
  }
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return [];
  const index = contentIndex(ctx.content);

  const live: LiveResourceMemo = new Map();
  for (const [entryIndex, entry] of order.entries()) {
    const status = entryStatus(world, ctx, player, owned, entry, live);
    if (status !== 'unmet') continue;
    const stall = placementStall(world, player, entryIndex);
    switch (entry.kind) {
      case 'place': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return [];
        if (stall !== null && ctx.tick < stall.retryTick) return [];
        const spot = placementSpot(world, ctx, terrain, player, owned, anchor, type, entry);
        recordPlacementSearch(world, player, entryIndex, spot === null, ctx.tick);
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
      case 'upgrade': {
        const target = buildingTypeByContentId(ctx.content, entry.building);
        if (target === undefined) return []; // unreachable after 'skip', kept for the type system
        const candidate = upgradeCandidate(world, index, owned, target);
        if (candidate === null) return [];
        const building = world.get(candidate, Building);
        const nextTier = index.buildings.get(building.buildingType)?.upgradeTarget;
        if (nextTier === undefined || !buildingEnabled(world, ctx, player, building.tribe, nextTier))
          return [];
        return [{ kind: 'upgradeBuilding', building: candidate }];
      }
      case 'collector':
        return []; // the workforce module hires it
      case 'towerCoverage': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return [];
        const target = firstUncoveredBuilding(world, ctx, player, owned);
        if (target === null) return []; // status said unmet - defensive
        const spot = towerPlacementSpot(world, ctx, terrain, player, owned, anchor, type, target);
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
    }
  }
  return [];
}

/** The seat's stall record when it names `entryIndex`; a record for any other entry is dropped, since
 *  the entry that stalled is no longer the one acting. */
function placementStall(
  world: World,
  player: number,
  entryIndex: number,
): Readonly<StalledPlacementState> | null {
  const carrier = aiPlayerEntity(world, player);
  const stall = carrier === null ? undefined : world.tryGet(carrier, StalledPlacement);
  if (carrier === null || stall === undefined) return null;
  if (stall.entry === entryIndex) return stall;
  world.remove(carrier, StalledPlacement);
  return null;
}

/** Arm the retry after a search that found no spot, or clear the record after one that did. A seat with
 *  no AI carrier (a module run directly) keeps no record and searches every decision. */
function recordPlacementSearch(
  world: World,
  player: number,
  entryIndex: number,
  stalled: boolean,
  tick: number,
): void {
  const carrier = aiPlayerEntity(world, player);
  if (carrier === null) return;
  if (!stalled) {
    world.remove(carrier, StalledPlacement);
    return;
  }
  const retryTick = tick + STALLED_PLACEMENT_RETRY_DECISIONS * AI_DECISION_INTERVAL_TICKS;
  world.add(carrier, StalledPlacement, { entry: entryIndex, retryTick });
}

function siteCommand(
  type: BuildingType,
  spot: HalfCellNode,
  tribe: number,
  player: number,
): Extract<PlayerCommand, { kind: 'placeBuilding' }> {
  return {
    kind: 'placeBuilding',
    buildingType: type.typeId,
    x: spot.hx,
    y: spot.hy,
    tribe,
    owner: player,
    underConstruction: true,
  };
}

/** A seat that holds buildings but no base rebuilds one at the centroid of what stands. */
function replaceMissingBase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  tribe: number,
): readonly PlayerCommand[] {
  const centre = anchorCentroid(world, owned);
  if (centre === null) return [];
  const type = buildingTypeByContentId(ctx.content, BASE_REPLACEMENT_ENTRY.building);
  if (type === undefined) return []; // content without the warehouse expresses no replacement
  const spot = placementSpot(world, ctx, terrain, player, owned, centre, type, BASE_REPLACEMENT_ENTRY);
  if (spot === null) return [];
  return [siteCommand(type, spot, tribe, player)];
}
