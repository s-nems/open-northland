import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import {
  aiControlEntity,
  Building,
  BuildOrderFrontier,
  BuildOrderPause,
  mapBriefOf,
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
import { homeBuildings, homeSettlers } from '../../ai-shared/home-roster.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { anchorCentroid, anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import { HEADQUARTERS_BUILDING_ID } from '../../readviews/index.js';
import { isServedConstructionSite } from '../../settlers/targets/index.js';
import { seatBaseOf } from '../base.js';
import { type ComputerProfile, computerProfileOf } from '../difficulty.js';
import { SITES_GROW_FROM_TICKS } from '../game-phase.js';
import type { ComputerModule } from '../index.js';
import { technologyReach } from '../technology/reach.js';
import { type TechnologyTable, technologyTable } from '../technology/requirements.js';
import { billSourced, goodsMadeBy, sourcedTiers } from './bill-sources.js';
import { directTier } from './direct-tier.js';
import {
  BASE_REPLACEMENT_ENTRY,
  BASE_REPLACEMENT_IDS,
  BASELESS_CONSTRUCTION_SITES,
  type BuildLine,
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  isLaneEntry,
  linesByPriority,
  REBUILD_DELAY_TICKS,
  type StepHold,
  type StepKey,
  sitePace,
  stepKey,
} from './entries.js';
import { foodChainStep, seatFoodFailing } from './food-first.js';
import { TOWER_CONTENT_IDS, towerUpgradeWaits } from './front.js';
import { grassReserved } from './grass-reserve.js';
import { keepGroundPlan } from './ground-plan.js';
import {
  daughtersBlocked,
  HOUSING_PACE,
  type HousingGate,
  homeTiersOf,
  housingExtraSites,
  housingGate,
  housingPick,
  housingStage,
} from './housing.js';
import { holdsNamedPaper, paperedPlacement, paperedSteps, paperedStore, stepTiers } from './papers.js';
import { placementPassesOver, placementSpot } from './placement.js';
import {
  type DecisionMemo,
  decisionMemo,
  type EntryStatus,
  entryStatus,
  type LineStatuses,
  lineStatuses,
  nothingToUpgrade,
  stepHeld,
  upgradeCandidate,
  upgradeFilter,
} from './progress.js';
import { DEFENCE_LINES, seatBuildOrder, seatDefenceFirst, seatSitePace } from './seat-order.js';
import { type Siege, seatSiege } from './siege.js';
import { StalledSearches } from './stalled-searches.js';
import {
  coverageLaneSites,
  coverageOf,
  coverageSpotSearch,
  firstUncovered,
  type TowerCoverage,
  towerRingSites,
} from './tower-coverage.js';
import { towerPlan, towerSpot, towerToUpgrade } from './tower-defence.js';
import { upgradeReach } from './upgrade-reach.js';
import { starvedUpgrade, suppliedUpgrade } from './upgrade-supply.js';

export * from './entries.js';
export { TOWER_CONTENT_IDS } from './front.js';
export {
  collectorGoodStocked,
  collectorGoodsWanted,
  type EntryStatus,
  entryStatuses,
  type LineStatuses,
  lineStatuses,
} from './progress.js';
export {
  ARCHETYPE_TUNING,
  defenceFirst,
  seatBuildOrder,
  seatSitePace,
  seatTuning,
  shapeBuildOrder,
} from './seat-order.js';
export { type Siege, seatSiege } from './siege.js';
export { DEFENCE_FIRST_WANT_PCT, OPENING_DEFENCE } from './tower-defence.js';

/** The seat's open sites that count against its pace: a workshop's hidden vehicle yard is the crew's own
 *  cycle, never a placement the list made, so it holds no slot. */
function constructionSites(world: World, ctx: SystemContext, owned: readonly Entity[]): Entity[] {
  return owned.filter((e) => isServedConstructionSite(world, ctx.content, e));
}

/** The adult men the seat keeps per open construction site before it opens a tower site (authored): the
 *  open sites' builder pair (`workforce/staffing.ts`) and a gatherer feeding them. Basis: on magiczny_las
 *  (seed 7) the seats held four or more men a site and grew; on specjalna_forteca a seat of six men
 *  opened three tower sites beside its homes and mill and finished none in 90 minutes. */
export const MEN_PER_OPEN_SITE = 3;

/** The open sites `player`'s men can staff ({@link MEN_PER_OPEN_SITE}), at least one: no tower site
 *  opens past it. Infinite for a seat with no man yet, whose sites wait for the men a script
 *  brings and keep the clock's pace alone. */
export function crewSiteCap(world: World, ctx: SystemContext, player: number): number {
  let men = 0;
  for (const e of homeSettlers(world, ctx, player)) if (isAllocatableMan(world, ctx, e)) men++;
  return men === 0 ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(men / MEN_PER_OPEN_SITE));
}

/** The housing lane's share of the open `sites`, a ring's towers standing apart left out: `beyond` is
 *  how many of its home sites stand past the clock's `siteCap` (all but its first, or all of them while
 *  `apart`, up to {@link housingExtraSites}), and `open` whether it may open one more: below its stage's
 *  sites ({@link HOUSING_PACE}) and below the clock's sites plus its extra. */
function homeSiteBudget(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  order: BuildOrder,
  sites: readonly Entity[],
  siteCap: number,
  apart: boolean,
): { readonly beyond: number; readonly open: boolean } {
  const entry = order.lines.flatMap((line) => line.steps).find((step) => step.kind === 'housing');
  if (entry?.kind !== 'housing') return { beyond: 0, open: false };
  const chain = homeTiersOf(ctx.content, entry);
  const homes = sites.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
  // The stage walks the seat's buildings, so it is read only when a home site could stand past the clock.
  if (!apart && homes === 0 && sites.length < siteCap) return { beyond: 0, open: true };
  const stage = housingStage(world, ctx, player, owned);
  const extra = housingExtraSites(stage, siteCap, apart);
  return {
    beyond: Math.max(0, Math.min(homes - (apart ? 0 : 1), extra)),
    open: homes < HOUSING_PACE[stage].sites && (apart ? homes < extra : sites.length < siteCap + extra),
  };
}

/** Whether a tower ring's sites stand beyond the clock's sites (owner ruling: towers are always good, and
 *  the ring stands by the military deadline): on a profile that never pauses, so the slower profiles' pace
 *  stays their throttle. On krwawa_rzeka, with the ring inside the clock's sites, the first tower went up
 *  only as the clock grew at minute 45 and one or two stood by minute 70. */
function ringApart(profile: ComputerProfile): boolean {
  return profile.freeSitePauseTicks === 0;
}

/** Whether `e` is a new tower site of a ring, not a standing tower rising a tier. */
function ringTowerSite(world: World, ctx: SystemContext, e: Entity): boolean {
  if (world.has(e, Upgrading)) return false;
  const type = contentIndex(ctx.content).buildings.get(world.get(e, Building).buildingType);
  return type !== undefined && TOWER_CONTENT_IDS.includes(type.id);
}

/** Whether the housing lane's home sites all stand beyond the clock's sites (authored): on a profile that
 *  never pauses, once the clock has grown ({@link SITES_GROW_FROM_TICKS}). On magiczny_las, with the first
 *  home counted, two home sites and two tower sites held every site of the third quarter hour past the
 *  peace and the second smithy, mint and brewery waited with a spot found. */
function homesApart(profile: ComputerProfile, tick: number): boolean {
  return profile.freeSitePauseTicks === 0 && tick >= SITES_GROW_FROM_TICKS;
}

/**
 * Runs the order's lines side by side. Each line acts on its first unmet step, so a razed building is
 * re-placed, after {@link REBUILD_DELAY_TICKS}, before any step of its line the seat has not reached yet;
 * a line never waits for another. A free construction site goes to the first line with a ready step in
 * {@link turnOrder}, the order's priority within each turn, one command a decision. A placed site meets
 * its step at once, so up to the clock's {@link sitePace} sites go up side by side, each line within its
 * lookahead of its own oldest unfinished step, and {@link EARNED_WORKSHOP_EXTRA_SITES} more for an earned
 * workshop. A lane step a line has reached runs beside the lines
 * ({@link openLanes}) while unmet and not held: it takes one of those sites for itself, a tower ring up to
 * {@link coverageLaneSites} while the lines keep one, and leaves the lines the rest, so a tower ring with
 * no room left stalls nothing; on a profile that never pauses a tower ring's sites stand beyond the clock's
 * instead ({@link ringApart}). The housing lane's further home sites, as its food stage allows
 * ({@link homeSiteBudget}), stand past the clock's sites, and all of them once the clock has grown
 * ({@link homesApart}). A line's tower or store ring keeps one site of its building at a time.
 * An unmet step with no legal action stalls its line rather than being skipped, so no later site of the
 * line draws off the goods it waits for: a step whose bill has no source yet ({@link billSourced}), a
 * placement that found no spot, retried every {@link STALLED_PLACEMENT_RETRY_DECISIONS} decisions, and an
 * upgrade while a bill good only it or another site could make is not yet in store, or while it would idle
 * a good's last working maker ({@link suppliedUpgrade}); one already open whose site lacks a good only it
 * could make, with no free stock of it left, is called off ({@link starvedUpgrade}). An upgrade raises its
 * building straight to the highest tier that step and the unmet upgrade steps right after it in its line want,
 * as far as the seat has the tiers enabled ({@link upgradeReach}) and the store backs the merged bill. A
 * placement or a ring raises the highest tier the same tests allow straight away ({@link directTier}). A step
 * whose building the seat has not discovered yet holds its line too, while the technology module earns it, so
 * a later step never runs ahead of the workshop it feeds on; one whose discovery can never come is skipped
 * ({@link entryStatus}), and a seat with no technology table, whose lock can only be a ban, passes it. A
 * step's `holdUntil` holds its line the same way, on the cases {@link StepHold} names.
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
  const order = seatBuildOrder(world, ctx, player, fullOrder, profile);
  const owned = homeBuildings(world, ctx, player);
  const base = seatBaseOf(world, ctx, player);
  const sites = constructionSites(world, ctx, owned);
  if (base === null) return replaceMissingBase(world, ctx, terrain, player, owned, sites);
  // An upgrade that waits on a good only it could make would hold its site, and every line whose bill
  // needs that good, for good: it is called off so the workshop makes the good again.
  const starved = starvedUpgrade(world, ctx, player, owned, sites);
  if (starved !== null) return [{ kind: 'cancelUpgrade', building: starved }];
  const memo = decisionMemo();
  let knownStatuses: LineStatuses | undefined;
  const statusesNow = (): LineStatuses =>
    (knownStatuses ??= lineStatuses(world, ctx, player, owned, order, memo));
  const carrier = aiControlEntity(world, player);
  const started = (command: PlayerCommand): readonly PlayerCommand[] => {
    if (carrier !== null && world.has(carrier, BuildOrderPause)) world.remove(carrier, BuildOrderPause);
    return [command];
  };
  if (holdsNamedPaper(world, player)) {
    const papered = paperedOpening(world, ctx, terrain, player, owned, base, order, statusesNow());
    if (papered !== null) return started(papered);
  }
  const siteCap = seatSitePace(world, player, profile, ctx.tick).sites;
  const apartRing = ringApart(profile);
  const ringTowers = apartRing ? sites.filter((e) => ringTowerSite(world, ctx, e)) : [];
  const ringSites = ringTowers.length;
  // The ring's towers stand beyond the clock's sites, so they never close the housing lane's.
  const homeSites = homeSiteBudget(
    world,
    ctx,
    player,
    owned,
    order,
    ringSites === 0 ? sites : sites.filter((e) => !ringTowers.includes(e)),
    siteCap,
    homesApart(profile, ctx.tick),
  );
  // A tower site opens only while the seat's men can staff one more site: the lines' and the homes'
  // sites come first on a seat of few men.
  const crewRoom = sites.length < crewSiteCap(world, ctx, player);
  const ringOpen = apartRing && crewRoom && ringSites < towerRingSites(world, ctx, player);
  // The home sites past the lane's first and the ring's tower sites stand beyond the clock's, so the
  // lines never count them.
  const paced = sites.length - homeSites.beyond - ringSites;
  // With the pace's sites taken, only an earned workshop, a home site or a ring tower may still go up.
  let earnedOnly = paced >= siteCap;
  // A step placed at its unlock goes up over the pace (`atUnlockCommand` below); a profile's free-site
  // pause still holds it.
  const unlockDue = atUnlockPending(world, ctx, order, owned);
  const paceFull = (): boolean =>
    earnedOnly && !homeSites.open && !ringOpen && !earnedSiteOpen(base, profile, paced, siteCap);
  if (!unlockDue && paceFull()) return [];
  if (!earnedOnly && base !== null && waitsOnFreeSite(world, carrier, profile, ctx.tick)) return [];

  const tribe = playerPlacementTribes(world, player)?.[0];
  // Scanned once the order has something to do: an idle decision never walks the map's people.
  let siege: Siege | null = null;
  const siegeOf = (): Siege => (siege ??= seatSiege(world, ctx, terrain, player, owned));
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return [];
  const index = contentIndex(ctx.content);
  const lines = linesByPriority(order);

  const statuses = statusesNow();
  const statusOf = (line: BuildLineId, step: number): EntryStatus | undefined => statuses.get(line)?.[step];
  const reserveGrass = grassReserved(ctx, terrain, anchor, order, statuses);
  if (tribe !== undefined) {
    keepGroundPlan(world, ctx, terrain, player, owned, anchor, tribe, order, statuses, {
      underFire: () => siegeOf().underFire,
      reserveGrass,
    });
  }
  const searches = new StalledSearches(world, player, keyedStatuses(order, statuses));
  let made: ReadonlySet<number> | undefined;
  const madeGoods = (): ReadonlySet<number> => (made ??= goodsMadeBy(world, ctx, owned));
  const locked = (entry: BuildOrderEntry): boolean =>
    stepLocked(world, ctx, player, owned, tribe, entry, memo);
  const held = (entry: BuildOrderEntry): boolean =>
    stepHeld(world, ctx, player, owned, order, statuses, entry, memo);
  /** A locked step its line passes over this decision rather than waits on. */
  const lockPassed = (entry: BuildOrderEntry): boolean => lockPasses(entry) && locked(entry);
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
          madeGoods,
        );
        if (tribe !== undefined) searches.searched(line.id, step, ctx.tick, verdict.kind === 'act', false);
      }
    }
    verdicts.set(key, verdict);
    return verdict;
  };

  let housing: HousingGate | undefined;
  const housingGateOf = (): HousingGate => (housing ??= housingGate(world, ctx, player, owned));
  // A placing paper the seat holds turns the site it would open into a finished building (`./papers.ts`).
  const papered = (command: PlayerCommand, entry: Parameters<typeof stepTiers>[1]): PlayerCommand =>
    command.kind === 'placeBuilding'
      ? paperedPlacement(world, ctx, terrain, player, order, command, stepTiers(ctx, entry))
      : command;
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
  const laneActive = (lane: OpenLane): boolean =>
    statusOf(lane.line, lane.step) === 'unmet' && !held(lane.entry);
  // The lines keep the sites the coverage lanes leave them, at least one, and count only their own; the
  // housing lane's first site is one of theirs. A coverage lane reserves a site only while it has work it
  // may do, so a held or met ring costs the lines nothing.
  let listSites = paced;
  let reserved = 0;
  for (const lane of lanes) {
    if (lane.entry.kind === 'housing' || (apartRing && lane.entry.kind === 'towerCoverage')) continue;
    listSites -= lane.sites;
    if (laneActive(lane)) reserved++;
  }

  const firstUnmet = (line: BuildLine): number =>
    line.steps.findIndex((entry, step) => !isLaneEntry(entry) && statusOf(line.id, step) === 'unmet');
  /** The command of `line`'s step at `step`, which acts this decision, or null while it holds its line. */
  const stepCommand = (line: BuildLine, step: number, entry: BuildOrderEntry): PlayerCommand | null => {
    switch (entry.kind) {
      case 'place': {
        if (tribe === undefined) return null;
        if (searches.waits(line.id, step, ctx.tick)) return null;
        const type = directTier(world, ctx, player, owned, tribe, entry, madeGoods);
        if (type === undefined) return null; // unreachable after 'skip', kept for the type system
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
        if (towerUpgradeWaits(world, ctx, player, entry.building)) return null;
        const candidate = upgradeCandidate(
          world,
          index,
          owned,
          target,
          upgradeFilter(world, ctx, player, entry, memo),
        );
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
        const reach = suppliedUpgrade(world, ctx, player, owned, candidate, tiers, firstRankStep(entry));
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

  const coverageRising = (entry: OpenLane['entry']): boolean => {
    const chain = laneTiers(ctx, entry);
    return sites.some((e) => chain.has(world.get(e, Building).buildingType));
  };

  /** The command of `line`'s first unmet step that is not passed over, or null while that step holds
   *  the line or the line has none. */
  const lineCommand = (line: BuildLine): PlayerCommand | null => {
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry) || statusOf(line.id, step) !== 'unmet') continue;
      if (held(entry)) return null;
      // A ring step raises one site at a time, so its slow far sites never take every free site.
      if ((entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && coverageRising(entry))
        return null;
      if (locked(entry)) {
        if (lockHolds && !lockPasses(entry)) return null;
        continue;
      }
      // An upgrade with nothing left below its tier is passed over, so a seat of fewer towers than the
      // army line upgrades still reaches the catapult joinery behind them.
      if (entry.kind === 'upgrade') {
        const target = buildingTypeByContentId(ctx.content, entry.building);
        const accept = upgradeFilter(world, ctx, player, entry, memo);
        if (target !== undefined && nothingToUpgrade(world, index, owned, target, accept)) continue;
      }
      if (!billSourced(world, ctx, player, entry, madeGoods)) return null;
      const verdict = verdictOf(line, step);
      if (verdict.kind === 'pass') continue;
      if (awaitingRebuild(world, player, line.id, step, entry, ctx.tick)) return null;
      if (listSites > 0 && outrunsSites(world, ctx, player, owned, line.steps, step, memo)) return null;
      searches.acting(line.id, step);
      const command = verdict.placement ?? stepCommand(line, step, entry);
      return command === null || entry.kind === 'upgrade' || entry.kind === 'collector'
        ? command
        : papered(command, entry);
    }
    advanceFrontier(world, player, line.id, line.steps.length);
    return null;
  };
  /** The command of the first `atUnlock` step that heads its line and may act, or null. The step goes
   *  up the moment its building unlocks: over the pace, ahead of the lanes and the turns, and past the
   *  lookahead on its line's rising sites; a hold, a locked tier or a bill with no source still waits. */
  const atUnlockCommand = (): PlayerCommand | null => {
    for (const line of lines) {
      for (const [step, entry] of line.steps.entries()) {
        if (isLaneEntry(entry) || statusOf(line.id, step) !== 'unmet') continue;
        if (!atUnlockStep(entry) || held(entry)) break;
        if (locked(entry)) {
          if (lockHolds && !lockPasses(entry)) break;
          continue;
        }
        if (!billSourced(world, ctx, player, entry, madeGoods)) break;
        const verdict = verdictOf(line, step);
        if (verdict.kind === 'pass') continue;
        searches.acting(line.id, step);
        const command = verdict.placement ?? stepCommand(line, step, entry);
        if (command !== null) return papered(command, entry);
        break;
      }
    }
    return null;
  };
  // Turns, priority deciding within each: a line with no site of its own rising goes before one with,
  // and a line whose next step raises a building the seat has none of before one adding another of a kind
  // it owns, so no line takes every site or runs its later copies while another still lacks its first. A
  // workshop whose discovery the seat just earned goes before them all, a step on its military deadline
  // before that, and while the seat's defence comes first its defence lines go first.
  // A line that stands met moves its frontier now, whichever line acts first, so its later losses wait.
  for (const line of lines)
    if (firstUnmet(line) < 0) advanceFrontier(world, player, line.id, line.steps.length);
  // The extra site also goes to a step on its military deadline, which a defence line ranks under its
  // defence turn while the seat's defence comes first.
  const takesExtraSite = (line: BuildLine, turn: number, extraSite: boolean): boolean => {
    if (extraSite) return true;
    const next = line.steps[firstUnmet(line)];
    return turn === TURN.defence && next !== undefined && deadlineStep(next);
  };
  const gated = lockHolds && tribe !== undefined ? technologyTable(ctx.content, tribe) : null;
  const defending = seatDefenceFirst(world, ctx, player);
  // A step waits for a site once neither its hold nor a discovery still to come keeps it back.
  const ready = (entry: BuildOrderEntry): boolean => !held(entry) && !(locked(entry) && lockHolds);
  const foodFailing = seatFoodFailing(world, ctx, player, owned);
  const byTurn = turnOrder(world, ctx, player, owned, lines, statusOf, memo, gated, defending, lockPassed, {
    foodFailing,
    ready,
  });
  const extraSiteOpen = earnedSiteOpen(base, profile, paced, siteCap);
  if (unlockDue) {
    if (!siegeOf().attacked) {
      const command = atUnlockCommand();
      if (command !== null) return started(command);
    }
    if (paceFull()) return [];
  }
  // A seat whose food production is missing gives its food turn, and a step already due, the free site
  // ahead of the lanes too, so a tower ring or a home never takes it first; under attack the lines hold.
  const tried = new Set<BuildLineId>();
  if (foodFailing && !siegeOf().attacked) {
    for (const { line, turn, extraSite } of byTurn) {
      if (turn > TURN.food) break;
      if (paced >= siteCap && !(takesExtraSite(line, turn, extraSite) && extraSiteOpen)) continue;
      tried.add(line.id);
      const command = lineCommand(line);
      if (command !== null) return started(command);
    }
  }
  for (const lane of lanes) {
    if (tribe === undefined || !laneActive(lane)) continue;
    const entry = lane.entry;
    if (entry.kind === 'towerCoverage' && !crewRoom) continue;
    if (entry.kind === 'housing') {
      if (!homeSites.open) continue;
    } else if (apartRing && entry.kind === 'towerCoverage') {
      if (lane.sites >= coverageLaneSites(world, ctx, player, entry)) continue;
    } else if (earnedOnly || !laneSiteOpen(world, ctx, player, entry, lane.sites, paced, siteCap)) continue;
    if (searches.waits(lane.line, lane.step, ctx.tick)) continue;
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
            madeGoods,
          );
    searches.searched(lane.line, lane.step, ctx.tick, placed !== null, false);
    if (placed !== null) return started(papered(placed, entry));
  }
  if (listSites >= Math.max(1, siteCap - reserved)) {
    if (!extraSiteOpen) return [];
    earnedOnly = true;
  }

  if (lines.some((line) => firstUnmet(line) >= 0) && siegeOf().attacked) {
    for (const line of lines) {
      const step = firstUnmet(line);
      const entry = line.steps[step];
      if (entry !== undefined) holdRebuildUnderAttack(world, player, line.id, step, entry, ctx.tick);
    }
    return [];
  }

  for (const { line, turn, extraSite } of byTurn) {
    if ((earnedOnly && !takesExtraSite(line, turn, extraSite)) || tried.has(line.id)) continue;
    const command = lineCommand(line);
    if (command !== null) return started(command);
  }
  return [];
}

/** A line's turn, the lower first: a defence line ({@link DEFENCE_LINES}) with no rising site of its own
 *  while the seat's defence comes first; a next placement waiting on the military deadline
 *  ({@link deadlineStep}), even beside a rising site of its own, and it takes the earned workshops' extra
 *  site too (owner ruling: the barracks stands a bit before the deadline; on krwawa_rzeka and magiczny_las
 *  under a 60-minute peace, with every site of the pace taken, it waited behind the economy's new kinds and
 *  earned workshops until minute 60-90); no rising site and a next step raising a workshop the seat lacks
 *  whose discovery it earned ({@link earnedWorkshop}); no rising site and a next step raising a kind it
 *  lacks or a copy placed ahead of the crews (owner ruling: a tunic seat's second tailor shop lost every
 *  freed site to new kinds until game minute 37-83 on krwawa_rzeka); no rising site; a site of its own
 *  still rising. On mroczny_las a seat defending from the first
 *  minute gave every freed site to its earned workshops and raised no barracks before the scripted wave.
 *  On a seat whose food production is missing ({@link seatFoodFailing}), a step ready to raise the first
 *  of a food chain kind comes right after the due steps, a rising site of its line or not, ahead of the
 *  lanes too, and takes the extra site only as an earned workshop (owner ruling: food before the
 *  population, weapons and joiner). A `core` step takes the earned turn and its extra site while no food
 *  turn waits: as a new kind the school never won a freed site from the earned workshops, and ahead of the
 *  food it beat the mill and bakery. A `firstRank` step keeps the turn of a first new kind, the earned one
 *  once discovered, beside a rising site of its line and as another of a kind the seat owns (owner
 *  ruling: the first brewery, its hive and well rank with the bakery; on magiczny_las the hive, unlocked
 *  with the brewery, waited out the brewery's eight to ten minute site in the rising turn, and the brewery
 *  brews nothing without honey). */
const TURN = { defence: 0, due: 1, food: 2, earned: 3, newKind: 4, more: 5, rising: 6 } as const;

/** Whether `entry` goes up at its building's unlock ({@link BuildOrderEntry} `atUnlock`). */
function atUnlockStep(entry: BuildOrderEntry): entry is Extract<BuildOrderEntry, { kind: 'place' }> {
  return entry.kind === 'place' && entry.atUnlock === true;
}

/** Whether some `atUnlock` step of `order` raises a kind the seat owns none of, the cheap test before
 *  the decision reads the lines' statuses for {@link atUnlockStep} placements. */
function atUnlockPending(
  world: World,
  ctx: SystemContext,
  order: BuildOrder,
  owned: readonly Entity[],
): boolean {
  let ownedTypes: Set<number> | undefined;
  for (const line of order.lines) {
    for (const entry of line.steps) {
      if (!atUnlockStep(entry)) continue;
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined) continue;
      ownedTypes ??= new Set(owned.map((e) => world.get(e, Building).buildingType));
      const tiers = countedTiers(ctx.content, type, entry.belowTier);
      if (![...tiers].some((kind) => ownedTypes?.has(kind) === true)) return true;
    }
  }
  return false;
}

/** Whether `entry` ranks with the bread chain's first buildings ({@link BuildOrderEntry} `firstRank`). */
function firstRankStep(entry: BuildOrderEntry): boolean {
  return (entry.kind === 'place' || entry.kind === 'upgrade') && entry.firstRank === true;
}

/** Whether `entry` is a placement its line holds until the military deadline's lead: once the hold opens
 *  it takes the next free site; while it holds, its line acts on nothing, so the turn costs no site. */
function deadlineStep(entry: BuildOrderEntry): boolean {
  return entry.kind === 'place' && entry.holdUntil !== undefined && waitsOnDeadline(entry.holdUntil);
}

function waitsOnDeadline(hold: StepHold): boolean {
  if (hold.kind === 'all' || hold.kind === 'any') return hold.holds.some(waitsOnDeadline);
  return hold.kind === 'deadline';
}

/** What the food rule asks of {@link turnOrder}: whether the seat's food fails ({@link seatFoodFailing}),
 *  and whether a step is ready for a site rather than held or waiting on a discovery. */
interface FoodTurn {
  readonly foodFailing: boolean;
  readonly ready: (entry: BuildOrderEntry) => boolean;
}

/** A line's {@link TURN}, and whether it may take the earned workshops' site over the pace. */
interface LineTurn {
  readonly line: BuildLine;
  readonly turn: number;
  readonly extraSite: boolean;
}

/** `lines`, stable in priority order, by {@link TURN}, each with its turn. `gated` holds the seat's
 *  technology table while its progression gates apply; `defending` whether its defence comes first; a
 *  `passed` step never heads its line. */
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
  passed: (entry: BuildOrderEntry) => boolean,
  food: FoodTurn,
): LineTurn[] {
  const standing = owned.filter((e) => !world.has(e, UnderConstruction) || world.has(e, Upgrading));
  const ownedTypes = new Set(owned.map((e) => world.get(e, Building).buildingType));
  /** Whether the seat owns a building `entry` counts, so the step adds another of a kind it has. */
  const ownsKind = (entry: BuildOrderEntry, type: BuildingType): boolean => {
    // An unmet role step has no building of its tiers holding the role, so it raises a kind the seat lacks.
    if (entry.kind === 'place' && entry.role !== undefined) return false;
    const below = entry.kind === 'place' || entry.kind === 'upgrade' ? entry.belowTier : undefined;
    for (const kind of countedTiers(ctx.content, type, below)) if (ownedTypes.has(kind)) return true;
    return false;
  };
  const heads = lines.map((line) => {
    let next: BuildOrderEntry | undefined;
    let rising = false;
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry)) continue;
      const status = statusOf(line.id, step);
      if (
        !rising &&
        status === 'satisfied' &&
        entryStatus(world, ctx, player, standing, entry, memo, false) === 'unmet'
      )
        rising = true;
      if (status === 'unmet' && !passed(entry)) next ??= entry;
      if (rising && next !== undefined) break;
    }
    const type =
      next === undefined || next.kind === 'collector'
        ? undefined
        : buildingTypeByContentId(ctx.content, next.building);
    // The food turn raises the first of a food chain kind; copies wait their turn like any other.
    const feeds =
      food.foodFailing &&
      next !== undefined &&
      type !== undefined &&
      foodChainStep(ctx, next) &&
      !ownsKind(next, type) &&
      food.ready(next);
    return { line, next, type, rising, feeds };
  });
  const foodWaits = heads.some((head) => head.feeds);
  const rank = (head: (typeof heads)[number]): Omit<LineTurn, 'line'> => {
    const { line, next, type, rising, feeds } = head;
    const plain = (turn: number): Omit<LineTurn, 'line'> => ({
      turn,
      extraSite: turn === TURN.due || turn === TURN.earned,
    });
    if (defending && !rising && next !== undefined && DEFENCE_LINES.includes(line.id))
      return plain(TURN.defence);
    // A later step met by a rising site, such as a tower upgrade met by a ring tower raised at the upper
    // tier, never puts a deadline step behind the economy.
    if (next !== undefined && deadlineStep(next)) return plain(TURN.due);
    const earned = type !== undefined && earnedWorkshop(gated, type);
    if (feeds) return { turn: TURN.food, extraSite: earned };
    const ranked = next !== undefined && firstRankStep(next);
    if (rising && !ranked) return plain(TURN.rising);
    if (next === undefined || next.kind === 'collector' || type === undefined) return plain(TURN.newKind);
    if (!ranked && ownsKind(next, type))
      return plain(next.kind === 'place' && next.aheadOfCrews === true ? TURN.newKind : TURN.more);
    if (earned || (next.kind === 'place' && next.core === true && !foodWaits)) return plain(TURN.earned);
    return plain(TURN.newKind);
  };
  return heads.map((head) => ({ line: head.line, ...rank(head) })).sort((a, b) => a.turn - b.turn);
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

/** Whether `entry` is passed over rather than holding its line while its building's tier is locked. */
function lockPasses(entry: BuildOrderEntry): boolean {
  return (entry.kind === 'place' || entry.kind === 'upgrade') && entry.lockPasses === true;
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
  memo: DecisionMemo,
): boolean {
  if (tribe === undefined || entry.kind === 'collector') return false;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return false;
  if (entry.kind !== 'upgrade') return !buildingEnabled(world, ctx, player, tribe, type.typeId);
  const index = contentIndex(ctx.content);
  const candidate = upgradeCandidate(
    world,
    index,
    owned,
    type,
    upgradeFilter(world, ctx, player, entry, memo),
  );
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
type Verdict = { readonly kind: 'pass' } | { readonly kind: 'act'; readonly placement: PlayerCommand | null };

const ACTS: Verdict = { kind: 'act', placement: null };
const PASSED_OVER: Verdict = { kind: 'pass' };

/** Whether an unmet `entry` is one its line passes over rather than stalls on when its search finds
 *  nothing. */
function passesOver(ctx: SystemContext, entry: BuildOrderEntry): boolean {
  if (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') return true;
  return entry.kind === 'place' && placementPassesOver(ctx, entry);
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
  made: () => ReadonlySet<number>,
): Verdict {
  if (tribe === undefined) return ACTS;
  switch (entry.kind) {
    case 'place': {
      if (!placementPassesOver(ctx, entry)) return ACTS;
      const type = directTier(world, ctx, player, owned, tribe, entry, made);
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
        made,
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
 *  but the gatherer steps stands met or passed over, and the clock has reached the lane's `fromTick`; a housing lane also opens
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
      // A gatherer step holds the line's sites, never its lanes: the workforce fills it out of spare men,
      // which a seat of few men may not have for an hour.
      if (entry.kind === 'collector') continue;
      if (reached && statuses.get(line.id)?.[step] === 'unmet' && !passedOver(line, step)) reached = false;
    }
  }
  return lanes;
}

/** Whether a coverage lane holding `own` sites may open another: its first always, more up to its
 *  {@link coverageLaneSites} while the seat's `paced` sites still leave the lines one of the `siteCap`. */
function laneSiteOpen(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<OpenLane['entry'], { kind: 'towerCoverage' | 'storeCoverage' }>,
  own: number,
  paced: number,
  siteCap: number,
): boolean {
  if (own === 0) return true;
  return own < coverageLaneSites(world, ctx, player, entry) && paced + 1 < siteCap;
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
 * The site a coverage entry raises next, or null when no target has a legal spot: a tower ring's
 * ({@link towerCommand}), or a store ring's first target with one, in target order, a flag beyond the
 * seat's build reach or ground another store already serves passed over, at the tier {@link directTier}
 * picks. Nothing while the entry's own tier is not enabled yet.
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
  made: () => ReadonlySet<number>,
): PlayerCommand | null {
  const base = buildingTypeByContentId(ctx.content, entry.building);
  if (base === undefined) return null; // unreachable after 'skip', kept for the type system
  if (!buildingEnabled(world, ctx, player, tribe, base.typeId)) return null;
  const type = directTier(world, ctx, player, owned, tribe, entry, made) ?? base;
  const coverage = coverageOf(world, ctx, player, entry);
  if (coverage.by === 'tower')
    return towerCommand(world, ctx, terrain, player, owned, tribe, base, type, coverage, underFire, {
      reserveGrass,
      made,
    });
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

/** A short tower ring's next command (`./tower-defence.ts`): the upgrade of a lower tower that lifts its
 *  defence, while the seat may start one, else a new tower of `type` where it lifts the lowest covered
 *  target most. */
function towerCommand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  tribe: number,
  base: BuildingType,
  type: BuildingType,
  coverage: TowerCoverage,
  underFire: EnemyFire,
  decision: { readonly reserveGrass: boolean; readonly made: () => ReadonlySet<number> },
): PlayerCommand | null {
  const plan = towerPlan(world, ctx, player, owned, coverage);
  if (plan === null || plan.short.length === 0) return null;
  const upper =
    base.upgradeTarget === undefined
      ? undefined
      : contentIndex(ctx.content).buildings.get(base.upgradeTarget);
  if (
    upper !== undefined &&
    buildingEnabled(world, ctx, player, tribe, upper.typeId) &&
    !towerUpgradeWaits(world, ctx, player, upper.id)
  ) {
    const candidate = towerToUpgrade(world, ctx, owned, plan, upper);
    const tiers = candidate === null ? [] : sourcedTiers(world, ctx, player, [upper.typeId], decision.made);
    const reach =
      candidate === null ? undefined : suppliedUpgrade(world, ctx, player, owned, candidate, tiers);
    if (candidate !== null && reach !== undefined)
      return { kind: 'upgradeBuilding', building: candidate, target: reach };
  }
  const spot = towerSpot(world, ctx, terrain, player, plan, type, tribe, underFire, decision.reserveGrass);
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

/** The placement spending a named paper on the first step {@link paperedSteps} finds a spot for, a line
 *  whose papered step finds none passing to the next line, else a warehouse paper ({@link paperedStore})
 *  where the seat's store coverage is short; null under attack or with nothing to place. */
function paperedOpening(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  base: Entity,
  order: BuildOrder,
  statuses: LineStatuses,
): PlaceCommand | null {
  const tribe = playerPlacementTribes(world, player)?.[0];
  const anchor = anchorNodeOf(world, base);
  if (tribe === undefined || anchor === null) return null;
  const searches = new StalledSearches(world, player, keyedStatuses(order, statuses));
  let siege: Siege | null = null;
  let reserveGrass: boolean | undefined;
  const stalledLines = new Set<BuildLineId>();
  for (const { line, step, entry, tier, paper } of paperedSteps(world, ctx, player, order, statuses)) {
    if (stalledLines.has(line.id) || searches.waits(line.id, step, ctx.tick)) {
      stalledLines.add(line.id);
      continue;
    }
    const type = contentIndex(ctx.content).buildings.get(tier);
    if (type === undefined) continue;
    siege ??= seatSiege(world, ctx, terrain, player, owned);
    if (siege.attacked) return null;
    if (awaitingRebuild(world, player, line.id, step, entry, ctx.tick)) {
      stalledLines.add(line.id);
      continue;
    }
    reserveGrass ??= grassReserved(ctx, terrain, anchor, order, statuses);
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
      siege.underFire,
      reserveGrass,
    );
    searches.searched(line.id, step, ctx.tick, spot !== null, true);
    if (spot === null) {
      stalledLines.add(line.id);
      continue;
    }
    searches.acting(line.id, step);
    return { ...siteCommand(type, spot, tribe, player), paper };
  }
  const store = paperedStore(world, ctx, player, order, statuses);
  if (store === null || searches.waits(store.line.id, store.step, ctx.tick)) return null;
  siege ??= seatSiege(world, ctx, terrain, player, owned);
  if (siege.attacked) return null;
  reserveGrass ??= grassReserved(ctx, terrain, anchor, order, statuses);
  const coverage = { by: 'store', radius: store.entry.radius } as const;
  const spot = firstUncovered(
    world,
    ctx,
    player,
    owned,
    coverage,
    coverageSpotSearch(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      store.type,
      tribe,
      coverage,
      siege.underFire,
      reserveGrass,
    ),
  );
  searches.searched(store.line.id, store.step, ctx.tick, spot !== null, true);
  if (spot === null) return null;
  searches.acting(store.line.id, store.step);
  return { ...siteCommand(store.type, spot, tribe, player), paper: store.paper };
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

/** The first of {@link BASE_REPLACEMENT_IDS} the seat may raise and has a source for every good of its
 *  bill ({@link billSourced}), else the lowest tier the content has. */
function baseReplacementType(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  tribe: number,
): BuildingType | undefined {
  let made: ReadonlySet<number> | undefined;
  const madeGoods = (): ReadonlySet<number> => (made ??= goodsMadeBy(world, ctx, owned));
  let lowest: BuildingType | undefined;
  for (const id of BASE_REPLACEMENT_IDS) {
    const type = buildingTypeByContentId(ctx.content, id);
    if (type === undefined) continue;
    lowest = type;
    const entry = { ...BASE_REPLACEMENT_ENTRY, building: id };
    if (
      buildingEnabled(world, ctx, player, tribe, type.typeId) &&
      billSourced(world, ctx, player, entry, madeGoods)
    )
      return type;
  }
  return lowest;
}

/** Where the seat's start headquarters stood, as the map brief recorded it, or null. */
function startHeadquartersNode(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const hq = buildingTypeByContentId(ctx.content, HEADQUARTERS_BUILDING_ID);
  if (hq === undefined) return null;
  const start = mapBriefOf(world)?.seats.find((seat) => seat.player === player);
  const record = start?.buildings.find((b) => b.buildingType === hq.typeId);
  return record === undefined ? null : { hx: record.hx, hy: record.hy };
}

/** A seat that holds buildings but no base rebuilds one where its start headquarters stood, else at the
 *  centroid of what stands (owner ruling: one warehouse in the headquarters' place). Every other step and
 *  lane waits meanwhile; the sites already open go on rising, and the warehouse is placed once, at most
 *  {@link BASELESS_CONSTRUCTION_SITES} store sites among `sites` open at a time. */
function replaceMissingBase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  sites: readonly Entity[],
): readonly PlayerCommand[] {
  const buildings = contentIndex(ctx.content).buildings;
  const storeSites = sites.filter(
    (e) => buildings.get(world.get(e, Building).buildingType)?.kind === 'storage',
  );
  if (storeSites.length >= BASELESS_CONSTRUCTION_SITES) return [];
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (tribe === undefined) return [];
  const siege = seatSiege(world, ctx, terrain, player, owned);
  if (siege.attacked) return [];
  const centre = startHeadquartersNode(world, ctx, player) ?? anchorCentroid(world, owned);
  if (centre === null) return [];
  const type = baseReplacementType(world, ctx, player, owned, tribe);
  if (type === undefined) return []; // content without a warehouse expresses no replacement
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
    siege.underFire,
    false,
  );
  if (spot === null) return [];
  return [siteCommand(type, spot, tribe, player)];
}
