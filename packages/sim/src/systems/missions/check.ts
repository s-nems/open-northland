import { type MissionRecord, tributePaid } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import { landscapeView } from '../landscape/view.js';
import {
  animalsGone,
  housesGone,
  humansDiedHolds,
  humansGone,
  humansKilledHolds,
  soldiersDiedHolds,
} from './goals/casualties.js';
import { chestNearPoint } from './goals/chests.js';
import { neededMatches } from './goals/count.js';
import {
  animalsExploredHolds,
  housesExploredHolds,
  humansExploredHolds,
  pointExploredHolds,
} from './goals/explored.js';
import {
  goodProduceableHolds,
  goodsGlobalHolds,
  goodsInAreaHolds,
  goodsInHousesHolds,
  goodsInHousesInAreaHolds,
  jobEnabledHolds,
} from './goals/goods.js';
import {
  attachedToWorkHouseHolds,
  buildHousesHolds,
  buildHumansHolds,
  humanJobHolds,
  humansWithHomeHolds,
  populationHolds,
  soldierCountHolds,
} from './goals/population.js';
import {
  animalsInArea,
  civiliansNearPoint,
  countAnimals,
  guideNearPoint,
  housesInArea,
  humansNearHouses,
  humansNearHumans,
  humansNearPoint,
  playerNearHumans,
  playerNearPoint,
  soldiersNearPoint,
} from './goals/proximity.js';
import {
  diplomacyStateHolds,
  playerAttackedHolds,
  playerDiedHolds,
  playerSeenHolds,
} from './goals/standing.js';
import type { MissionPass } from './pass.js';
import { setMissionActive } from './pass.js';
import { executeResult } from './results/index.js';
import { isSuccessfulIfRule, type MissionGoalOp, ruleSatisfied } from './script.js';

/**
 * Evaluate mission `index`: store each goal's current truth, judge the count against `successfullif`
 * and, when `execute` is set and the rule holds, clear the active flag and run every result in order.
 * The verdict is stored on the record either way, which is what makes a `CheckMission` probe visible
 * to a later `IsMissionDone`.
 */
export function checkMission(pass: MissionPass, index: number, execute: boolean): boolean | undefined {
  const definition = pass.script.missions[index];
  const record = pass.records[index];
  if (definition === undefined || record === undefined) return false;
  // A recursive probe has no known answer, including under a none-rule.
  if (pass.checking.has(index)) return undefined;
  pass.checking.add(index);
  let held = 0;
  const unknown: number[] = [];
  for (let goal = 0; goal < definition.goals.length; goal++) {
    const op = definition.goals[goal];
    const holds = op !== undefined && goalHolds(pass, index, record, goal, op);
    record.goalsHeld[goal] = holds === true;
    if (holds === undefined) unknown.push(goal);
    else if (holds) held++;
  }
  pass.checking.delete(index);
  if (unknown.length > 0) record.unknownGoals = unknown;
  else delete record.unknownGoals;
  const verdict = ruleVerdict(definition.successfullIf, held, definition.goals.length, unknown.length);
  if (verdict && execute) {
    // The active flag is cleared before the results run, so a mission that re-activates itself keeps
    // the activation its own results asked for.
    setMissionActive(pass, index, false);
    record.firstFiredTick ??= pass.tick;
    record.lastFiredTick = pass.tick;
    record.fireCount = (record.fireCount ?? 0) + 1;
    for (const result of definition.results) executeResult(pass, index, result);
  }
  record.evaluated = verdict === true;
  return verdict;
}

function goalHolds(
  pass: MissionPass,
  index: number,
  record: MissionRecord,
  goal: number,
  op: MissionGoalOp,
): boolean | undefined {
  switch (op.opcode) {
    case 'IsAnyLandscapeOnPoint':
      if (pass.ctx.terrain?.landscapes === undefined) {
        pass.report(index, op.opcode);
        return undefined;
      }
      return landscapeView(pass.world, pass.ctx.terrain).placements.some(
        (p) => p.hx === op.point.hx && p.hy === op.point.hy,
      );
    case 'NumberOfAnimals':
      return (
        countAnimals(pass.world, op.player, op.tribe, neededMatches(op.amount)) >= neededMatches(op.amount)
      );
    case 'True':
      return true;
    case 'TimeGone':
      return elapsed(pass, record, op.seconds);
    case 'RandomTimeGone':
      return randomTimeGone(pass, record, goal, op.seconds);
    case 'IfMissionIsActive':
      return pass.records[op.missionIndex]?.active ?? false;
    case 'CheckMission':
      return checkMission(pass, op.missionIndex, false);
    case 'IsMissionDone':
      return missionDone(pass, op.missionIndex);
    case 'BuildHumans':
      return buildHumansHolds(pass, op);
    case 'BuildHouses':
      return buildHousesHolds(pass, op);
    case 'HumansDied':
      return humansGone(pass.world, op.humanId);
    case 'HousesDied':
      return housesGone(pass.world, op.objectId);
    case 'AnimalsDied':
      return animalsGone(pass.world, op.objectId);
    case 'NumberOfHumansDied':
      return humansDiedHolds(pass.world, op.player, op.amount);
    case 'SoldiersDied':
      return soldiersDiedHolds(pass.world, op.player, op.amount);
    case 'NumberOfHumansKilled':
      return humansKilledHolds(pass.world, op.player, op.amount);
    case 'Population':
      return populationHolds(pass.world, op.player, op.amount);
    case 'NumberOfSoldiers':
      return soldierCountHolds(pass, op.player, op.amount);
    case 'HumansWithHome':
      return humansWithHomeHolds(pass.world, op.player, op.amount);
    case 'CheckHumanJob':
      return humanJobHolds(pass.world, op.humanId, op.job);
    case 'HumanAttachedToWorkHouse':
      return attachedToWorkHouseHolds(pass.world, op);
    case 'DetectGuide':
      return guideNearPoint(pass.world, op);
    case 'FindPosByHumans':
      return humansNearPoint(pass.world, op);
    case 'FindPosByPlayersMapMoveable':
      return playerNearPoint(pass.world, op);
    case 'FindHumansByHumans':
      return humansNearHumans(pass.world, op);
    case 'FindHumansByPlayersMM':
      return playerNearHumans(pass.world, op);
    case 'FindHousesByHumans':
      return humansNearHouses(pass.world, op);
    case 'NumberOfSoldiersNearPos':
      return soldiersNearPoint(pass, op);
    case 'NumberOfCivilainsNearPos':
      return civiliansNearPoint(pass, op);
    case 'ChestNearPos':
      return chestNearPoint(pass, op);
    case 'NumberOfHousesInArea':
      return housesInArea(pass.world, op);
    case 'NumberOfAnimalsInArea':
      return animalsInArea(pass.world, op);
    case 'GoodsInHouses':
      return goodsInHousesHolds(pass, op.objectId, op.good, op.amount);
    case 'GoodsGlobal':
      return goodsGlobalHolds(pass, op.player, op.good, op.amount);
    case 'NumberOfGoodsInArea':
      return goodsInAreaHolds(pass, op);
    case 'NumberOfGoodsInHousesInArea':
      return goodsInHousesInAreaHolds(pass, op);
    case 'JobEnabled':
      return jobEnabledHolds(pass, op);
    case 'GoodProduceable':
      return goodProduceableHolds(pass, op);
    case 'FindPos':
      return pointExploredHolds(pass, op);
    case 'FindHumans':
      return humansExploredHolds(pass, op);
    case 'FindHouses':
      return housesExploredHolds(pass, op);
    case 'FindAnimals':
      return animalsExploredHolds(pass, op);
    case 'PlayerDied':
      return playerDiedHolds(pass.world, op.player);
    case 'DiplomacyState':
      return diplomacyStateHolds(pass.world, op);
    case 'PlayerSeen':
      return playerSeenHolds(pass, op);
    case 'PlayerAttackedByPlayer':
      return playerAttackedHolds(pass.world, op);
    case 'PayTribute':
      return tributePaid(pass.world, op.slot);
    default:
      pass.report(index, op.opcode);
      // Unknown is distinct from false: a none-rule must not invert missing implementation into success.
      return undefined;
  }
}

function elapsed(pass: MissionPass, record: MissionRecord, seconds: number): boolean {
  return pass.tick >= record.activationTick + seconds * TICKS_PER_SECOND;
}

/**
 * Holds once a drawn span has passed since activation: uniformly over `[h, 2h)` seconds for
 * `h = floor(n/2)`, which is `[n/2, n)` for an even `n` and one second short of it for an odd one,
 * the original's own integer arithmetic. The draw is
 * cached until the span elapses and cleared the moment it does, so a mission that the goal alone
 * cannot fire draws a fresh span on every later check and consumes the shared generator as it goes -
 * the original clears its cache on the same edge and draws from the one game generator too. An `n`
 * under 2 leaves an empty range and holds at once without drawing, where the original divides by
 * zero.
 */
function randomTimeGone(pass: MissionPass, record: MissionRecord, goal: number, seconds: number): boolean {
  let drawn = record.randomSeconds[goal] ?? 0;
  if (drawn === 0) {
    const half = Math.floor(seconds / 2);
    drawn = half > 0 ? half + pass.ctx.rng.int(half) : 0;
    record.randomSeconds[goal] = drawn;
  }
  if (!elapsed(pass, record, drawn)) return false;
  record.randomSeconds[goal] = 0;
  return true;
}

/** Mission `index`'s stored goal flags judged by its own rule, with no re-evaluation: it stays true
 *  after that mission fired, and a never-checked mission answers true under the `none` rule. A rule
 *  outside the four, which the mission itself treats as always holding, answers false here (reading). */
function missionDone(pass: MissionPass, index: number): boolean | undefined {
  const definition = pass.script.missions[index];
  const record = pass.records[index];
  if (definition === undefined || record === undefined) return false;
  if (!isSuccessfulIfRule(definition.successfullIf)) return false;
  const held = record.goalsHeld.reduce((count, flag) => (flag ? count + 1 : count), 0);
  return ruleVerdict(
    definition.successfullIf,
    held,
    definition.goals.length,
    record.unknownGoals?.length ?? 0,
  );
}

/** A rule is decided only when every possible value of its unknown goals gives the same answer. */
function ruleVerdict(rule: number, held: number, total: number, unknown: number): boolean | undefined {
  const minimum = ruleSatisfied(rule, held, total);
  const maximum = ruleSatisfied(rule, held + unknown, total);
  return minimum === maximum ? minimum : undefined;
}
