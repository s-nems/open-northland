import type { BuildingType } from '@open-northland/data';
import { playerPlacementTribes, UnderConstruction } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { seatBaseOf } from '../base.js';
import { buildingTypeByContentId } from '../content-lookup.js';
import type { AiPlayerModule } from '../index.js';
import { anchorCentroid, anchorNodeOf } from '../node-geometry.js';
import { ownedBuildings } from '../seat-roster.js';
import { BASE_REPLACEMENT_ENTRY, type BuildOrderEntry, MAX_ACTIVE_CONSTRUCTION_SITES } from './entries.js';
import { placementSpot } from './placement.js';
import { entryStatus, upgradeCandidate } from './progress.js';
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
 * reached yet. An unmet entry with no legal action stalls and is retried next decision rather than
 * skipped. Builders are never pinned to a site; the builder drive picks its own.
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

  for (const entry of order) {
    const status = entryStatus(world, ctx, player, owned, entry);
    if (status !== 'unmet') continue;
    switch (entry.kind) {
      case 'place': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        const spot = placementSpot(world, ctx, terrain, player, owned, anchor, type, entry);
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
      case 'upgrade': {
        const target = buildingTypeByContentId(ctx.content, entry.building);
        if (target === undefined) return []; // unreachable after 'skip', kept for the type system
        const candidate = upgradeCandidate(world, index, owned, target);
        if (candidate === null) return [];
        return [{ kind: 'upgradeBuilding', building: candidate }];
      }
      case 'collector':
        return []; // the workforce module hires it
      case 'towerCoverage': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        const target = firstUncoveredBuilding(world, ctx, player, owned);
        if (target === null) return []; // status said unmet - defensive
        const spot = towerPlacementSpot(world, ctx, terrain, player, owned, anchor, type, target);
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
    }
  }
  return [];
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
