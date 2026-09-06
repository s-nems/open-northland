import type { MissionGoal, MissionNameRef, MissionResult } from '@open-northland/data';

/**
 * The decoded script as the simulation takes it: every content name a line wrote is already a numeric
 * typeId, so nothing in here joins against `ir.json` by name.
 */
type Resolved<T> = { readonly [K in keyof T]: T[K] extends MissionNameRef ? number : T[K] };

/** One decoded opcode with its name arguments replaced by content ids. Distributes over the opcode
 *  union, so each member keeps its own `opcode` literal. */
export type ResolvedOp<U> = U extends object ? Resolved<U> : never;

export type MissionGoalOp = ResolvedOp<MissionGoal>;
export type MissionResultOp = ResolvedOp<MissionResult>;

/** How many of a mission's goals must hold for its results to fire (`successfullif`). */
export const SUCCESSFUL_IF = {
  all: 0,
  any: 1,
  /** At least half, rounded up. */
  half: 2,
  none: 3,
} as const;

export interface MissionDefinition {
  /** A {@link SUCCESSFUL_IF} rule; any other value means the mission always holds. */
  readonly successfullIf: number;
  /** Active at load, which records the load tick as the activation tick. */
  readonly active: boolean;
  /** Listed in the mission window. */
  readonly visible: boolean;
  readonly goals: readonly MissionGoalOp[];
  readonly results: readonly MissionResultOp[];
}

/**
 * A map's whole trigger script in authored order. A mission's position here is its index, the value
 * every `ActivateMission`, `CheckMission`, `IsMissionDone`, `IfMissionIsActive` and `SetVisible`
 * argument names.
 */
export interface MissionScript {
  readonly missions: readonly MissionDefinition[];
}

/** Whether `held` of `total` goals satisfies the rule (`MISSIONS.md`, "Execution model"). A mission
 *  with no goals holds under every rule but `any`. */
export function ruleSatisfied(rule: number, held: number, total: number): boolean {
  switch (rule) {
    case SUCCESSFUL_IF.all:
      return held === total;
    case SUCCESSFUL_IF.any:
      return held > 0;
    case SUCCESSFUL_IF.half:
      return held >= Math.ceil(total / 2);
    case SUCCESSFUL_IF.none:
      return held === 0;
    default:
      return true;
  }
}
