import type { BuildingType } from '@open-northland/data';
import { Building, UnderConstruction } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { seatBaseOf } from '../base.js';
import type { AiPlayerModule } from '../index.js';
import { anchorCentroid, anchorNodeOf, buildingTypeByContentId, ownedBuildings } from '../shared.js';
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
 * The HouseBuild module - the executor over the authored {@link BuildOrderEntry} list. It walks the
 * entries in order, keeps at most {@link MAX_ACTIVE_CONSTRUCTION_SITES} sites open (upgrade sites
 * included), places on the affinity-aware near-base spot, upgrades toward the named tiers, and waits
 * at a `collector` entry for the workforce module's hire. A destroyed building re-enters its
 * entry's count, so the list self-repairs - and because the walk stops at the FIRST unmet entry, a
 * razed building is re-placed before any entry the seat has not reached yet. An unmet entry with no
 * legal action stalls (is retried next decision), never skipped. Builders are not pinned to sites -
 * the organic builder drive already picks the nearest site and fetches materials.
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
): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // a mapless sim has no ground to place on
  const owned = ownedBuildings(world, player);
  let sites = 0;
  for (const e of owned) {
    if (world.has(e, UnderConstruction)) sites++;
  }
  if (sites >= MAX_ACTIVE_CONSTRUCTION_SITES) return [];

  const base = seatBaseOf(world, ctx, player);
  if (base === null) return replaceMissingBase(world, ctx, terrain, player, owned);
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return [];
  const tribe = world.get(base, Building).tribe;
  const index = contentIndex(ctx.content);

  for (const entry of order) {
    const status = entryStatus(world, ctx, player, owned, entry);
    if (status !== 'unmet') continue;
    switch (entry.kind) {
      case 'place': {
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        // One placement per decision: the affinity-aware spot, or a stall when none is legal.
        const spot = placementSpot(world, ctx, terrain, owned, anchor, type, entry);
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
      case 'upgrade': {
        const target = buildingTypeByContentId(ctx.content, entry.building);
        if (target === undefined) return []; // unreachable after 'skip', kept for the type system
        const candidate = upgradeCandidate(world, index, owned, target);
        if (candidate === null) return []; // nothing upgradable yet - stall until one stands
        return [{ kind: 'upgradeBuilding', building: candidate }];
      }
      case 'collector':
        return []; // the workforce module hires it (collectorGoodsWanted) - wait here
      case 'towerCoverage': {
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        const target = firstUncoveredBuilding(world, ctx, player, owned);
        if (target === null) return []; // status said unmet - defensive
        const spot = towerPlacementSpot(world, ctx, terrain, owned, anchor, type, target);
        // No legal covering node stalls the entry, the same contract as 'place'.
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
    }
  }
  return []; // the list is satisfied - the module goes quiet
}

/** The seat's construction site of `type` at `spot`. */
function siteCommand(
  type: BuildingType,
  spot: HalfCellNode,
  tribe: number,
  player: number,
): Extract<Command, { kind: 'placeBuilding' }> {
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

/** The recovery rung, ahead of every ENTRY but behind an already-open site (the one-site gate runs
 *  first): a seat that holds buildings but no base puts up
 *  {@link BASE_REPLACEMENT_ENTRY} at the centroid of what stands. `owned[0]` carries the tribe -
 *  nothing transfers a building between seats, so a seat's buildings share one. */
function replaceMissingBase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
): readonly Command[] {
  const tribeSource = owned[0];
  const centre = anchorCentroid(world, owned);
  if (tribeSource === undefined || centre === null) return [];
  const type = buildingTypeByContentId(ctx.content, BASE_REPLACEMENT_ENTRY.building);
  if (type === undefined) return []; // content without the warehouse expresses no replacement
  const spot = placementSpot(world, ctx, terrain, owned, centre, type, BASE_REPLACEMENT_ENTRY);
  if (spot === null) return []; // no legal spot - stall, the same contract as a 'place' entry
  return [siteCommand(type, spot, world.get(tribeSource, Building).tribe, player)];
}
