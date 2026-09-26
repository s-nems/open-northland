import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import {
  aiPlayerEntity,
  Building,
  BuildOrderFrontier,
  playerPlacementTribes,
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
import { buildingTypeByContentId, tiersAtOrAbove } from '../content-lookup.js';
import type { AiPlayerModule } from '../index.js';
import type { EnemyFire } from '../military/defence/index.js';
import { anchorCentroid, anchorNodeOf } from '../node-geometry.js';
import { ownedBuildings } from '../seat-roster.js';
import {
  BASE_REPLACEMENT_ENTRY,
  BASELESS_CONSTRUCTION_SITES,
  type BuildOrderEntry,
  isLaneEntry,
  REBUILD_DELAY_TICKS,
  sitePace,
} from './entries.js';
import { placementSpot } from './placement.js';
import { type EntryStatus, entryStatus, type LiveResourceMemo, upgradeCandidate } from './progress.js';
import { type Siege, seatSiege } from './siege.js';
import { StalledSearches } from './stalled-searches.js';
import { coverageOf, coverageSpotSearch, uncoveredTargets } from './tower-coverage.js';
import { upgradeBillCovered } from './upgrade-supply.js';

export * from './entries.js';
export {
  collectorGoodsWanted,
  type EntryStatus,
  entryStatuses,
} from './progress.js';
export { type Siege, seatSiege } from './siege.js';
export { TOWER_CONTENT_IDS, TOWER_DEFENCE_RADIUS_NODES } from './tower-coverage.js';

/** The seat's open sites that count against its pace: a workshop's hidden vehicle yard is the crew's own
 *  cycle, never a placement the list made, so it holds no slot. */
function constructionSites(world: World, ctx: SystemContext, owned: readonly Entity[]): Entity[] {
  const index = contentIndex(ctx.content);
  return owned.filter(
    (e) =>
      world.has(e, UnderConstruction) &&
      index.buildings.get(world.get(e, Building).buildingType)?.kind !== BUILDING_KIND.vehicle,
  );
}

/**
 * Acts on the first unmet entry, so a razed building is re-placed, after {@link REBUILD_DELAY_TICKS},
 * before any entry the seat has not reached yet. A placed site meets its entry at once, so up to the
 * clock's {@link sitePace} sites go up side by side, within its lookahead of the oldest unfinished one.
 * A lane entry the list has reached runs beside it ({@link openLanes}): it takes one of those sites for
 * itself and leaves the list the rest, so a tower ring with no room left stalls nothing.
 * An unmet entry with no legal action stalls rather than being skipped, so no later site draws off the
 * goods it waits for: most retry next decision, a placement that found no spot every
 * {@link STALLED_PLACEMENT_RETRY_DECISIONS} decisions, and an upgrade holds while a bill good only it or
 * another site could make is not yet in store ({@link upgradeBillCovered}). The exceptions are passed
 * over instead ({@link Verdict}): a serving placement with no room beside the workshop it serves, and a
 * coverage entry with no target it can cover. Builders are never pinned to a site; the builder drive
 * picks its own.
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
  const base = seatBaseOf(world, ctx, player);
  const siteCap = base === null ? BASELESS_CONSTRUCTION_SITES : sitePace(ctx.tick).sites;
  const sites = constructionSites(world, ctx, owned);
  if (sites.length >= siteCap) return [];

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
  const statuses = order.map((entry) => entryStatus(world, ctx, player, owned, entry, live));
  const searches = new StalledSearches(world, player, statuses);
  // One search per entry a decision: the lanes and the list share each verdict.
  const verdicts = new Map<number, Verdict>();
  const verdictOf = (entryIndex: number): Verdict => {
    const known = verdicts.get(entryIndex);
    if (known !== undefined) return known;
    const entry = order[entryIndex];
    let verdict = ACTS;
    if (entry !== undefined && passesOver(entry)) {
      if (searches.waits(entryIndex, ctx.tick)) verdict = PASSED_OVER;
      else {
        verdict = searchVerdict(
          world,
          ctx,
          terrain,
          player,
          owned,
          anchor,
          tribe,
          entry,
          siegeOf().underFire,
        );
        if (tribe !== undefined) searches.searched(entryIndex, ctx.tick, verdict.kind === 'act', false);
      }
    }
    verdicts.set(entryIndex, verdict);
    return verdict;
  };
  const passedOver = (entryIndex: number): boolean => verdictOf(entryIndex).kind === 'pass';

  const lanes = openLanes(world, ctx, order, statuses, sites, passedOver);
  for (const lane of lanes) {
    if (statuses[lane.entryIndex] !== 'unmet' || lane.sites > 0 || tribe === undefined) continue;
    if (searches.waits(lane.entryIndex, ctx.tick)) continue;
    if (siegeOf().attacked) return [];
    const placed = coverageCommand(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      tribe,
      lane.entry,
      siegeOf().underFire,
    );
    searches.searched(lane.entryIndex, ctx.tick, placed !== null, false);
    if (placed !== null) return [placed];
  }
  // The list keeps the sites the lanes leave it, at least one, and counts only its own.
  let listSites = sites.length;
  for (const lane of lanes) listSites -= lane.sites;
  if (listSites >= Math.max(1, siteCap - lanes.length)) return [];

  for (const [entryIndex, entry] of order.entries()) {
    if (isLaneEntry(entry) || statuses[entryIndex] !== 'unmet') continue;
    const { attacked, underFire } = siegeOf();
    if (attacked) {
      holdRebuildUnderAttack(world, player, entryIndex, entry, ctx.tick);
      return [];
    }
    const verdict = verdictOf(entryIndex);
    if (verdict.kind === 'pass') continue;
    if (awaitingRebuild(world, player, entryIndex, entry, ctx.tick)) return [];
    if (listSites > 0 && outrunsSites(world, ctx, player, owned, order, entryIndex, live)) return [];
    searches.acting(entryIndex);
    if (verdict.placement !== null) return [verdict.placement];
    switch (entry.kind) {
      case 'place': {
        if (tribe === undefined) return [];
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return []; // unreachable after 'skip', kept for the type system
        if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return [];
        if (searches.waits(entryIndex, ctx.tick)) return [];
        const spot = placementSpot(world, ctx, terrain, player, owned, anchor, type, entry, underFire);
        searches.searched(entryIndex, ctx.tick, spot !== null, true);
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
      case 'storeCoverage':
        return []; // a seat with no placement tribe holds here; any other found a spot or was passed over
    }
  }
  advanceFrontier(world, player, order.length);
  return [];
}

type PlaceCommand = Extract<PlayerCommand, { kind: 'placeBuilding' }>;

/**
 * What the list makes of an unmet entry this decision. A serving placement with no room beside the
 * workshop it serves, or a coverage entry with no target it can cover, is passed over: the workshop still
 * runs, slower, and the goods still travel, only farther, while a stalled list would not. A passed-over
 * entry holds neither the list nor the lanes and moves neither the frontier nor the stall record. Every
 * other unmet entry acts, carrying the placement its search found when it is one of those kinds.
 */
type Verdict = { readonly kind: 'pass' } | { readonly kind: 'act'; readonly placement: PlaceCommand | null };

const ACTS: Verdict = { kind: 'act', placement: null };
const PASSED_OVER: Verdict = { kind: 'pass' };

/** Whether an unmet `entry` is one the list passes over rather than stalls on when its search finds nothing. */
function passesOver(entry: BuildOrderEntry): boolean {
  if (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') return true;
  return entry.kind === 'place' && entry.unlessWithin !== undefined;
}

function searchVerdict(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number | undefined,
  entry: BuildOrderEntry,
  underFire: EnemyFire,
): Verdict {
  if (tribe === undefined) return ACTS;
  switch (entry.kind) {
    case 'place': {
      if (entry.unlessWithin === undefined) return ACTS;
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined || !buildingEnabled(world, ctx, player, tribe, type.typeId)) return ACTS;
      const spot = placementSpot(world, ctx, terrain, player, owned, anchor, type, entry, underFire);
      return spot === null ? PASSED_OVER : { kind: 'act', placement: siteCommand(type, spot, tribe, player) };
    }
    case 'towerCoverage':
    case 'storeCoverage': {
      const placed = coverageCommand(world, ctx, terrain, player, owned, anchor, tribe, entry, underFire);
      return placed === null ? PASSED_OVER : { kind: 'act', placement: placed };
    }
    case 'upgrade':
    case 'collector':
      return ACTS;
  }
}

/** One lane of the list ({@link isLaneEntry}) and the sites of its building the seat has open. */
interface OpenLane {
  readonly entryIndex: number;
  readonly entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>;
  readonly sites: number;
}

/** The lanes the list has reached, in list order: every entry before each stands met or passed over. A
 *  lane's sites are the open sites of its building or a tier above it, whichever entry placed them. */
function openLanes(
  world: World,
  ctx: SystemContext,
  order: readonly BuildOrderEntry[],
  statuses: readonly EntryStatus[],
  sites: readonly Entity[],
  passedOver: (entryIndex: number) => boolean,
): OpenLane[] {
  const index = contentIndex(ctx.content);
  const lanes: OpenLane[] = [];
  let held = false;
  for (const [entryIndex, entry] of order.entries()) {
    if (held) break;
    if ((entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && entry.lane === true) {
      const type = buildingTypeByContentId(ctx.content, entry.building);
      const chain = type === undefined ? new Set<number>() : tiersAtOrAbove(index, type);
      const own = sites.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
      lanes.push({ entryIndex, entry, sites: own });
      continue;
    }
    if (statuses[entryIndex] === 'unmet' && !passedOver(entryIndex)) held = true;
  }
  return lanes;
}

/**
 * The site a coverage entry raises next, or null when no target has a legal spot: the first target with
 * one, in target order; a target none covers, a flag beyond the seat's build reach or ground another
 * store already serves, is passed over. Nothing while the building's tier is not enabled yet.
 */
function coverageCommand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>,
  underFire: EnemyFire,
): PlaceCommand | null {
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return null; // unreachable after 'skip', kept for the type system
  if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return null;
  const coverage = coverageOf(entry);
  const spotFor = coverageSpotSearch(world, ctx, terrain, player, owned, anchor, type, coverage, underFire);
  for (const target of uncoveredTargets(world, ctx, player, owned, coverage)) {
    const spot = spotFor(target);
    if (spot !== null) return siteCommand(type, spot, tribe, player);
  }
  return null;
}

/**
 * Whether the acting entry is a razed building's, fallen back below the seat's frontier, still inside
 * {@link REBUILD_DELAY_TICKS} of the decision that first saw it or, later, of the last one that saw the
 * seat `attacked`. Only a counted building entry regresses this way; a coverage entry re-arms by design
 * and a collector is hired, not built, so neither moves the frontier. A passed-over serving entry that
 * finds room again falls below the frontier the same way and waits the delay once. A seat with no AI
 * carrier (a module run directly) keeps no frontier and never waits.
 */
function awaitingRebuild(
  world: World,
  player: number,
  entryIndex: number,
  entry: BuildOrderEntry,
  tick: number,
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
  if (held === null) {
    world.mut(carrier, BuildOrderFrontier).rebuildTick = tick + REBUILD_DELAY_TICKS;
    return true;
  }
  return tick < held;
}

/** Under siege the list acts on nothing and searches nothing, so a lost entry below the frontier only has
 *  its rebuild wait pushed out to run from the siege's end; the frontier stays where it is. */
function holdRebuildUnderAttack(
  world: World,
  player: number,
  entryIndex: number,
  entry: BuildOrderEntry,
  tick: number,
): void {
  const carrier = aiPlayerEntity(world, player);
  if (carrier === null) return;
  const frontier = world.tryGet(carrier, BuildOrderFrontier);
  if (frontier === undefined || entryIndex >= frontier.entry) return;
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return;
  const held = frontier.rebuildTick;
  if (held === null || held < tick + REBUILD_DELAY_TICKS)
    world.mut(carrier, BuildOrderFrontier).rebuildTick = tick + REBUILD_DELAY_TICKS;
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
 * Whether acting on `entryIndex` would take the list more than the clock's lookahead ({@link sitePace})
 * past the oldest one met only by a fresh site still going up. That entry is found by re-reading the list
 * over the buildings that stand, a building mid-upgrade counted at the tier it has. An entry unmet over
 * the sites too was passed over, not met by one, so it never holds the list; skipped entries and lanes
 * do not count toward the lookahead.
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
  const { lookahead } = sitePace(ctx.tick);
  if (entryIndex <= lookahead) return false;
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  let oldest = -1;
  for (let i = 0; i < entryIndex && oldest < 0; i++) {
    const entry = order[i];
    if (entry === undefined || isLaneEntry(entry)) continue;
    if (entryStatus(world, ctx, player, standing, entry, live, false) !== 'unmet') continue;
    if (entryStatus(world, ctx, player, owned, entry, live) !== 'unmet') oldest = i;
  }
  if (oldest < 0) return false;
  let ahead = 0;
  for (let i = oldest + 1; i <= entryIndex; i++) {
    const entry = order[i];
    if (entry === undefined || isLaneEntry(entry)) continue;
    if (entryStatus(world, ctx, player, owned, entry, live) !== 'skip') ahead++;
  }
  return ahead > lookahead;
}

function siteCommand(type: BuildingType, spot: HalfCellNode, tribe: number, player: number): PlaceCommand {
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
  underFire: EnemyFire,
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
