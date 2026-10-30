import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import {
  aiControlEntity,
  Building,
  BuildOrderFrontier,
  BuildOrderPause,
  playerPlacementTribes,
  UnderConstruction,
  Upgrading,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId, countedTiers, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { anchorCentroid, anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedBuildings } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import { seatBaseOf } from '../base.js';
import { type ComputerProfile, computerProfileOf } from '../difficulty.js';
import type { ComputerModule } from '../index.js';
import { technologyReach } from '../technology/reach.js';
import { type TechnologyTable, technologyTable } from '../technology/requirements.js';
import { billSourced, goodsMadeBy, sourcedTiers } from './bill-sources.js';
import {
  BASE_REPLACEMENT_ENTRY,
  BASELESS_CONSTRUCTION_SITES,
  type BuildLine,
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  isLaneEntry,
  linesByPriority,
  REBUILD_DELAY_TICKS,
  type StepKey,
  sitePace,
  stepKey,
} from './entries.js';
import { grassBoundEntry, grassReserved } from './grass-reserve.js';
import { daughtersBlocked, type HousingGate, homeTiersOf, housingGate, housingPick } from './housing.js';
import { placementSpot } from './placement.js';
import {
  type DecisionMemo,
  decisionMemo,
  type EntryStatus,
  entryStatus,
  type LineStatuses,
  lineStatuses,
  stepHeld,
  upgradeCandidate,
} from './progress.js';
import { DEFENCE_LINES, seatBuildOrder, seatDefenceFirst, seatSitePace } from './seat-order.js';
import { type Siege, seatSiege } from './siege.js';
import { StalledSearches } from './stalled-searches.js';
import { coverageOf, coverageSpotSearch, firstUncovered } from './tower-coverage.js';
import { upgradeReach } from './upgrade-reach.js';
import { suppliedUpgrade } from './upgrade-supply.js';

export * from './entries.js';
export {
  collectorGoodsWanted,
  type EntryStatus,
  entryStatuses,
  type LineStatuses,
  lineStatuses,
} from './progress.js';
export {
  ARCHETYPE_TUNING,
  DEFENCE_TOWER_RADIUS_PCT,
  defenceFirst,
  seatBuildOrder,
  seatSitePace,
  seatTuning,
  shapeBuildOrder,
} from './seat-order.js';
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
 * Runs the order's lines side by side. Each line acts on its first unmet step, so a razed building is
 * re-placed, after {@link REBUILD_DELAY_TICKS}, before any step of its line the seat has not reached yet;
 * a line never waits for another. A free construction site goes to the first line with a ready step in
 * {@link turnOrder}, the order's priority within each turn, one command a decision. A placed site meets
 * its step at once, so up to the clock's {@link sitePace} sites go up side by side, each line within its
 * lookahead of its own oldest unfinished step, and {@link EARNED_WORKSHOP_EXTRA_SITES} more for an earned
 * workshop. A lane step a line has reached runs beside the lines
 * ({@link openLanes}): it takes one of those sites for itself and leaves the lines the rest, so a tower
 * ring with no room left stalls nothing.
 * An unmet step with no legal action stalls its line rather than being skipped, so no later site of the
 * line draws off the goods it waits for: a step whose bill has no source yet ({@link billSourced}), a
 * placement that found no spot, retried every {@link STALLED_PLACEMENT_RETRY_DECISIONS} decisions, and an
 * upgrade while a bill good only it or another site could make is not yet in store, or while it would idle
 * a good's last working maker ({@link suppliedUpgrade}). An upgrade raises its building straight to the
 * highest tier that step and the unmet upgrade steps right after it in its line want, as far as the seat
 * has the tiers enabled ({@link upgradeReach}) and the store backs the merged bill. A step whose building
 * the seat has not discovered yet holds its line too, while the technology module earns it, so a later
 * step never runs ahead of the workshop it feeds on; one whose discovery can never come is skipped
 * ({@link entryStatus}), and a seat with no technology table, whose lock can only be a ban, passes it. A
 * step's `holdUntil` holds its line the same way until the building stands or the good is discovered.
 * The exceptions are passed over instead ({@link Verdict}): a serving placement with no room beside what
 * it serves, a grass building other than an `essential` one with no grass left in reach, and a coverage
 * step with no target it can cover. Builders are never pinned to a site; the builder drive picks its own.
 *
 * Three rules keep a site from rising under the enemy's bows only to be knocked down again, and a razed
 * building from being re-placed into the same fire ({@link seatSiege}): nothing is placed or upgraded while
 * the seat is under attack; no spot inside an enemy fighter's reach is ever picked, a tower garrison's
 * included, since a garrison never raids; and a razed building's step waits {@link REBUILD_DELAY_TICKS}
 * from the last decision that saw the attack. The engine's own contested-ground rule, which every seat
 * shares, is narrower than the second and adds nothing here.
 */
export function buildOrderModule(order: BuildOrder): ComputerModule {
  return {
    id: 'houseBuild',
    run: (world, ctx, player) => runBuildOrder(world, ctx, player, order),
  };
}

function runBuildOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  fullOrder: BuildOrder,
): readonly PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const profile = computerProfileOf(world, player);
  const order = seatBuildOrder(world, player, ctx.tick, fullOrder, profile);
  const owned = ownedBuildings(world, player);
  const base = seatBaseOf(world, ctx, player);
  const siteCap =
    base === null ? BASELESS_CONSTRUCTION_SITES : seatSitePace(world, player, profile, ctx.tick).sites;
  const sites = constructionSites(world, ctx, owned);
  // With the pace's sites taken, only an earned workshop may still go up, on the one site kept for it.
  let earnedOnly = sites.length >= siteCap;
  if (earnedOnly && !earnedSiteOpen(base, profile, sites.length, siteCap)) return [];
  const carrier = aiControlEntity(world, player);
  if (!earnedOnly && base !== null && waitsOnFreeSite(world, carrier, profile, ctx.tick)) return [];
  const started = (command: PlayerCommand): readonly PlayerCommand[] => {
    if (carrier !== null && world.has(carrier, BuildOrderPause)) world.remove(carrier, BuildOrderPause);
    return [command];
  };

  const tribe = playerPlacementTribes(world, player)?.[0];
  // Scanned once the order has something to do: an idle decision never walks the map's people.
  let siege: Siege | null = null;
  const siegeOf = (): Siege => (siege ??= seatSiege(world, ctx, terrain, player, owned));
  if (base === null) {
    if (tribe === undefined || siegeOf().attacked) return [];
    return replaceMissingBase(world, ctx, terrain, player, owned, tribe, siegeOf().underFire);
  }
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return [];
  const index = contentIndex(ctx.content);
  const lines = linesByPriority(order);

  const memo = decisionMemo();
  const statuses = lineStatuses(world, ctx, player, owned, order, memo);
  const statusOf = (line: BuildLineId, step: number): EntryStatus | undefined => statuses.get(line)?.[step];
  const reserveGrass = grassReserved(ctx, terrain, anchor, order, statuses);
  const searches = new StalledSearches(world, player, keyedStatuses(order, statuses));
  let made: ReadonlySet<number> | undefined;
  const madeGoods = (): ReadonlySet<number> => (made ??= goodsMadeBy(world, ctx, owned));
  const locked = (entry: BuildOrderEntry): boolean => stepLocked(world, ctx, player, owned, tribe, entry);
  const held = (entry: BuildOrderEntry): boolean => stepHeld(world, ctx, player, owned, entry, memo);
  // A locked step holds its line while the technology module earns its discovery; with nothing gated
  // for the seat (no technology table) it can only be a ban, and is passed over.
  const lockHolds = technologyReach(world, ctx, player, memo) !== null;
  // One search per step a decision: the lanes and the lines share each verdict.
  const verdicts = new Map<StepKey, Verdict>();
  const verdictOf = (line: BuildLine, step: number): Verdict => {
    const key = stepKey(line.id, step);
    const known = verdicts.get(key);
    if (known !== undefined) return known;
    const entry = line.steps[step];
    let verdict = ACTS;
    if (entry !== undefined && passesOver(ctx, entry)) {
      if (searches.waits(line.id, step, ctx.tick)) verdict = PASSED_OVER;
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
          reserveGrass,
        );
        if (tribe !== undefined) searches.searched(line.id, step, ctx.tick, verdict.kind === 'act', false);
      }
    }
    verdicts.set(key, verdict);
    return verdict;
  };

  let housing: HousingGate | undefined;
  const housingGateOf = (): HousingGate => (housing ??= housingGate(world, ctx, player, owned));
  const lanes = openLanes(
    world,
    ctx,
    lines,
    statuses,
    sites,
    (line, step) => {
      const entry = line.steps[step];
      if (entry === undefined) return true;
      if (held(entry)) return false;
      if (locked(entry)) return !lockHolds;
      return billSourced(world, ctx, player, entry, madeGoods) && verdictOf(line, step).kind === 'pass';
    },
    () => housingGateOf() === 'early',
  );
  for (const lane of earnedOnly ? [] : lanes) {
    if (statusOf(lane.line, lane.step) !== 'unmet' || lane.sites > 0 || tribe === undefined) continue;
    if (searches.waits(lane.line, lane.step, ctx.tick)) continue;
    const entry = lane.entry;
    if (entry.kind === 'housing') {
      if (housingGateOf() === 'closed') continue;
      // Ahead of its place in the line, the lane takes a site only while the daughters are blocked.
      if (lane.early && !daughtersBlocked(world, ctx, player, owned, entry)) continue;
    } else if (!billSourced(world, ctx, player, entry, madeGoods)) continue;
    if (siegeOf().attacked) return [];
    const placed =
      entry.kind === 'housing'
        ? housingCommand(world, ctx, terrain, player, owned, anchor, tribe, entry, siegeOf().underFire, {
            reserveGrass,
            made: madeGoods,
          })
        : coverageCommand(
            world,
            ctx,
            terrain,
            player,
            owned,
            anchor,
            tribe,
            entry,
            siegeOf().underFire,
            reserveGrass,
          );
    searches.searched(lane.line, lane.step, ctx.tick, placed !== null, false);
    if (placed !== null) return started(placed);
  }
  // The lines keep the sites the coverage lanes leave them, at least one, and count only their own; the
  // housing lane's site is one of theirs.
  let listSites = sites.length;
  let reserved = 0;
  for (const lane of lanes) {
    if (lane.entry.kind === 'housing') continue;
    listSites -= lane.sites;
    reserved++;
  }
  if (listSites >= Math.max(1, siteCap - reserved)) {
    if (!earnedSiteOpen(base, profile, sites.length, siteCap)) return [];
    earnedOnly = true;
  }

  const firstUnmet = (line: BuildLine): number =>
    line.steps.findIndex((entry, step) => !isLaneEntry(entry) && statusOf(line.id, step) === 'unmet');
  if (lines.some((line) => firstUnmet(line) >= 0) && siegeOf().attacked) {
    for (const line of lines) {
      const step = firstUnmet(line);
      const entry = line.steps[step];
      if (entry !== undefined) holdRebuildUnderAttack(world, player, line.id, step, entry, ctx.tick);
    }
    return [];
  }

  /** The command of `line`'s step at `step`, which acts this decision, or null while it holds its line. */
  const stepCommand = (line: BuildLine, step: number, entry: BuildOrderEntry): PlayerCommand | null => {
    switch (entry.kind) {
      case 'place': {
        if (tribe === undefined) return null;
        const type = buildingTypeByContentId(ctx.content, entry.building);
        if (type === undefined) return null; // unreachable after 'skip', kept for the type system
        if (searches.waits(line.id, step, ctx.tick)) return null;
        const spot = placementSpot(
          world,
          ctx,
          terrain,
          player,
          owned,
          anchor,
          type,
          tribe,
          entry,
          siegeOf().underFire,
          reserveGrass,
        );
        searches.searched(line.id, step, ctx.tick, spot !== null, true);
        return spot === null ? null : siteCommand(type, spot, tribe, player);
      }
      case 'upgrade': {
        const target = buildingTypeByContentId(ctx.content, entry.building);
        if (target === undefined) return null; // unreachable after 'skip', kept for the type system
        const candidate = upgradeCandidate(world, index, owned, target);
        if (candidate === null) return null;
        // A jump stops below a tier whose bill has no source yet, and one the store cannot back yet falls
        // back to the highest tier it can, down to the next one.
        const wanted = upgradeReach(
          world,
          ctx,
          player,
          line.steps,
          statuses.get(line.id) ?? [],
          step,
          candidate,
        );
        const tiers = sourcedTiers(world, ctx, player, wanted, madeGoods);
        const reach = suppliedUpgrade(world, ctx, player, owned, candidate, tiers);
        return reach === undefined ? null : { kind: 'upgradeBuilding', building: candidate, target: reach };
      }
      case 'collector':
        return null; // the workforce module hires it
      case 'towerCoverage':
      case 'storeCoverage':
        return null; // a seat with no placement tribe holds here; any other found a spot or was passed over
      case 'housing':
        return null; // always a lane, never a line's step
    }
  };

  /** The command of `line`'s first unmet step that is not passed over, or null while that step holds
   *  the line or the line has none. */
  const lineCommand = (line: BuildLine): PlayerCommand | null => {
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry) || statusOf(line.id, step) !== 'unmet') continue;
      if (held(entry)) return null;
      if (locked(entry)) {
        if (lockHolds) return null;
        continue;
      }
      if (!billSourced(world, ctx, player, entry, madeGoods)) return null;
      const verdict = verdictOf(line, step);
      if (verdict.kind === 'pass') continue;
      if (awaitingRebuild(world, player, line.id, step, entry, ctx.tick)) return null;
      if (listSites > 0 && outrunsSites(world, ctx, player, owned, line.steps, step, memo)) return null;
      searches.acting(line.id, step);
      return verdict.placement ?? stepCommand(line, step, entry);
    }
    advanceFrontier(world, player, line.id, line.steps.length);
    return null;
  };
  // Turns, priority deciding within each: a line with no site of its own rising goes before one with,
  // and a line whose next step raises a building the seat has none of before one adding another of a kind
  // it owns, so no line takes every site or runs its later copies while another still lacks its first. A
  // workshop whose discovery the seat just earned goes before them all, and while the seat's defence comes
  // first its defence lines go before that.
  // A line that stands met moves its frontier now, whichever line acts first, so its later losses wait.
  for (const line of lines)
    if (firstUnmet(line) < 0) advanceFrontier(world, player, line.id, line.steps.length);
  const gated = lockHolds && tribe !== undefined ? technologyTable(ctx.content, tribe) : null;
  const defending = seatDefenceFirst(world, player);
  const byTurn = turnOrder(world, ctx, player, owned, lines, statusOf, memo, gated, defending);
  for (const { line, turn } of byTurn) {
    if (earnedOnly && turn !== TURN.earned) continue;
    const command = lineCommand(line);
    if (command !== null) return started(command);
  }
  return [];
}

/** A line's turn, the lower first: a defence line ({@link DEFENCE_LINES}) with no rising site of its own
 *  while the seat's defence comes first, no rising site and a next step raising a workshop the seat lacks
 *  whose discovery it earned ({@link earnedWorkshop}), no rising site and a next step raising a kind it
 *  lacks, no rising site, a site of its own still rising. On mroczny_las a seat defending from the first
 *  minute gave every freed site to its earned workshops and raised no barracks before the scripted wave. */
const TURN = { defence: 0, earned: 1, newKind: 2, more: 3, rising: 4 } as const;

/** `lines`, stable in priority order, by {@link TURN}, each with its turn. `gated` holds the seat's
 *  technology table while its progression gates apply; `defending` whether its defence comes first. */
function turnOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  lines: readonly BuildLine[],
  statusOf: (line: BuildLineId, step: number) => EntryStatus | undefined,
  memo: DecisionMemo,
  gated: TechnologyTable | null,
  defending: boolean,
): { readonly line: BuildLine; readonly turn: number }[] {
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  const ownedTypes = new Set(owned.map((e) => world.get(e, Building).buildingType));
  const rank = (line: BuildLine): number => {
    let next: BuildOrderEntry | undefined;
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry)) continue;
      const status = statusOf(line.id, step);
      if (status === 'satisfied' && entryStatus(world, ctx, player, standing, entry, memo, false) === 'unmet')
        return TURN.rising;
      if (status === 'unmet') next ??= entry;
    }
    if (defending && next !== undefined && DEFENCE_LINES.includes(line.id)) return TURN.defence;
    if (next === undefined || next.kind === 'collector') return TURN.newKind;
    const type = buildingTypeByContentId(ctx.content, next.building);
    if (type === undefined) return TURN.newKind;
    const kinds = countedTiers(
      ctx.content,
      type,
      next.kind === 'place' || next.kind === 'upgrade' ? next.belowTier : undefined,
    );
    for (const kind of kinds) if (ownedTypes.has(kind)) return TURN.more;
    return earnedWorkshop(gated, type) ? TURN.earned : TURN.newKind;
  };
  return lines.map((line) => ({ line, turn: rank(line) })).sort((a, b) => a.turn - b.turn);
}

/** Construction sites over the pace kept for a workshop whose discovery the seat earned (authored): owner
 *  ruling, once a trade is discovered its building goes up promptly; on magiczny_las the bakery waited up to
 *  six game minutes after its discovery while the pace's sites were taken. */
export const EARNED_WORKSHOP_EXTRA_SITES = 1;

/** Whether a seat at `sites` open sites of its pace's `siteCap` may still open one for an earned workshop:
 *  only with a base and a profile that never pauses between sites, since the slower profiles' pace is their
 *  throttle. */
function earnedSiteOpen(
  base: Entity | null,
  profile: ComputerProfile,
  sites: number,
  siteCap: number,
): boolean {
  return base !== null && profile.freeSitePauseTicks === 0 && sites < siteCap + EARNED_WORKSHOP_EXTRA_SITES;
}

/**
 * Whether `type` is a workshop a discovery opens for the seat (its `gated` technology row asks for a job
 * or a good). Owner ruling: once a trade is discovered its building goes up promptly, the apprentice who
 * earned it waiting to move in; on magiczny_las and diamentowa_dolina the opening's home upgrades and the
 * tower ring took the two opening sites for five to twenty game minutes after the mill, animal farm and
 * smithy were discovered. A locked step still holds its line, so the turn only matters once it opens.
 */
function earnedWorkshop(gated: TechnologyTable | null, type: BuildingType): boolean {
  if (gated === null || type.kind !== BUILDING_KIND.workplace) return false;
  const row = gated.houses.get(type.typeId);
  return row !== undefined && row.jobs.length + row.goods.length > 0;
}

/** Whether `entry`'s building is one the seat cannot raise yet: a placed tier not enabled for the seat's
 *  placement tribe, or an upgrade whose candidate's next tier is not, so an upgrade still rises as far as
 *  the seat may ({@link upgradeReach}). A seat with no placement tribe holds rather than passes. */
function stepLocked(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  tribe: number | undefined,
  entry: BuildOrderEntry,
): boolean {
  if (tribe === undefined || entry.kind === 'collector') return false;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return false;
  if (entry.kind !== 'upgrade') return !buildingEnabled(world, ctx, player, tribe, type.typeId);
  const index = contentIndex(ctx.content);
  const candidate = upgradeCandidate(world, index, owned, type);
  if (candidate === null) return false;
  const building = world.get(candidate, Building);
  const next = index.buildings.get(building.buildingType)?.upgradeTarget;
  return next !== undefined && !buildingEnabled(world, ctx, player, building.tribe, next);
}

/** Every step's status by its {@link StepKey}, built only when a stalled-search record asks. */
function keyedStatuses(order: BuildOrder, statuses: LineStatuses): (key: StepKey) => EntryStatus | undefined {
  let byKey: Map<StepKey, EntryStatus> | undefined;
  return (key) => {
    if (byKey === undefined) {
      byKey = new Map();
      for (const line of order.lines) {
        for (const [step, status] of (statuses.get(line.id) ?? []).entries())
          byKey.set(stepKey(line.id, step), status);
      }
    }
    return byKey.get(key);
  };
}

/** Whether the seat's free site still waits out its profile's {@link ComputerProfile.freeSitePauseTicks}: the
 *  first decision that finds a site free starts the wait, and the next site or upgrade the list starts
 *  ends it, so every construction costs the seat its build time plus the pause. */
function waitsOnFreeSite(
  world: World,
  carrier: Entity | null,
  profile: ComputerProfile,
  tick: number,
): boolean {
  if (carrier === null || profile.freeSitePauseTicks === 0) return false;
  const pause = world.tryGet(carrier, BuildOrderPause);
  if (pause !== undefined) return tick < pause.untilTick;
  world.add(carrier, BuildOrderPause, { untilTick: tick + profile.freeSitePauseTicks });
  return true;
}

type PlaceCommand = Extract<PlayerCommand, { kind: 'placeBuilding' }>;

/**
 * What a line makes of an unmet step this decision. A serving placement with no room beside what it
 * serves, a grass building with no grass left for it, or a coverage step with no target it can cover, is
 * passed over: the workshop still runs, slower, and the goods still travel, only farther, while a stalled
 * line would not, and gatherers felling trees free no grass where the map has none. A passed-over step holds neither its line nor the lanes and moves neither
 * the frontier nor the stall record. Every other unmet step acts, carrying the placement its search found
 * when it is one of those kinds.
 */
type Verdict = { readonly kind: 'pass' } | { readonly kind: 'act'; readonly placement: PlaceCommand | null };

const ACTS: Verdict = { kind: 'act', placement: null };
const PASSED_OVER: Verdict = { kind: 'pass' };

/** Whether an unmet `entry` is one its line passes over rather than stalls on when its search finds
 *  nothing. */
function passesOver(ctx: SystemContext, entry: BuildOrderEntry): boolean {
  if (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') return true;
  return entry.kind === 'place' && placementPassesOver(ctx, entry);
}

/** A placement that exists to serve something beside it, a workshop an `unlessWithin` entry supplies or
 *  the ships a `shore` workshop launches, or a {@link grassBoundEntry} the list can go on without. */
function placementPassesOver(
  ctx: SystemContext,
  entry: Extract<BuildOrderEntry, { kind: 'place' }>,
): boolean {
  if (entry.unlessWithin !== undefined || (entry.near?.some((a) => a.kind === 'shore') ?? false)) return true;
  return entry.essential !== true && grassBoundEntry(ctx, entry);
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
  reserveGrass: boolean,
): Verdict {
  if (tribe === undefined) return ACTS;
  switch (entry.kind) {
    case 'place': {
      if (!placementPassesOver(ctx, entry)) return ACTS;
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) return ACTS;
      const spot = placementSpot(
        world,
        ctx,
        terrain,
        player,
        owned,
        anchor,
        type,
        tribe,
        entry,
        underFire,
        reserveGrass,
      );
      return spot === null ? PASSED_OVER : { kind: 'act', placement: siteCommand(type, spot, tribe, player) };
    }
    case 'towerCoverage':
    case 'storeCoverage': {
      const placed = coverageCommand(
        world,
        ctx,
        terrain,
        player,
        owned,
        anchor,
        tribe,
        entry,
        underFire,
        reserveGrass,
      );
      return placed === null ? PASSED_OVER : { kind: 'act', placement: placed };
    }
    case 'upgrade':
    case 'collector':
    case 'housing':
      return ACTS;
  }
}

/** One lane of a line ({@link isLaneEntry}) and the sites of its building the seat has open. */
interface OpenLane {
  readonly line: BuildLineId;
  readonly step: number;
  readonly entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' | 'housing' }>;
  readonly sites: number;
  /** A housing lane opened ahead of its place in the line on a food-rich seat. */
  readonly early: boolean;
}

/** The lanes the lines have reached, in line priority and step order: every step before each in its line
 *  stands met or passed over, and the clock has reached the lane's `fromTick`; a housing lane also opens
 *  ahead of that while `housingEarly` holds. A lane's sites are the open sites of its building or a tier
 *  above it, whichever step placed them. */
function openLanes(
  world: World,
  ctx: SystemContext,
  lines: readonly BuildLine[],
  statuses: LineStatuses,
  sites: readonly Entity[],
  passedOver: (line: BuildLine, step: number) => boolean,
  housingEarly: () => boolean,
): OpenLane[] {
  const lanes: OpenLane[] = [];
  for (const line of lines) {
    let reached = true;
    for (const [step, entry] of line.steps.entries()) {
      if (
        entry.kind === 'housing' ||
        ((entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && entry.lane === true)
      ) {
        const early = !reached && entry.kind === 'housing' && housingEarly();
        if (!reached && !early) continue;
        const fromTick = entry.kind === 'housing' ? 0 : (entry.fromTick ?? 0);
        if (ctx.tick < fromTick) continue;
        const chain = laneTiers(ctx, entry);
        const own = sites.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
        lanes.push({ line: line.id, step, entry, sites: own, early });
        continue;
      }
      if (reached && statuses.get(line.id)?.[step] === 'unmet' && !passedOver(line, step)) reached = false;
    }
  }
  return lanes;
}

/** The housing lane's next site ({@link housingPick}) as a command, or null when it has none. */
function housingCommand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'housing' }>,
  underFire: EnemyFire,
  decision: { readonly reserveGrass: boolean; readonly made: () => ReadonlySet<number> },
): PlayerCommand | null {
  const pick = housingPick(
    world,
    ctx,
    terrain,
    player,
    owned,
    anchor,
    tribe,
    entry,
    underFire,
    decision.reserveGrass,
    decision.made,
  );
  if (pick === null) return null;
  if (pick.kind === 'upgrade')
    return { kind: 'upgradeBuilding', building: pick.building, target: pick.target };
  return siteCommand(pick.type, pick.spot, tribe, player);
}

/** The building types whose sites a lane counts as its own: its building and the tiers above it, or the
 *  housing lane's whole home chain. */
function laneTiers(ctx: SystemContext, entry: OpenLane['entry']): ReadonlySet<number> {
  if (entry.kind === 'housing') return homeTiersOf(ctx.content, entry);
  const type = buildingTypeByContentId(ctx.content, entry.building);
  return type === undefined ? new Set() : tiersAtOrAbove(contentIndex(ctx.content), type);
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
  reserveGrass: boolean,
): PlaceCommand | null {
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return null; // unreachable after 'skip', kept for the type system
  if (!buildingEnabled(world, ctx, player, tribe, type.typeId)) return null;
  const coverage = coverageOf(world, player, entry);
  const spotFor = coverageSpotSearch(
    world,
    ctx,
    terrain,
    player,
    owned,
    anchor,
    type,
    tribe,
    coverage,
    underFire,
    reserveGrass,
  );
  const spot = firstUncovered(world, ctx, player, owned, coverage, spotFor);
  return spot === null ? null : siteCommand(type, spot, tribe, player);
}

/**
 * Whether the acting step is a razed building's, fallen back below its line's frontier, still inside
 * {@link REBUILD_DELAY_TICKS} of the decision that first saw it or, later, of the last one that saw the
 * seat `attacked`. Only a counted building step regresses this way; a coverage step re-arms by design
 * and a collector is hired, not built, so neither moves the frontier. A passed-over placement that
 * finds room again falls below the frontier the same way and waits the delay once. A seat with no AI
 * carrier (a module run directly) keeps no frontier and never waits.
 */
function awaitingRebuild(
  world: World,
  player: number,
  line: BuildLineId,
  step: number,
  entry: BuildOrderEntry,
  tick: number,
): boolean {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return false;
  const frontier = world.tryGet(carrier, BuildOrderFrontier)?.lines.get(line);
  if (frontier === undefined || step >= frontier.step) {
    advanceFrontier(world, player, line, step);
    return false;
  }
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return false;
  const held = frontier.rebuildTick;
  if (held === null) {
    world
      .mut(carrier, BuildOrderFrontier)
      .lines.set(line, { step: frontier.step, rebuildTick: tick + REBUILD_DELAY_TICKS });
    return true;
  }
  return tick < held;
}

/** Under siege the lines act on nothing and search nothing, so a lost step below its line's frontier only
 *  has its rebuild wait pushed out to run from the siege's end; the frontier stays where it is. */
function holdRebuildUnderAttack(
  world: World,
  player: number,
  line: BuildLineId,
  step: number,
  entry: BuildOrderEntry,
  tick: number,
): void {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return;
  const frontier = world.tryGet(carrier, BuildOrderFrontier)?.lines.get(line);
  if (frontier === undefined || step >= frontier.step) return;
  if (entry.kind !== 'place' && entry.kind !== 'upgrade') return;
  const held = frontier.rebuildTick;
  if (held === null || held < tick + REBUILD_DELAY_TICKS)
    world
      .mut(carrier, BuildOrderFrontier)
      .lines.set(line, { step: frontier.step, rebuildTick: tick + REBUILD_DELAY_TICKS });
}

/** Raise `line`'s frontier to `step`, its first unmet step at or past it (the line's length once all are
 *  met), and end any rebuild wait, since nothing below the frontier is unmet any more. Only this raises
 *  it, so every later loss below it waits out the delay again. */
function advanceFrontier(world: World, player: number, line: BuildLineId, step: number): void {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return;
  const record = world.tryGet(carrier, BuildOrderFrontier);
  const current = record?.lines.get(line);
  if (current !== undefined && current.step === step && current.rebuildTick === null) return;
  const frontier = { step, rebuildTick: null };
  if (record === undefined) world.add(carrier, BuildOrderFrontier, { lines: new Map([[line, frontier]]) });
  else world.mut(carrier, BuildOrderFrontier).lines.set(line, frontier);
}

/**
 * Whether acting on `step` of a line's `steps` would take the line more than the clock's lookahead
 * ({@link sitePace}) past its oldest step met only by a fresh site still going up. That step is found by
 * re-reading the line over the buildings that stand, a building mid-upgrade counted at the tier it has.
 * A step unmet over the sites too was passed over, not met by one, so it never holds the line; skipped
 * steps and lanes do not count toward the lookahead.
 */
function outrunsSites(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  steps: readonly BuildOrderEntry[],
  step: number,
  memo: DecisionMemo,
): boolean {
  const { lookahead } = sitePace(computerProfileOf(world, player), ctx.tick);
  if (step <= lookahead) return false;
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  let oldest = -1;
  for (let i = 0; i < step && oldest < 0; i++) {
    const entry = steps[i];
    if (entry === undefined || isLaneEntry(entry)) continue;
    if (entryStatus(world, ctx, player, standing, entry, memo, false) !== 'unmet') continue;
    if (entryStatus(world, ctx, player, owned, entry, memo) !== 'unmet') oldest = i;
  }
  if (oldest < 0) return false;
  let ahead = 0;
  for (let i = oldest + 1; i <= step; i++) {
    const entry = steps[i];
    if (entry === undefined || isLaneEntry(entry)) continue;
    if (entryStatus(world, ctx, player, owned, entry, memo) !== 'skip') ahead++;
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
    tribe,
    BASE_REPLACEMENT_ENTRY,
    underFire,
    false,
  );
  if (spot === null) return [];
  return [siteCommand(type, spot, tribe, player)];
}
