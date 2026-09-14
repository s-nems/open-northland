import type { MapDiplomacy } from '../schema/maps/script.js';

/** The tokens one parameter reads, sliced out of a goal or result line in declaration order. */
export type MissionTokens = readonly (string | undefined)[];

/**
 * A name parameter as the script wrote it: a quoted content name, or the bare numeric id maps
 * sometimes author in its place (`EnableHouse 0 "viking" 41` beside `AllowHouse 0 "viking" "work
 * druid 01"`). Resolving either form to a content typeId happens at load, outside this package.
 */
export type MissionNameRef =
  | { readonly ref: 'name'; readonly name: string }
  | { readonly ref: 'id'; readonly id: number };

/** A script point: a half-cell node of the `2W x 2H` lattice, the unit `staticobjects.inc` writes. */
export interface MissionPoint {
  readonly hx: number;
  readonly hy: number;
}

export type MissionDiplomacyState = MapDiplomacy['state'];

/** Missing or unparsable integers default to zero, pending confirmation against the running original. */
function int(token: string | undefined): number {
  const n = Number.parseInt(token ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
}

function intAt(tokens: MissionTokens): number {
  return int(tokens[0]);
}

function flagAt(tokens: MissionTokens): boolean {
  return int(tokens[0]) !== 0;
}

/** Trimmed because the corpus carries stray control characters inside quoted tokens. */
function textAt(tokens: MissionTokens): string {
  return tokens[0]?.trim() ?? '';
}

function nameAt(tokens: MissionTokens): MissionNameRef {
  const raw = textAt(tokens);
  return /^-?\d+$/.test(raw) ? { ref: 'id', id: Number.parseInt(raw, 10) } : { ref: 'name', name: raw };
}

function pointAt(tokens: MissionTokens): MissionPoint {
  return { hx: int(tokens[0]), hy: int(tokens[1]) };
}

/** `DIPLOMACY_STATE_*` codes 1..3, the order the state names resolve through. */
const DIPLOMACY_STATES: readonly MissionDiplomacyState[] = ['friend', 'neutral', 'enemy'];

/** Undefined when neither a state name nor a `DIPLOMACY_STATE_*` code: the caller skips the line. */
function diplomacyAt(tokens: MissionTokens): MissionDiplomacyState | undefined {
  const raw = textAt(tokens).toLowerCase();
  const byName = DIPLOMACY_STATES.find((state) => state === raw);
  return byName ?? DIPLOMACY_STATES[int(tokens[0]) - 1];
}

interface MissionParamDef {
  /** The field this parameter decodes into. Unique within every opcode signature. */
  readonly field: string;
  readonly tokens: 1 | 2;
  readonly decode: (tokens: MissionTokens) => unknown;
}

/**
 * The parameter kinds a goal or result signature is built from, named after the engine's own kinds
 * (`MISSIONS.md` lists them with their kind ids). `point` covers the adjacent x and y kinds, which
 * no signature separates.
 */
export const MISSION_PARAMS = {
  player: { field: 'player', tokens: 1, decode: intAt },
  otherPlayer: { field: 'otherPlayer', tokens: 1, decode: intAt },
  tribeName: { field: 'tribe', tokens: 1, decode: nameAt },
  jobName: { field: 'job', tokens: 1, decode: nameAt },
  vehicleTypeName: { field: 'vehicleType', tokens: 1, decode: nameAt },
  goodName: { field: 'good', tokens: 1, decode: nameAt },
  amount: { field: 'amount', tokens: 1, decode: intAt },
  level: { field: 'level', tokens: 1, decode: intAt },
  range: { field: 'range', tokens: 1, decode: intAt },
  humanId: { field: 'humanId', tokens: 1, decode: intAt },
  otherHumanId: { field: 'otherHumanId', tokens: 1, decode: intAt },
  vehicleId: { field: 'vehicleId', tokens: 1, decode: intAt },
  otherVehicleId: { field: 'otherVehicleId', tokens: 1, decode: intAt },
  /** Houses and animals share one object-id kind. */
  objectId: { field: 'objectId', tokens: 1, decode: intAt },
  houseTypeName: { field: 'houseType', tokens: 1, decode: nameAt },
  point: { field: 'point', tokens: 2, decode: pointAt },
  landscapeName: { field: 'landscape', tokens: 1, decode: textAt },
  houseName: { field: 'houseName', tokens: 1, decode: textAt },
  builtFlag: { field: 'built', tokens: 1, decode: flagAt },
  missionIndex: { field: 'missionIndex', tokens: 1, decode: intAt },
  mapId: { field: 'mapId', tokens: 1, decode: intAt },
  externalFlag: { field: 'flagId', tokens: 1, decode: intAt },
  diplomacyName: { field: 'state', tokens: 1, decode: diplomacyAt },
  soundId: { field: 'sound', tokens: 1, decode: intAt },
  stringId: { field: 'stringId', tokens: 1, decode: intAt },
  tributeSlot: { field: 'slot', tokens: 1, decode: intAt },
  behaviourFlags: { field: 'behaviour', tokens: 1, decode: intAt },
  captainFlag: { field: 'withCaptain', tokens: 1, decode: flagAt },
  campaignId: { field: 'campaignId', tokens: 1, decode: intAt },
  flag: { field: 'flag', tokens: 1, decode: flagAt },
  replayFlag: { field: 'replay', tokens: 1, decode: flagAt },
  cutsceneId: { field: 'cutscene', tokens: 1, decode: intAt },
  seconds: { field: 'seconds', tokens: 1, decode: intAt },
  /** Info line, bit index, or a renumbering target, depending on the opcode. */
  index: { field: 'index', tokens: 1, decode: intAt },
  /** Opcode-specific in the engine's table; the opcode's own row says what it means. */
  extra: { field: 'extra', tokens: 1, decode: intAt },
} as const satisfies Record<string, MissionParamDef>;

export type MissionParamKind = keyof typeof MISSION_PARAMS;

type FieldOf<K extends MissionParamKind> = (typeof MISSION_PARAMS)[K]['field'];
type ValueOf<K extends MissionParamKind> = ReturnType<(typeof MISSION_PARAMS)[K]['decode']>;

/** One signature's decoded parameters: each kind under its own field name. */
export type MissionArgs<P extends readonly MissionParamKind[]> = {
  readonly [K in P[number] as FieldOf<K>]: ValueOf<K>;
};
