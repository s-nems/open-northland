import type { MissionGoal, MissionNameRef, MissionResult } from '@open-northland/data';

/**
 * The house-instance name kind, the one content name a line writes as plain text instead of a name
 * reference. The load-time join resolves it with the line's own level column; the app imports this
 * name so the two halves of that join cannot drift apart.
 */
export const MISSION_HOUSE_NAME_FIELD = 'houseName';
export const MISSION_LANDSCAPE_NAME_FIELD = 'landscape';

/**
 * A resolved house-instance name. One building typeId recurs across civilizations - 45 of the 54
 * shipped types belong to five tribes each - so the type alone never says whose house it is, and the
 * join hands the pair down rather than letting a placement guess.
 */
export interface MissionHouseRef {
  readonly typeId: number;
  readonly tribe: number;
}

/**
 * The decoded script as the simulation takes it: every content name a line wrote is already a numeric
 * typeId, so nothing in here joins against `ir.json` by name.
 */
type Resolved<T> = {
  readonly [K in keyof T]: T[K] extends MissionNameRef
    ? number
    : K extends typeof MISSION_HOUSE_NAME_FIELD
      ? MissionHouseRef
      : K extends typeof MISSION_LANDSCAPE_NAME_FIELD
        ? number
        : T[K];
};

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
  /** Listed in the mission window, which also needs a {@link description} to list it. */
  readonly visible: boolean;
  /** The goal text's id in the map's own string table; omitted for a `-1`, which lists nowhere. */
  readonly description?: number;
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

const SUCCESSFUL_IF_RULES: ReadonlySet<number> = new Set(Object.values(SUCCESSFUL_IF));

export function isSuccessfulIfRule(rule: number): boolean {
  return SUCCESSFUL_IF_RULES.has(rule);
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
