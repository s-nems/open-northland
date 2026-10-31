import { EQUIP_CATEGORIES, HomeQualityEffect, MAP_GOAL_GOODS_MAX } from '@open-northland/data';
import { COMPUTER_DIFFICULTIES, COMPUTER_MODULE_IDS } from '../../components/ai/control.js';
import {
  ASSISTANT_ARMING_INTENTS,
  ASSISTANT_COUNTER_KINDS,
  ASSISTANT_GRANT_AUDIENCES,
} from '../../components/assistant.js';
import { HOUSE_RECORD_NAME_MAX_CHARS } from '../../components/economy/infrastructure.js';
import { MISC_EQUIP_SLOTS } from '../../components/equipment.js';
import { MAX_MATCH_GOALS, type MatchGoal } from '../../components/match.js';
import {
  SCRIPTED_LOOK_MAX_RECIPES,
  SCRIPTED_LOOK_RECIPE_MAX_CHARS,
} from '../../components/missions/mission.js';
import type { NeedKind } from '../../components/needs.js';
import { GATE_MODES } from '../../components/palisade.js';
import { MAX_PLAYERS } from '../../components/players/ownership.js';
import { PAPER_KINDS } from '../../components/players/papers.js';
import { DIPLOMACY_STATES } from '../../components/rules.js';
import { VEHICLE_STANCES } from '../../components/vehicle.js';
import { assertNever } from '../brand.js';
import { asRecord, codePointLength, hasControlCharacter, typeName } from '../untrusted.js';
import type { Command } from './index.js';
import {
  CHILD_SEXES,
  MAX_UNIT_MEMBER_ACTIONS,
  MAX_UNIT_ORDER_MEMBERS,
  type UnitSelectionAction,
} from './unit-orders.js';

/**
 * What one payload field must hold. Entity references, content ids and half-cell coordinates are all
 * `'integer'`: the sim indexes stores and grids with them, and a fractional or non-finite value would
 * write state no later read can find. `'count'` is a non-negative integer, a number of units.
 * `{ string: n }` is text of at most `n` code points with no control character.
 */
type FieldCheck =
  | 'integer'
  | 'count'
  | 'boolean'
  | { readonly string: number }
  | { readonly oneOf: readonly string[] }
  | {
      readonly arrayOf: FieldCheck;
      readonly maxLength?: number;
      readonly minLength?: number;
      readonly uniqueBy?: string;
    }
  | { readonly tupleOf: readonly FieldCheck[] }
  | { readonly nullOr: FieldCheck }
  | { readonly fields: FieldSpec }
  | { readonly variants: Readonly<Record<string, FieldSpec>> };

interface FieldSpec {
  readonly required?: Readonly<Record<string, FieldCheck>>;
  readonly optional?: Readonly<Record<string, FieldCheck>>;
}

/** A half-cell node address, the `(x, y)` pair most placement and order payloads carry. */
const NODE = { x: 'integer', y: 'integer' } as const satisfies Record<string, FieldCheck>;

/** The Shift-click flag of a queueable order (`QUEUEABLE_ORDER_KINDS`, `QUEUEABLE_VEHICLE_ORDER_KINDS`). */
const QUEUED = { queued: 'boolean' } as const satisfies Record<string, FieldCheck>;

const UNIT_GROUP: FieldCheck = {
  arrayOf: { fields: { required: { entity: 'integer' } } },
  maxLength: MAX_UNIT_ORDER_MEMBERS,
  uniqueBy: 'entity',
};
const DESTINATION_GROUP: FieldCheck = {
  ...UNIT_GROUP,
  arrayOf: { fields: { required: { entity: 'integer', ...NODE } } },
};

/**
 * The original's type spaces (`logicdefines.inc` `JOB_TYPE_MAXIMUM`, `GOOD_TYPE_MAXIMUM`,
 * `TRIBE_TYPE_MAXIMUM`). They bound how many entries a list naming each job, good or tribe once can
 * hold, not the ids: a worker slot's job id sits above the job space.
 */
export const JOB_TYPE_SPACE = 56;
export const GOOD_TYPE_SPACE = 66;
export const TRIBE_TYPE_SPACE = 42;

/** The jobs an `assignWorker` member would take, most preferred first. */
const JOB_PRIORITY: FieldCheck = { arrayOf: 'integer', maxLength: JOB_TYPE_SPACE };

/** One equipment slot in a `spawnSettler` payload; null (or absent) leaves the slot empty. */
const EQUIP_SLOT: FieldCheck = {
  nullOr: { fields: { required: { goodType: 'integer' }, optional: { degreeOfUsePct: 'integer' } } },
};

const EQUIPMENT: FieldCheck = {
  fields: {
    optional: {
      boots: EQUIP_SLOT,
      tool: EQUIP_SLOT,
      weapon: EQUIP_SLOT,
      armor: EQUIP_SLOT,
      misc: { arrayOf: EQUIP_SLOT, maxLength: MISC_EQUIP_SLOTS },
    },
  },
};

/** A vehicle's aim: either shape passes the field check; the handler rejects a `kind` whose own
 *  fields are missing. */
const VEHICLE_ATTACK_TARGET: FieldCheck = {
  fields: {
    required: { kind: { oneOf: ['entity', 'ground'] } },
    optional: { entity: 'integer', hx: 'integer', hy: 'integer' },
  },
};

const PAPER: FieldCheck = { fields: { required: { kind: { oneOf: PAPER_KINDS }, param: 'integer' } } };

/** Every AI module is optional and boolean, an omitted one defaulting to enabled. */
const AI_MODULES: FieldCheck = {
  fields: { optional: Object.fromEntries(COMPUTER_MODULE_IDS.map((id) => [id, 'boolean' as const])) },
};

type RequiredKey<T> = { [P in keyof T]-?: object extends Pick<T, P> ? never : P }[keyof T];
type OptionalKey<T> = Exclude<keyof T, RequiredKey<T>>;
/**
 * A kind's field contract, with the same required and optional field names as its {@link Command}
 * variant: the relay parses every remote envelope through this table, so a field missing from it would
 * refuse a peer's valid command.
 */
type PayloadSpec<C> = {
  readonly required: { readonly [P in Exclude<RequiredKey<C>, 'kind'>]: FieldCheck };
} & ([OptionalKey<C>] extends [never]
  ? { readonly optional?: never }
  : { readonly optional: { readonly [P in OptionalKey<C>]: FieldCheck } });

const MATCH_GOAL_PAYLOAD: {
  readonly [K in MatchGoal['kind']]: PayloadSpec<Extract<MatchGoal, { kind: K }>>;
} = {
  goods: {
    required: {
      goods: {
        arrayOf: { fields: { required: { good: 'integer', amount: 'integer' } } },
        maxLength: MAP_GOAL_GOODS_MAX,
      },
    },
  },
  inhabitants: { required: { count: 'integer', soldiers: 'boolean' } },
  wonByMission: { required: {} },
  lostByMission: { required: {} },
  lastStanding: { required: {} },
};

const UNIT_SELECTION_ACTION_PAYLOAD: {
  readonly [K in UnitSelectionAction['kind']]: PayloadSpec<Extract<UnitSelectionAction, { kind: K }>>;
} = {
  orderNeed: {
    required: { need: { oneOf: ['hunger', 'fatigue', 'piety', 'enjoyment'] satisfies readonly NeedKind[] } },
    optional: QUEUED,
  },
  makeChild: { required: { child: { oneOf: CHILD_SEXES } } },
  openChest: { required: { chest: 'integer' }, optional: QUEUED },
  claimAnimal: { required: { animal: 'integer' }, optional: QUEUED },
  equipGood: {
    required: { group: { oneOf: EQUIP_CATEGORIES }, slot: 'integer', goodType: 'integer' },
    optional: { skipReturn: 'boolean', ...QUEUED },
  },
  unequipGood: { required: { group: { oneOf: EQUIP_CATEGORIES }, slot: 'integer' } },
  setJob: { required: { jobType: 'integer' } },
  assignBuilder: { required: { site: 'integer' }, optional: QUEUED },
  trainSoldier: { required: { house: 'integer' }, optional: QUEUED },
  learn: { required: { house: 'integer', target: { oneOf: ['job', 'good'] }, typeId: 'integer' } },
  setWorkFlag: { required: NODE },
  setGatherGood: { required: { goodType: { nullOr: 'integer' } } },
  attachTradeHouse: { required: { house: 'integer' } },
  detachTradeHouse: { required: { house: 'integer' } },
  attachToVehicle: { required: { vehicle: 'integer' }, optional: QUEUED },
  cancelTraining: { required: {} },
  detachFromVehicle: { required: {} },
  unassignBuilder: { required: {} },
  unassignWorker: { required: {} },
  unassignHouse: { required: {} },
  marry: { required: {} },
  explore: { required: {}, optional: QUEUED },
};

/**
 * The field contract of every command kind, keyed like {@link COMMAND_ISSUER} so a new kind cannot be
 * added without one, and typed by {@link PayloadSpec} so a new top-level field cannot either. It
 * describes the wire payload, not who may send it: the authority gate still decides that, and an
 * authored-setup-only option is a field a seat envelope simply may not carry.
 */
const COMMAND_PAYLOAD: { readonly [K in Command['kind']]: PayloadSpec<Extract<Command, { kind: K }>> } = {
  learn: {
    required: { entity: 'integer', house: 'integer', target: { oneOf: ['job', 'good'] }, typeId: 'integer' },
  },
  payTribute: { required: { player: 'integer', slot: 'integer' } },
  declareDiplomacy: {
    required: { player: 'integer', other: 'integer', state: { oneOf: DIPLOMACY_STATES } },
  },
  attachTradeHouse: { required: { entity: 'integer', house: 'integer' } },
  detachTradeHouse: { required: { entity: 'integer', house: 'integer' } },
  setTradeImport: { required: { entity: 'integer', house: 'integer', good: 'integer', on: 'boolean' } },
  setTradeImportLimits: {
    required: { entity: 'integer', house: 'integer', good: 'integer', upTo: 'count', keep: 'count' },
  },
  setTradeSettlement: { required: { entity: 'integer', house: 'integer', on: 'boolean' } },
  clearTradeImports: { required: { entity: 'integer' } },
  setTradeAgreement: { required: { entity: 'integer', agreement: 'integer' } },
  setTradeAgreementLimits: { required: { entity: 'integer', giveKeep: 'count', takeUpTo: 'count' } },
  addTradeAgreement: {
    required: {
      missionId: 'integer',
      giveGood: 'integer',
      giveAmount: 'integer',
      takeGood: 'integer',
      takeAmount: 'integer',
    },
  },
  setMissionsEnabled: { required: { enabled: 'boolean' } },
  cancelTraining: { required: { entity: 'integer' } },
  explore: { required: { entity: 'integer' }, optional: QUEUED },
  grantPaper: { required: { player: 'integer', paper: PAPER } },
  orderNeed: {
    required: {
      entity: 'integer',
      need: { oneOf: ['hunger', 'fatigue', 'piety', 'enjoyment'] satisfies readonly NeedKind[] },
    },
    optional: QUEUED,
  },
  setRegeneration: { required: { entity: 'integer', enabled: 'boolean' } },
  unassignBuilder: { required: { entity: 'integer' } },
  assignBuilder: { required: { entity: 'integer', site: 'integer' }, optional: QUEUED },
  assignHouse: { required: { entity: 'integer', house: 'integer' } },
  assignHouseGroup: { required: { members: UNIT_GROUP, house: 'integer' } },
  assignWorker: { required: { entity: 'integer', building: 'integer', jobPriority: JOB_PRIORITY } },
  assignWorkerGroup: {
    required: {
      building: 'integer',
      members: {
        ...UNIT_GROUP,
        arrayOf: { fields: { required: { entity: 'integer', jobPriority: JOB_PRIORITY } } },
      },
    },
  },
  attachToVehicle: { required: { entity: 'integer', vehicle: 'integer' }, optional: QUEUED },
  attackMoveUnit: { required: { entity: 'integer', ...NODE }, optional: QUEUED },
  setVehicleStanceGroup: { required: { members: UNIT_GROUP, stance: { oneOf: VEHICLE_STANCES } } },
  moveVehicleGroup: {
    required: { members: DESTINATION_GROUP },
    optional: { attackMove: 'boolean', ...QUEUED },
  },
  attackWithVehicleGroup: {
    required: { members: UNIT_GROUP, target: VEHICLE_ATTACK_TARGET },
    optional: QUEUED,
  },
  moveUnitGroup: { required: { members: DESTINATION_GROUP }, optional: QUEUED },
  attackMoveUnitGroup: { required: { members: DESTINATION_GROUP }, optional: QUEUED },
  attackUnitGroup: { required: { members: UNIT_GROUP, target: 'integer' }, optional: QUEUED },
  setStanceGroup: { required: { members: UNIT_GROUP, mode: 'integer' } },
  setRegenerationGroup: { required: { members: UNIT_GROUP, enabled: 'boolean' } },
  unitActionGroup: { required: { members: UNIT_GROUP, action: { variants: UNIT_SELECTION_ACTION_PAYLOAD } } },
  unitOrdersGroup: {
    required: {
      members: {
        arrayOf: {
          fields: {
            required: {
              entity: 'integer',
              actions: {
                arrayOf: { variants: UNIT_SELECTION_ACTION_PAYLOAD },
                minLength: 1,
                maxLength: MAX_UNIT_MEMBER_ACTIONS,
              },
            },
          },
        },
        maxLength: MAX_UNIT_ORDER_MEMBERS,
        uniqueBy: 'entity',
      },
    },
  },
  boardVehicle: { required: { entity: 'integer' } },
  detachFromVehicle: { required: { entity: 'integer' } },
  attackUnit: { required: { entity: 'integer', target: 'integer' }, optional: QUEUED },
  attackWithVehicle: { required: { vehicle: 'integer', target: VEHICLE_ATTACK_TARGET }, optional: QUEUED },
  cancelUpgrade: { required: { building: 'integer' } },
  createVehicle: {
    required: { vehicleType: 'integer', ...NODE, tribe: 'integer' },
    optional: {
      owner: 'integer',
      missionId: 'integer',
      goods: { arrayOf: { fields: { required: { good: 'integer', amount: 'integer' } } } },
    },
  },
  debugCompleteConstruction: { required: { target: 'integer' } },
  debugFillStockpile: { required: { target: 'integer' }, optional: { goodType: 'integer' } },
  debugKill: { required: { target: 'integer' } },
  debugSetHealth: { required: { target: 'integer', percent: 'integer' } },
  debugSetNeeds: {
    required: { target: 'integer' },
    optional: { hunger: 'integer', fatigue: 'integer', piety: 'integer', enjoyment: 'integer' },
  },
  debugTeleport: { required: { target: 'integer', ...NODE } },
  demolish: { required: { building: 'integer' } },
  demolishPalisade: { required: { palisade: 'integer' } },
  demolishSignpost: { required: { signpost: 'integer' } },
  dropGood: { required: { good: 'integer', ...NODE, amount: 'integer' } },
  equipGood: {
    required: {
      entity: 'integer',
      group: { oneOf: EQUIP_CATEGORIES },
      slot: 'integer',
      goodType: 'integer',
    },
    optional: { skipReturn: 'boolean', ...QUEUED },
  },
  leaveCarrier: { required: { vehicle: 'integer' } },
  loadIntoVehicle: { required: { vehicle: 'integer', carrier: 'integer' }, optional: QUEUED },
  makeChild: { required: { entity: 'integer', child: { oneOf: CHILD_SEXES } } },
  marry: { required: { entity: 'integer' } },
  moveUnit: { required: { entity: 'integer', ...NODE }, optional: QUEUED },
  moveVehicle: { required: { vehicle: 'integer', ...NODE }, optional: { attackMove: 'boolean', ...QUEUED } },
  dockVehicle: {
    required: { vehicle: 'integer', ...NODE },
    optional: { ...QUEUED, dock: { fields: { required: NODE } } },
  },
  openChest: { required: { entity: 'integer', chest: 'integer' }, optional: QUEUED },
  claimAnimal: { required: { entity: 'integer', animal: 'integer' }, optional: QUEUED },
  placeBuilding: {
    required: { buildingType: 'integer', ...NODE, tribe: 'integer' },
    optional: {
      missionId: 'integer',
      underConstruction: 'boolean',
      owner: 'integer',
      force: 'boolean',
      ignoreTechnology: 'boolean',
      fillStock: 'boolean',
      initialGoods: { arrayOf: { fields: { required: { good: 'integer', amount: 'integer' } } } },
      level: 'integer',
      record: { string: HOUSE_RECORD_NAME_MAX_CHARS },
      paper: PAPER,
    },
  },
  placePalisade: {
    required: { gfxIndex: 'integer', ...NODE, tribe: 'integer' },
    optional: {
      owner: 'integer',
      underConstruction: 'boolean',
      valency: 'integer',
      landscapeId: 'integer',
      force: 'boolean',
      overUpgradeGround: 'boolean',
      waivedGround: { arrayOf: { fields: { required: { ...NODE, obstacle: 'count', walls: 'count' } } } },
    },
  },
  convertPalisadeGate: { required: { palisade: 'integer', gfxIndex: 'integer' } },
  placeRoadSite: {
    required: { ...NODE, tribe: 'integer' },
    optional: { owner: 'integer', force: 'boolean', overUpgradeGround: 'boolean', laid: 'boolean' },
  },
  cancelRoadSite: { required: { roadSite: 'integer' } },
  placeResource: {
    required: { good: 'integer', ...NODE, remaining: 'integer', harvestAtomic: 'integer' },
    optional: {
      landscapeId: 'integer',
      felling: 'boolean',
      deposit: { fields: { required: { levels: 'integer' } } },
    },
  },
  placeSignpost: { required: { entity: 'integer', ...NODE }, optional: QUEUED },
  setAlliedVision: { required: { enabled: 'boolean' } },
  setAssistantCounter: {
    required: {
      player: 'integer',
      counter: { oneOf: ASSISTANT_COUNTER_KINDS },
      value: 'integer',
      infinite: 'boolean',
    },
  },
  setAssistantGrant: { required: { player: 'integer', goodType: 'integer', enabled: 'boolean' } },
  setAssistantGrantAudience: {
    required: { player: 'integer', goodType: 'integer', audience: { oneOf: ASSISTANT_GRANT_AUDIENCES } },
  },
  setAssistantWeaponVeto: { required: { player: 'integer', goodType: 'integer', vetoed: 'boolean' } },
  setAssistantWeaponOrder: {
    required: {
      player: 'integer',
      intent: { oneOf: ASSISTANT_ARMING_INTENTS },
      order: { arrayOf: 'integer', maxLength: GOOD_TYPE_SPACE },
    },
  },
  setAssistantArmorOrder: {
    required: {
      player: 'integer',
      intent: { oneOf: ASSISTANT_ARMING_INTENTS },
      order: { arrayOf: 'integer', maxLength: GOOD_TYPE_SPACE },
      off: { arrayOf: 'integer', maxLength: GOOD_TYPE_SPACE },
    },
  },
  setAssistantPostGraduates: { required: { player: 'integer', enabled: 'boolean' } },
  setAssistantMoveFlags: { required: { player: 'integer', enabled: 'boolean' } },
  setProductionGoods: {
    required: { entity: 'integer', goods: { arrayOf: 'integer', maxLength: GOOD_TYPE_SPACE } },
  },
  setProductionCount: { required: { entity: 'integer', goodType: 'integer', count: 'integer' } },
  setDefenceMode: { required: { building: 'integer', enabled: 'boolean' } },
  setDiplomacy: { required: { from: 'integer', to: 'integer', state: { oneOf: DIPLOMACY_STATES } } },
  setFogMode: { required: { mode: 'integer' } },
  setGatherGood: { required: { entity: 'integer', goodType: { nullOr: 'integer' } } },
  setHouseholdGoodUse: {
    required: {
      player: 'integer',
      effect: { oneOf: HomeQualityEffect.options },
      allowed: 'boolean',
    },
  },
  setStorageMinimum: { required: { player: 'integer', goodType: 'integer', amount: 'integer' } },
  setJob: { required: { entity: 'integer', jobType: 'integer' } },
  continueMatch: { required: { player: 'integer' } },
  endMatchContinuation: { required: {} },
  setMatchParticipants: {
    required: { players: { arrayOf: 'integer', maxLength: MAX_PLAYERS } },
    optional: {
      victory: { oneOf: ['script', 'elimination', 'goals'] },
      goals: { arrayOf: { variants: MATCH_GOAL_PAYLOAD }, maxLength: MAX_MATCH_GOALS },
      goalSeats: { arrayOf: 'integer', maxLength: MAX_PLAYERS },
    },
  },
  setNeedsEnabled: { required: { enabled: 'boolean' } },
  setBioGroundWaived: { required: { waived: 'boolean' } },
  setPalisadeGateMode: { required: { palisade: 'integer', mode: { oneOf: GATE_MODES } } },
  setPalisadeGate: { required: { palisade: 'integer', open: 'boolean' } },
  setPlayerPlacementTribes: {
    required: { player: 'integer', tribes: { arrayOf: 'integer', maxLength: TRIBE_TYPE_SPACE } },
  },
  setAiControl: {
    required: { player: 'integer', enabled: 'boolean' },
    optional: {
      modules: AI_MODULES,
      computerEnabled: 'boolean',
      mapAiEnabled: 'boolean',
      peaceUntil: 'integer',
      difficulty: { oneOf: COMPUTER_DIFFICULTIES },
    },
  },
  setProfessionProgression: { required: { enabled: 'boolean' } },
  setSignpostNavigation: { required: { enabled: 'boolean' } },
  setStance: { required: { entity: 'integer', mode: 'integer' } },
  setVehicleStance: { required: { vehicle: 'integer', stance: { oneOf: VEHICLE_STANCES } } },
  setWorkFlag: { required: { entity: 'integer', ...NODE } },
  clearHaulFlag: { required: { entity: 'integer' } },
  marryPlaced: { required: { woman: { fields: { required: NODE } }, man: { fields: { required: NODE } } } },
  parentPlacedChild: {
    required: { child: { fields: { required: NODE } }, woman: { fields: { required: NODE } } },
  },
  spawnAnimalHerd: {
    required: { tribe: 'integer', ...NODE },
    optional: { count: 'integer', missionId: 'integer', owner: 'integer', flags: 'integer' },
  },
  spawnSettler: {
    required: { jobType: 'integer', ...NODE, tribe: 'integer' },
    optional: {
      missionId: 'integer',
      behaviourFlags: 'integer',
      nameStringId: 'integer',
      paletteRecipes: {
        arrayOf: { string: SCRIPTED_LOOK_RECIPE_MAX_CHARS },
        maxLength: SCRIPTED_LOOK_MAX_RECIPES,
      },
      hitpoints: 'integer',
      humanForm: 'boolean',
      armorClass: 'integer',
      weaponTypeId: 'integer',
      equipment: EQUIPMENT,
      moveSpeed: 'integer',
      owner: 'integer',
      experience: { arrayOf: { tupleOf: ['integer', 'integer'] } },
      gatherGood: 'integer',
      home: { fields: { required: NODE } },
      workplace: { fields: { required: NODE } },
      vehicle: { fields: { required: { ...NODE, inside: 'boolean' } } },
    },
  },
  stopVehicle: { required: { vehicle: 'integer' } },
  setVehicleWanted: { required: { vehicle: 'integer', goodType: 'integer', amount: 'integer' } },
  clearVehicleWanted: { required: { vehicle: 'integer' } },
  trainSoldier: { required: { entity: 'integer', house: 'integer' }, optional: QUEUED },
  unassignHouse: { required: { entity: 'integer' } },
  unloadPeople: {
    required: { vehicle: 'integer' },
    optional: { ...QUEUED, mooring: { fields: { required: NODE } } },
  },
  unassignWorker: { required: { entity: 'integer' } },
  unequipGood: {
    required: { entity: 'integer', group: { oneOf: EQUIP_CATEGORIES }, slot: 'integer' },
  },
  upgradeBuilding: { required: { building: 'integer' }, optional: { target: 'integer' } },
};

/**
 * Hold an untrusted payload to its kind's field contract, throwing an `at`-prefixed message naming the
 * first field that breaks it. Typed producers are held to the same contract at compile time, so only
 * imported and networked payloads pay for this.
 */
export function checkCommandPayload(
  command: Record<string, unknown>,
  kind: Command['kind'],
  at: string,
): void {
  checkFields(command, COMMAND_PAYLOAD[kind], at, ['kind']);
}

function checkFields(
  value: Record<string, unknown>,
  spec: FieldSpec,
  at: string,
  alsoAllowed: readonly string[] = [],
): void {
  const required = spec.required ?? {};
  const optional = spec.optional ?? {};
  for (const [field, check] of Object.entries(required)) {
    if (!Object.hasOwn(value, field)) throw new Error(`${at}: missing field '${field}'`);
    checkField(value[field], check, `${at}.${field}`);
  }
  for (const [field, check] of Object.entries(optional)) {
    if (Object.hasOwn(value, field)) checkField(value[field], check, `${at}.${field}`);
  }
  for (const field of Object.keys(value)) {
    // An unknown field is rejected rather than ignored: the authority gate reads `owner` and `player`
    // with `in`, so a payload may not carry a name its own kind does not declare.
    if (!Object.hasOwn(required, field) && !Object.hasOwn(optional, field) && !alsoAllowed.includes(field)) {
      throw new Error(`${at}: unknown field '${field}'`);
    }
  }
}

function checkField(value: unknown, check: FieldCheck, at: string): void {
  if (check === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new Error(`${at}: expected an integer, got ${described(value)}`);
    }
    return;
  }
  if (check === 'count') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${at}: expected a non-negative integer, got ${described(value)}`);
    }
    return;
  }
  if (check === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`${at}: expected a boolean, got ${described(value)}`);
    }
    return;
  }
  if ('string' in check) {
    if (typeof value !== 'string') throw new Error(`${at}: expected a string, got ${described(value)}`);
    if (codePointLength(value) > check.string) {
      throw new Error(`${at}: expected at most ${check.string} characters, got ${codePointLength(value)}`);
    }
    if (hasControlCharacter(value)) throw new Error(`${at}: expected no control characters`);
    return;
  }
  if ('oneOf' in check) {
    if (typeof value !== 'string' || !check.oneOf.includes(value)) {
      throw new Error(`${at}: expected one of ${check.oneOf.join(', ')}, got ${described(value)}`);
    }
    return;
  }
  if ('nullOr' in check) {
    if (value !== null) checkField(value, check.nullOr, at);
    return;
  }
  if ('arrayOf' in check) {
    if (!Array.isArray(value)) throw new Error(`${at}: expected an array, got ${described(value)}`);
    if (check.minLength !== undefined && value.length < check.minLength) {
      throw new Error(`${at}: expected at least ${check.minLength} entries, got ${value.length}`);
    }
    if (check.maxLength !== undefined && value.length > check.maxLength) {
      throw new Error(`${at}: expected at most ${check.maxLength} entries, got ${value.length}`);
    }
    const seen = check.uniqueBy === undefined ? undefined : new Set<unknown>();
    value.forEach((item: unknown, i) => {
      checkField(item, check.arrayOf, `${at}[${i}]`);
      if (check.uniqueBy !== undefined && seen !== undefined) {
        const key = asRecord(item, `${at}[${i}]`)[check.uniqueBy];
        if (seen.has(key)) throw new Error(`${at}[${i}]: duplicate ${check.uniqueBy}`);
        seen.add(key);
      }
    });
    return;
  }
  if ('tupleOf' in check) {
    const members = check.tupleOf;
    if (!Array.isArray(value) || value.length !== members.length) {
      throw new Error(`${at}: expected ${members.length} entries, got ${described(value)}`);
    }
    members.forEach((member, i) => {
      checkField(value[i], member, `${at}[${i}]`);
    });
    return;
  }
  if ('variants' in check) {
    const record = asRecord(value, at);
    const kind = record.kind;
    if (typeof kind !== 'string' || !Object.hasOwn(check.variants, kind)) {
      throw new Error(`${at}: unknown action kind ${described(kind)}`);
    }
    const spec = check.variants[kind];
    if (spec !== undefined) checkFields(record, spec, at, ['kind']);
    return;
  }
  if ('fields' in check) {
    checkFields(asRecord(value, at), check.fields, at);
    return;
  }
  assertNever(check);
}

function described(value: unknown): string {
  return typeof value === 'object' && value !== null ? typeName(value) : JSON.stringify(value);
}
