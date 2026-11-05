import {
  aiControlEntity,
  Building,
  BuildOrderPause,
  playerPlacementTribes,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import { everyBuildingOf, homeBuildings } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { seatBaseOf } from '../base.js';
import { computerProfileOf } from '../difficulty.js';
import type { ComputerModule } from '../index.js';
import { technologyReach } from '../technology/reach.js';
import { technologyTable } from '../technology/requirements.js';
import { towerUpgradeWaits } from './ground/front.js';
import { grassReserved } from './ground/grass-reserve.js';
import { keepGroundPlan } from './ground/ground-plan.js';
import { placementSpot, siteCommand } from './ground/placement.js';
import { keepSeatRoom } from './ground/room.js';
import {
  type BuildLine,
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  type EntryStatus,
  isLaneEntry,
  type LineStatuses,
  linesByPriority,
  type StepHold,
  type StepKey,
  stepKey,
} from './order/entries.js';
import { REBUILD_DELAY_TICKS, sitePace } from './order/limits.js';
import { seatBuildOrder, seatDefenceFirst, seatSitePace } from './order/seat-order.js';
import { seatFoodFailing } from './steps/food-first.js';
import { stepHeld } from './steps/holds.js';
import { daughtersBlocked, type HousingGate, housingGate } from './steps/housing.js';
import { decisionMemo } from './steps/memo.js';
import { holdsNamedPaper, paperedOpening, paperedPlacement, stepTiers } from './steps/papers.js';
import { keyedStatuses, StalledSearches } from './steps/stalled-searches.js';
import {
  entryStatus,
  lineStatuses,
  nothingToUpgrade,
  upgradeCandidate,
  upgradeFilter,
} from './steps/status.js';
import { billSourced, goodsMadeBy, sourcedTiers } from './supply/bill-sources.js';
import { directTier } from './supply/direct-tier.js';
import { homeStoreLift } from './supply/store-lift.js';
import { upgradeReach } from './supply/upgrade-reach.js';
import { starvedUpgrade, suppliedUpgrade } from './supply/upgrade-supply.js';
import { type Siege, seatSiege } from './towers/siege.js';
import { coverageLaneSites, towerRingSites } from './towers/tower-coverage.js';

export { TOWER_CONTENT_IDS } from './ground/front.js';
export * from './order/default-order.js';
export type { EntryStatus, LineStatuses } from './order/entries.js';
export * from './order/entries.js';
export * from './order/limits.js';
export {
  ARCHETYPE_TUNING,
  defenceFirst,
  seatBuildOrder,
  seatSitePace,
  seatTuning,
  shapeBuildOrder,
} from './order/seat-order.js';
export { crewSiteCap, EARNED_WORKSHOP_EXTRA_SITES, MEN_PER_OPEN_SITE } from './site-budget.js';
export { collectorGoodStocked, collectorGoodsWanted, entryStatuses, lineStatuses } from './steps/status.js';
export { type Siege, seatSiege } from './towers/siege.js';
export { DEFENCE_FIRST_WANT_PCT, OPENING_DEFENCE } from './towers/tower-defence.js';

import { replaceMissingBase } from './base-replacement.js';
import {
  ACTS,
  coverageCommand,
  housingCommand,
  PASSED_OVER,
  passesOver,
  searchVerdict,
  type Verdict,
} from './commands.js';
import { laneSiteOpen, laneTiers, type OpenLane, openLanes } from './lanes.js';
import {
  constructionSites,
  crewSiteCap,
  EARNED_WORKSHOP_EXTRA_SITES,
  earnedSiteOpen,
  homeSiteBudget,
  homesApart,
  housingCap,
  outrunsSites,
  ringApart,
  ringTowerSite,
  waitsOnFreeSite,
} from './site-budget.js';
import { advanceFrontier, awaitingRebuild, holdRebuildUnderAttack } from './steps/frontier.js';
import {
  atUnlockPending,
  atUnlockStep,
  deadlineStep,
  firstRankStep,
  lockPasses,
  stepLocked,
  TURN,
  turnOrder,
} from './turns.js';

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
  // A warehouse below the top tier goes up to it ahead of the steps, on one of the pace's sites.
  const lift = earnedOnly ? null : homeStoreLift(world, ctx, player, owned, base);
  if (lift !== null && !siegeOf().attacked) return started(lift);
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return [];
  // Measured before the statuses, so the filled tower ring reads the same room as the homes.
  if (tribe !== undefined)
    keepSeatRoom(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      tribe,
      housingCap(world, player, order),
      () => siegeOf().underFire,
    );
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
  const madeGoods = (): ReadonlySet<number> =>
    (made ??= goodsMadeBy(world, ctx, everyBuildingOf(world, player)));
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
  // A placing paper the seat holds turns the site it would open into a finished building (`./steps/papers.ts`).
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
