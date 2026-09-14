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
import type { MissionHouseRef, MissionScript, ResolvedOp } from '@open-northland/sim';
import { MISSION_HOUSE_NAME_FIELD, MISSION_LANDSCAPE_NAME_FIELD } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { scriptMatchParticipants } from '../match-participants.js';
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

/** Every field a content name resolves in, for a caller counting how much of a script resolved. The
 *  house-instance kind (19) is not in {@link NAME_JOINS}: it joins by name and level at once. */
export const MISSION_NAME_FIELDS: readonly (
  | MissionNameField
  | typeof MISSION_HOUSE_NAME_FIELD
  | typeof MISSION_LANDSCAPE_NAME_FIELD
)[] = [
  ...(Object.keys(NAME_JOINS) as MissionNameField[]),
  MISSION_HOUSE_NAME_FIELD,
  MISSION_LANDSCAPE_NAME_FIELD,
];

/** What an unresolvable house name loads as - both halves miss, like {@link UNRESOLVED_NAME}. */
const UNRESOLVED_HOUSE: MissionHouseRef = { typeId: UNRESOLVED_NAME, tribe: UNRESOLVED_NAME };

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
    missions: missions.map((mission) => {
      const description = mission.descriptionStringId;
      return {
        successfullIf: mission.successfullIf ?? 0,
        active: mission.active ?? false,
        visible: mission.visible ?? false,
        // The corpus writes `-1` for "no goal text"; the loader's own default of 0 would name string 0.
        ...(description !== undefined && description >= 0 ? { description } : {}),
        goals: mission.goals.map((line) => resolveNames(decodeMissionGoal(line, warn), joins, dropped)),
        results: mission.results.map((line) => resolveNames(decodeMissionResult(line, warn), joins, dropped)),
      };
    }),
  };
  return { script, unknownOpcodes, tokenMismatches, unresolvedNames: [...unresolved].sort() };
}

type DropName = (name: string) => void;

/** The walk preserves every value that is not a content name, so the result is the same opcode with
 *  its names replaced by ids - which is what `ResolvedOp` describes. */
function resolveNames<T extends object>(op: T, joins: ContentJoins, dropped: DropName): ResolvedOp<T> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(op)) {
    if (isNameRef(value)) out[field] = resolveRef(field, value, joins, dropped);
    else if (field === MISSION_HOUSE_NAME_FIELD && typeof value === 'string')
      out[field] = resolveHouseName(value, op, joins, dropped);
    else if (field === MISSION_LANDSCAPE_NAME_FIELD && typeof value === 'string') {
      const typeId = joins.landscape(value);
      if (typeId === undefined) dropped(value);
      out[field] = typeId ?? UNRESOLVED_NAME;
    } else out[field] = value;
  }
  return out as ResolvedOp<T>;
}

/**
 * A house-instance name resolves the way an authored `sethouse` does: by name and the line's level,
 * since one name spans a chain and each level is its own building type. The join's tribe travels with
 * the type, because one typeId belongs to five civilizations at once.
 */
function resolveHouseName(name: string, op: object, joins: ContentJoins, dropped: DropName): MissionHouseRef {
  const level = 'level' in op && typeof op.level === 'number' ? op.level : 0;
  const hit = joins.buildingBob(name, level);
  if (hit !== undefined) return { typeId: hit.typeId, tribe: hit.tribeId };
  dropped(name);
  return UNRESOLVED_HOUSE;
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

/** Script roster and diplomacy survive missing catalog data; mission names require the served IR. */
export function mapScriptWorld(script: MapScript | null, rows: AuthoredJoinRows | null): MapScriptWorld {
  const permissions = script?.permissions;
  const permissionRows = permissions !== undefined ? { permissions } : {};
  const diplomacy = script?.diplomacy ?? [];
  const humanNames = script?.humanNames ?? [];
  const roster =
    script !== null && script.players.length > 0 ? { participants: scriptMatchParticipants(script) } : {};
  if (script === null || rows === null || script.missions.length === 0)
    return { ...permissionRows, diplomacy, humanNames, ...roster };
  const join = resolveMissionScript(script.missions, rows);
  if (join.unknownOpcodes > 0 || join.tokenMismatches > 0 || join.unresolvedNames.length > 0) {
    const named = join.unresolvedNames.slice(0, NAMES_IN_WARNING).join(', ');
    diag.warn(
      'content',
      `mapScriptWorld: ${script.missions.length} missions loaded with ${join.unknownOpcodes} unknown opcodes, ${join.tokenMismatches} token-count mismatches and ${join.unresolvedNames.length} unresolvable names (${named})`,
    );
  }
  const scriptedVictory =
    script.multiplayer === undefined ||
    join.script.missions.some((mission) =>
      mission.results.some((op) => op.opcode === 'MissionWon' || op.opcode === 'MissionFailed'),
    );
  return {
    ...permissionRows,
    diplomacy,
    humanNames,
    ...roster,
    missions: join.script,
    victory: scriptedVictory ? 'script' : 'elimination',
  };
}
