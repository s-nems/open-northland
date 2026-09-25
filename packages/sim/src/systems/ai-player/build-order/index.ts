import type { BuildingType } from '@open-northland/data';
import {
  aiPlayerEntity,
  Building,
  BuildOrderFrontier,
  playerPlacementTribes,
  StalledPlacement,
  type StalledPlacementState,
  UnderConstruction,
  Upgrading,
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
import type { FireTest } from '../military/defence/index.js';
import { anchorCentroid, anchorNodeOf } from '../node-geometry.js';
import { ownedBuildings } from '../seat-roster.js';
import {
  BASE_REPLACEMENT_ENTRY,
  BASELESS_CONSTRUCTION_SITES,
  BUILD_ORDER_LOOKAHEAD_ENTRIES,
  type BuildOrderEntry,
  MAX_ACTIVE_CONSTRUCTION_SITES,
  REBUILD_DELAY_TICKS,
  STALLED_PLACEMENT_RETRY_DECISIONS,
} from './entries.js';
import { placementSpot } from './placement.js';
import { entryStatus, type LiveResourceMemo, upgradeCandidate } from './progress.js';
import { type Siege, seatSiege } from './siege.js';
import { coverageOf, coveragePlacementSpot, firstUncoveredBuilding } from './tower-coverage.js';
import { upgradeBillCovered } from './upgrade-supply.js';

export * from './entries.js';
export {
  collectorGoodsWanted,
  type EntryStatus,
  entryStatuses,
} from './progress.js';
export { type Siege, seatSiege } from './siege.js';
export { TOWER_CONTENT_IDS, TOWER_DEFENCE_RADIUS_NODES } from './tower-coverage.js';

/**
 * Acts on the first unmet entry, so a razed building is re-placed, after {@link REBUILD_DELAY_TICKS},
 * before any entry the seat has not reached yet. A placed site meets its entry at once, so up to
 * {@link MAX_ACTIVE_CONSTRUCTION_SITES} entries go up side by side, within
 * {@link BUILD_ORDER_LOOKAHEAD_ENTRIES} of the oldest unfinished one. An unmet entry with no legal action
 * stalls rather than being skipped, so no later site draws off the goods it waits for: most retry next
 * decision, a placement that found no spot every {@link STALLED_PLACEMENT_RETRY_DECISIONS} decisions, and
 * an upgrade holds while a bill good only it or another site could make is not yet in store
 * ({@link upgradeBillCovered}). Builders are never pinned to a site; the builder drive picks its own.
 *
 * Three rules keep a site from rising under the enemy's bows only to be knocked down again, and a razed
 * building from being re-placed into the same fire ({@link seatSiege}): nothing is placed or upgraded while
 * the seat is under attack; no spot inside an enemy fighter's reach is ever picked, a tower garrison's
 * included, since a garrison never raids; and a razed building's entry waits {@link REBUILD_DELAY_TICKS}
 * from the last decision that saw the attack. The engine's own contested-ground rule, which every seat
 * shares, is narrower than the second and adds nothing here.
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
  const base = seatBaseOf(world, ctx, player);
  if (sites >= (base === null ? BASELESS_CONSTRUCTION_SITES : MAX_ACTIVE_CONSTRUCTION_SITES)) return [];

  const tribe = playerPlacementTribes(world, player)?.[0];
  // Scanned once the list has something to do: an idle decision never walks the map's people.
  let siege: Siege | null = null;
  const siegeOf = (): Siege => (siege ??= seatSiege(world, ctx, terrain, player, owned));
  if (base === null) {
    if (tribe === undefined || siegeOf().attacked) return [];
    return replaceMissingBase(world, ctx, terrain, player, owned, tribe, siegeOf().underFire);
  }
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return [];
  const index = contentIndex(ctx.content);

  const live: LiveResourceMemo = new Map();
  for (const [entryIndex, entry] of order.entries()) {
    const status = entryStatus(world, ctx, player, owned, entry, live);
    if (status !== 'unmet') continue;
    const { attacked, underFire } = siegeOf();
    if (awaitingRebuild(world, player, entryIndex, entry, ctx.tick, attacked) || attacked) return [];
    if (sites > 0 && outrunsSites(world, ctx, player, owned, order, entryIndex, live)) return [];
    const stall = placementStall(world, player, entryIndex);
    switch (entry.kind) {
      case 'place': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return [];
        if (stall !== null && ctx.tick < stall.retryTick) return [];
        const spot = placementSpot(world, ctx, terrain, player, owned, anchor, type, entry, underFire);
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
        if (!upgradeBillCovered(world, ctx, player, owned, candidate)) return [];
        return [{ kind: 'upgradeBuilding', building: candidate }];
      }
      case 'collector':
        return []; // the workforce module hires it
      case 'towerCoverage':
      case 'storeCoverage': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return [];
        const coverage = coverageOf(entry);
        const target = firstUncoveredBuilding(world, ctx, player, owned, coverage);
        if (target === null) return []; // status said unmet - defensive
        const spot = coveragePlacementSpot(
          world,
          ctx,
          terrain,
          player,
          owned,
          anchor,
          type,
          target,
          coverage,
          underFire,
        );
        return spot === null ? [] : [siteCommand(type, spot, tribe, player)];
      }
    }
  }
  advanceFrontier(world, player, order.length);
  return [];
}

/**
 * Whether the acting entry is a razed building's, fallen back below the seat's frontier, still inside
 * {@link REBUILD_DELAY_TICKS} of the decision that first saw it or, later, of the last one that saw the
 * seat `attacked`. Only a counted building entry regresses this way; a coverage entry re-arms by design
 * and a collector is hired, not built, so neither moves the frontier. A seat with no AI carrier (a module
 * run directly) keeps no frontier and never waits.
 */
function awaitingRebuild(
  world: World,
  player: number,
  entryIndex: number,
  entry: BuildOrderEntry,
  tick: number,
  attacked: boolean,
): boolean {
  const carrier = aiPlayerEntity(world, player);
  if (carrier === null) return false;
  const frontier = world.tryGet(carrier, BuildOrderFrontier);
  if (frontier === undefined || entryIndex >= frontier.entry) {
    advanceFrontier(world, player, entryIndex);
    return false;
  }
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return false;
  const held = frontier.rebuildTick;
  if (held === null || (attacked && held < tick + REBUILD_DELAY_TICKS)) {
    world.mut(carrier, BuildOrderFrontier).rebuildTick = tick + REBUILD_DELAY_TICKS;
    return true;
  }
  return tick < held;
}

/** Raise the seat's frontier to `entryIndex`, the first unmet entry at or past it (the list's length once all
 *  are met), and end any rebuild wait, since nothing below the frontier is unmet any more. Only this raises
 *  it, so every later loss below it waits out the delay again. */
function advanceFrontier(world: World, player: number, entryIndex: number): void {
  const carrier = aiPlayerEntity(world, player);
  if (carrier === null) return;
  const frontier = world.tryGet(carrier, BuildOrderFrontier);
  if (frontier !== undefined && frontier.entry === entryIndex && frontier.rebuildTick === null) return;
  world.add(carrier, BuildOrderFrontier, { entry: entryIndex, rebuildTick: null });
}

/**
 * Whether acting on `entryIndex` would take the list more than {@link BUILD_ORDER_LOOKAHEAD_ENTRIES} entries
 * past the oldest one met only by a fresh site still going up. That entry is found by re-reading the list
 * over the buildings that stand, a building mid-upgrade counted at the tier it has; skipped entries do not
 * count toward the lookahead.
 */
function outrunsSites(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: readonly BuildOrderEntry[],
  entryIndex: number,
  live: LiveResourceMemo,
): boolean {
  if (entryIndex <= BUILD_ORDER_LOOKAHEAD_ENTRIES) return false;
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  let oldest = -1;
  for (let i = 0; i < entryIndex && oldest < 0; i++) {
    const entry = order[i];
    if (entry !== undefined && entryStatus(world, ctx, player, standing, entry, live, false) === 'unmet')
      oldest = i;
  }
  if (oldest < 0) return false;
  let ahead = 0;
  for (let i = oldest + 1; i <= entryIndex; i++) {
    const entry = order[i];
    if (entry !== undefined && entryStatus(world, ctx, player, owned, entry, live) !== 'skip') ahead++;
  }
  return ahead > BUILD_ORDER_LOOKAHEAD_ENTRIES;
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
  underFire: FireTest,
): readonly PlayerCommand[] {
  const centre = anchorCentroid(world, owned);
  if (centre === null) return [];
  const type = buildingTypeByContentId(ctx.content, BASE_REPLACEMENT_ENTRY.building);
  if (type === undefined) return []; // content without the warehouse expresses no replacement
  const spot = placementSpot(
    world,
    ctx,
    terrain,
    player,
    owned,
    centre,
    type,
    BASE_REPLACEMENT_ENTRY,
    underFire,
  );
  if (spot === null) return [];
  return [siteCommand(type, spot, tribe, player)];
}
