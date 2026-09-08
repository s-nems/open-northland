import type { MissionRecord } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import type { MissionScript } from './script.js';

/** One evaluation pass over the script: the inputs every goal and result reads, plus the mission
 *  records it writes. A result changes the world through the same seams a command handler uses, so
 *  the pass carries the world and the tick context rather than a slice of them. */
export interface MissionPass {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly script: MissionScript;
  readonly records: MissionRecord[];
  readonly tick: number;
  /** Report a goal or result opcode this build cannot run; deduplicated by the caller. */
  readonly report: (mission: number, opcode: string) => void;
  /** Report a result that ran but could not act on the world; deduplicated like {@link report}. */
  readonly reportFailed: (mission: number, opcode: string) => void;
  /** Missions whose goals are being evaluated right now, so a `CheckMission` cycle stops instead of
   *  recursing. Approximation: the original recurses without a guard. */
  readonly checking: Set<number>;
}

/**
 * Set a mission's active flag, recording the activation tick only on the inactive-to-active
 * transition, so re-activating an active mission never restarts its `TimeGone` clock. Out-of-range
 * indices are the corpus's own bad arguments and are skipped.
 */
export function setMissionActive(pass: MissionPass, index: number, active: boolean): void {
  const record = pass.records[index];
  if (record === undefined || record.active === active) return;
  record.active = active;
  if (active) record.activationTick = pass.tick;
}
