import type { MapAiSeat, MapAiTask } from '@open-northland/data';
import { type IntentPoint, type MissionTiming, slotTrigger, type Trigger } from './triggers.js';

/** One task of the seat's own map-AI program, with when it switches on. */
export type ProgramTask =
  | {
      readonly kind: 'defend' | 'attack';
      readonly task: number;
      readonly point: IntentPoint;
      readonly range: number;
      readonly min: number;
      readonly max: number;
      readonly trigger: Trigger;
    }
  | {
      readonly kind: 'createCreatures';
      readonly task: number;
      readonly point: IntentPoint;
      readonly job: number;
      readonly count: number;
      readonly once: boolean;
      readonly trigger: Trigger;
    }
  | {
      readonly kind: 'changeDiplomacy' | 'selfDestroyPlayer';
      readonly task: number;
      readonly trigger: Trigger;
    };

/** The seat's own `[AIData]` tasks in script order; empty when it authored none or `AI_Disable`s them. */
export function programOf(
  mapAi: readonly MapAiSeat[],
  seat: number,
  timing: MissionTiming | null,
): ProgramTask[] {
  const program = mapAi.find((row) => row.player === seat);
  if (program === undefined || program.allDisabled) return [];
  return program.tasks.map((task, index) =>
    programTask(task, index, slotTrigger(program, task.condition, timing)),
  );
}

function programTask(task: MapAiTask, index: number, trigger: Trigger): ProgramTask {
  switch (task.kind) {
    case 'defend':
    case 'attack':
      return {
        kind: task.kind,
        task: index,
        point: { hx: task.x, hy: task.y },
        range: task.range,
        min: task.min,
        max: task.max,
        trigger,
      };
    case 'createCreatures':
      return {
        kind: 'createCreatures',
        task: index,
        point: { hx: task.x, hy: task.y },
        job: task.job,
        count: task.count,
        once: task.once,
        trigger,
      };
    case 'changeDiplomacy':
    case 'selfDestroyPlayer':
      return { kind: task.kind, task: index, trigger };
  }
}
