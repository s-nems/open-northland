import {
  decodeMissionGoal,
  decodeMissionResult,
  type MapMission,
  type MapScript,
  type MissionDecodeWarning,
  type MissionGoal,
  type MissionNameRef,
  type MissionResult,
} from '@open-northland/data';
import type { MissionScript, ResolvedOp } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import type { MapScriptWorld } from './build.js';
import type { AuthoredJoinRows, ContentJoins } from './content-joins.js';
import { contentJoins } from './content-joins.js';

/**
 * The id a name the catalog does not know resolves to. No content typeId is negative, so every
 * lookup an opcode makes with it misses, the way the original's own failed name lookup does.
 */
export const UNRESOLVED_NAME = -1;

/** How many unresolvable names the load warning names before it stops listing them. */
const NAMES_IN_WARNING = 8;

/** The fields of one decoded opcode that carry a content name. */
type NameFieldOf<T> = { [K in keyof T]-?: T[K] extends MissionNameRef ? K : never }[keyof T];

/** The same over a union of opcodes, one member at a time. */
type NameFieldsOf<U> = U extends object ? NameFieldOf<U> : never;

/** Every name field across the whole opcode table, so a new name kind in `@open-northland/data`
 *  breaks {@link NAME_JOINS} instead of silently resolving to {@link UNRESOLVED_NAME}. */
type MissionNameField = NameFieldsOf<MissionGoal | MissionResult>;

/** Which join each name field resolves through. A tribe name is a civilization or an animal species,
 *  and both live in one table. */
const NAME_JOINS: Record<MissionNameField, (joins: ContentJoins, name: string) => number | undefined> = {
  tribe: (joins, name) => joins.tribe(name) ?? joins.species(name),
  job: (joins, name) => joins.job(name),
  vehicleType: (joins, name) => joins.vehicleType(name),
  good: (joins, name) => joins.good(name),
  houseType: (joins, name) => joins.buildingType(name),
};

/** The name fields, for a caller counting how much of a script resolved. */
export const MISSION_NAME_FIELDS = Object.keys(NAME_JOINS) as readonly MissionNameField[];

/** What a map's script cost on the way into the simulation, for one summary line in the log. */
export interface MissionScriptJoin {
  readonly script: MissionScript;
  /** Lines whose opcode name is not in the engine's table; each loads as `True` or `None`. */
  readonly unknownOpcodes: number;
  /** Lines that carry more or fewer tokens than their opcode declares. */
  readonly tokenMismatches: number;
  /** The distinct name arguments the content catalog does not know, ascending. */
  readonly unresolvedNames: readonly string[];
}

/**
 * Turn a decoded map's `[MissionData]` sections into the script the simulation runs: opcode names
 * become typed goal and result records, and every content name becomes a numeric typeId, so nothing
 * past this point joins against `ir.json`. A malformed line is never fatal - the engine's own
 * fallbacks (unknown opcode, missing token, unknown name) all load as a no-op.
 */
export function resolveMissionScript(
  missions: readonly MapMission[],
  rows: AuthoredJoinRows,
): MissionScriptJoin {
  const joins = contentJoins(rows);
  let unknownOpcodes = 0;
  let tokenMismatches = 0;
  const unresolved = new Set<string>();
  const warn = (w: MissionDecodeWarning): void => {
    if (w.reason === 'unknownOpcode') unknownOpcodes++;
    else tokenMismatches++;
  };
  const dropped = (name: string): void => {
    unresolved.add(name);
  };
  const script: MissionScript = {
    missions: missions.map((mission) => ({
      successfullIf: mission.successfullIf ?? 0,
      active: mission.active ?? false,
      visible: mission.visible ?? false,
      goals: mission.goals.map((line) => resolveNames(decodeMissionGoal(line, warn), joins, dropped)),
      results: mission.results.map((line) => resolveNames(decodeMissionResult(line, warn), joins, dropped)),
    })),
  };
  return { script, unknownOpcodes, tokenMismatches, unresolvedNames: [...unresolved].sort() };
}

type DropName = (name: string) => void;

/** The walk preserves every value that is not a name reference, so the result is the same opcode with
 *  its names replaced by ids - which is what `ResolvedOp` describes. */
function resolveNames<T extends object>(op: T, joins: ContentJoins, dropped: DropName): ResolvedOp<T> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(op)) {
    out[field] = isNameRef(value) ? resolveRef(field, value, joins, dropped) : value;
  }
  return out as ResolvedOp<T>;
}

function isNameField(field: string): field is MissionNameField {
  return Object.hasOwn(NAME_JOINS, field);
}

function isNameRef(value: unknown): value is MissionNameRef {
  return typeof value === 'object' && value !== null && 'ref' in value;
}

function resolveRef(field: string, ref: MissionNameRef, joins: ContentJoins, dropped: DropName): number {
  if (ref.ref === 'id') return ref.id;
  const id = isNameField(field) ? NAME_JOINS[field](joins, ref.name) : undefined;
  if (id !== undefined) return id;
  dropped(ref.name);
  return UNRESOLVED_NAME;
}

/**
 * What a decoded map's script contributes to its world: the diplomacy rows verbatim and the missions
 * resolved against the served catalog. A map with no script, or a boot with no IR to join against,
 * contributes nothing and its world runs as it did before missions existed.
 */
export function mapScriptWorld(script: MapScript | null, rows: AuthoredJoinRows | null): MapScriptWorld {
  const diplomacy = script?.diplomacy ?? [];
  if (script === null || rows === null || script.missions.length === 0) return { diplomacy };
  const join = resolveMissionScript(script.missions, rows);
  if (join.unknownOpcodes > 0 || join.tokenMismatches > 0 || join.unresolvedNames.length > 0) {
    const named = join.unresolvedNames.slice(0, NAMES_IN_WARNING).join(', ');
    diag.warn(
      'content',
      `mapScriptWorld: ${script.missions.length} missions loaded with ${join.unknownOpcodes} unknown opcodes, ${join.tokenMismatches} token-count mismatches and ${join.unresolvedNames.length} unresolvable names (${named})`,
    );
  }
  return { diplomacy, missions: join.script };
}
