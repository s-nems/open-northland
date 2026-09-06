import type { MissionRecord } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { MissionPass } from './pass.js';
import { setMissionActive } from './pass.js';
import { executeResult } from './results.js';
import { type MissionGoalOp, ruleSatisfied } from './script.js';

/**
 * Evaluate mission `index`: store each goal's current truth, judge the count against `successfullif`
 * and, when `execute` is set and the rule holds, clear the active flag and run every result in order.
 * The verdict is stored on the record either way, which is what makes a `CheckMission` probe visible
 * to a later `IsMissionDone`.
 */
export function checkMission(pass: MissionPass, index: number, execute: boolean): boolean {
  const definition = pass.script.missions[index];
  const record = pass.records[index];
  if (definition === undefined || record === undefined) return false;
  // A `CheckMission` cycle would otherwise recurse until the stack gives out.
  if (pass.checking.has(index)) return record.evaluated;
  pass.checking.add(index);
  let held = 0;
  for (let goal = 0; goal < definition.goals.length; goal++) {
    const op = definition.goals[goal];
    const holds = op !== undefined && goalHolds(pass, index, record, goal, op);
    record.goalsHeld[goal] = holds;
    if (holds) held++;
  }
  pass.checking.delete(index);
  const verdict = ruleSatisfied(definition.successfullIf, held, definition.goals.length);
  if (verdict && execute) {
    // The active flag is cleared before the results run, so a mission that re-activates itself keeps
    // the activation its own results asked for.
    setMissionActive(pass, index, false);
    for (const result of definition.results) executeResult(pass, index, result);
  }
  record.evaluated = verdict;
  return verdict;
}

function goalHolds(
  pass: MissionPass,
  index: number,
  record: MissionRecord,
  goal: number,
  op: MissionGoalOp,
): boolean {
  switch (op.opcode) {
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
    default:
      pass.report(index, op.opcode);
      // An opcode this build cannot judge holds nowhere, so its mission waits rather than firing on
      // an answer nobody computed.
      return false;
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
    drawn = half > 0 ? half + pass.rng.int(half) : 0;
    record.randomSeconds[goal] = drawn;
  }
  if (!elapsed(pass, record, drawn)) return false;
  record.randomSeconds[goal] = 0;
  return true;
}

/** Mission `index`'s stored goal flags judged by its own rule, with no re-evaluation: it stays true
 *  after that mission fired, and a never-checked mission answers true under the `none` rule. */
function missionDone(pass: MissionPass, index: number): boolean {
  const definition = pass.script.missions[index];
  const record = pass.records[index];
  if (definition === undefined || record === undefined) return false;
  const held = record.goalsHeld.reduce((count, flag) => (flag ? count + 1 : count), 0);
  return ruleSatisfied(definition.successfullIf, held, definition.goals.length);
}
