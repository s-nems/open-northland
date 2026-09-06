import type { MissionRecord } from '../../components/index.js';
import type { EventBuffer } from '../../core/events.js';
import type { Rng } from '../../core/rng.js';
import type { MissionScript } from './script.js';

/** One evaluation pass over the script: the inputs every goal and result reads, plus the mission
 *  records it writes. */
export interface MissionPass {
  readonly script: MissionScript;
  readonly records: MissionRecord[];
  readonly tick: number;
  readonly rng: Rng;
  readonly events: EventBuffer;
  /** Report a goal or result opcode this build cannot run; deduplicated by the caller. */
  readonly report: (mission: number, opcode: string) => void;
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
