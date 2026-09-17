import { EQUIP_CATEGORIES } from '@open-northland/data';
import { AI_MODULE_IDS } from '../../components/ai-player.js';
import { ASSISTANT_COUNTER_KINDS } from '../../components/assistant.js';
import type { NeedKind } from '../../components/needs.js';
import { PAPER_KINDS } from '../../components/papers.js';
import { DIPLOMACY_STATES } from '../../components/rules.js';
import { assertNever } from '../brand.js';
import { asRecord, typeName } from '../untrusted.js';
import type { Command } from './index.js';
import { CHILD_SEXES } from './unit-orders.js';

/**
 * What one payload field must hold. Entity references, content ids and half-cell coordinates are all
 * `'integer'`: the sim indexes stores and grids with them, and a fractional or non-finite value would
 * write state no later read can find.
 */
type FieldCheck =
  | 'integer'
  | 'boolean'
  | { readonly oneOf: readonly string[] }
  | { readonly arrayOf: FieldCheck }
  | { readonly tupleOf: readonly FieldCheck[] }
  | { readonly nullOr: FieldCheck }
  | { readonly fields: FieldSpec };

interface FieldSpec {
  readonly required?: Readonly<Record<string, FieldCheck>>;
  readonly optional?: Readonly<Record<string, FieldCheck>>;
}

/** A half-cell node address, the `(x, y)` pair most placement and order payloads carry. */
const NODE = { x: 'integer', y: 'integer' } as const satisfies Record<string, FieldCheck>;

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
      misc: { arrayOf: EQUIP_SLOT },
    },
  },
};

const PAPER: FieldCheck = { fields: { required: { kind: { oneOf: PAPER_KINDS }, param: 'integer' } } };

/** Every AI module is optional and boolean, an omitted one defaulting to enabled. */
const AI_MODULES: FieldCheck = {
  fields: { optional: Object.fromEntries(AI_MODULE_IDS.map((id) => [id, 'boolean' as const])) },
};

/**
 * The field contract of every command kind, keyed like {@link COMMAND_ISSUER} so a new kind cannot be
 * added without one. It describes the wire payload, not who may send it: the authority gate still
 * decides that, and an authored-setup-only option is a field a seat envelope simply may not carry.
 */
const COMMAND_PAYLOAD: { readonly [K in Command['kind']]: FieldSpec } = {
  learn: {
    required: { entity: 'integer', house: 'integer', target: { oneOf: ['job', 'good'] }, typeId: 'integer' },
  },
  payTribute: { required: { player: 'integer', slot: 'integer' } },
  attachTradeHouse: { required: { entity: 'integer', house: 'integer' } },
  detachTradeHouse: { required: { entity: 'integer', house: 'integer' } },
  setTradeImport: { required: { entity: 'integer', house: 'integer', good: 'integer', on: 'boolean' } },
  clearTradeImports: { required: { entity: 'integer' } },
  setTradeAgreement: { required: { entity: 'integer', agreement: 'integer' } },
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
  exploreArea: { required: { entity: 'integer', ...NODE } },
  grantPaper: { required: { player: 'integer', paper: PAPER } },
  orderNeed: {
    required: {
      entity: 'integer',
      need: { oneOf: ['hunger', 'fatigue', 'piety', 'enjoyment'] satisfies readonly NeedKind[] },
    },
  },
  setRegeneration: { required: { entity: 'integer', enabled: 'boolean' } },
  unassignBuilder: { required: { entity: 'integer' } },
  assignBuilder: { required: { entity: 'integer', site: 'integer' } },
  assignHouse: { required: { entity: 'integer', house: 'integer' } },
  assignWorker: {
    required: { entity: 'integer', building: 'integer', jobPriority: { arrayOf: 'integer' } },
  },
  attackMoveUnit: { required: { entity: 'integer', ...NODE } },
  attackUnit: { required: { entity: 'integer', target: 'integer' } },
  cancelUpgrade: { required: { building: 'integer' } },
  debugCompleteConstruction: { required: { target: 'integer' } },
  debugFillStockpile: { required: { target: 'integer' } },
  debugKill: { required: { target: 'integer' } },
  debugSetNeeds: {
    required: { target: 'integer' },
    optional: { hunger: 'integer', fatigue: 'integer', piety: 'integer', enjoyment: 'integer' },
  },
  demolish: { required: { building: 'integer' } },
  demolishSignpost: { required: { signpost: 'integer' } },
  dropGood: { required: { good: 'integer', ...NODE, amount: 'integer' } },
  equipGood: {
    required: {
      entity: 'integer',
      group: { oneOf: EQUIP_CATEGORIES },
      slot: 'integer',
      goodType: 'integer',
    },
  },
  makeChild: { required: { entity: 'integer', child: { oneOf: CHILD_SEXES } } },
  marry: { required: { entity: 'integer' } },
  moveUnit: { required: { entity: 'integer', ...NODE } },
  openChest: { required: { entity: 'integer', chest: 'integer' } },
  placeBoat: {
    required: { vehicleType: 'integer', ...NODE, tribe: 'integer' },
    optional: { owner: 'integer' },
  },
  placeBuilding: {
    required: { buildingType: 'integer', ...NODE, tribe: 'integer' },
    optional: {
      missionId: 'integer',
      underConstruction: 'boolean',
      owner: 'integer',
      force: 'boolean',
      fillStock: 'boolean',
      initialGoods: { arrayOf: { fields: { required: { good: 'integer', amount: 'integer' } } } },
      paper: PAPER,
    },
  },
  placeResource: {
    required: { good: 'integer', ...NODE, remaining: 'integer', harvestAtomic: 'integer' },
    optional: {
      landscapeId: 'integer',
      felling: { fields: { required: { chopsLeft: 'integer' } } },
      deposit: { fields: { required: { levels: 'integer', strikesPerUnit: 'integer' } } },
    },
  },
  placeSignpost: { required: { entity: 'integer', ...NODE } },
  setAssistantCounter: {
    required: {
      player: 'integer',
      counter: { oneOf: ASSISTANT_COUNTER_KINDS },
      value: 'integer',
      infinite: 'boolean',
    },
  },
  setAssistantGrant: { required: { player: 'integer', goodType: 'integer', enabled: 'boolean' } },
  setCraftGoods: { required: { entity: 'integer', goods: { arrayOf: 'integer' } } },
  setDefenceMode: { required: { building: 'integer', enabled: 'boolean' } },
  setDiplomacy: { required: { from: 'integer', to: 'integer', state: { oneOf: DIPLOMACY_STATES } } },
  setFogMode: { required: { mode: 'integer' } },
  setGatherGood: { required: { entity: 'integer', goodType: { nullOr: 'integer' } } },
  setJob: { required: { entity: 'integer', jobType: 'integer' } },
  setMatchParticipants: {
    required: { players: { arrayOf: 'integer' } },
    optional: { victory: { oneOf: ['script', 'elimination'] } },
  },
  setNeedsEnabled: { required: { enabled: 'boolean' } },
  setPlayerPlacementTribes: { required: { player: 'integer', tribes: { arrayOf: 'integer' } } },
  setPlayerAi: {
    required: { player: 'integer', enabled: 'boolean' },
    optional: { modules: AI_MODULES, scripted: 'boolean' },
  },
  setProfessionProgression: { required: { enabled: 'boolean' } },
  setSignpostNavigation: { required: { enabled: 'boolean' } },
  setStance: { required: { entity: 'integer', mode: 'integer' } },
  setWorkFlag: { required: { entity: 'integer', ...NODE } },
  spawnAnimalHerd: {
    required: { tribe: 'integer', ...NODE },
    optional: { count: 'integer', missionId: 'integer', owner: 'integer' },
  },
  spawnSettler: {
    required: { jobType: 'integer', ...NODE, tribe: 'integer' },
    optional: {
      missionId: 'integer',
      behaviourFlags: 'integer',
      nameStringId: 'integer',
      hitpoints: 'integer',
      armorClass: 'integer',
      weaponTypeId: 'integer',
      equipment: EQUIPMENT,
      moveSpeed: 'integer',
      owner: 'integer',
      experience: { arrayOf: { tupleOf: ['integer', 'integer'] } },
      gatherGood: 'integer',
      home: { fields: { required: NODE } },
      workplace: { fields: { required: NODE } },
    },
  },
  trainSoldier: { required: { entity: 'integer', house: 'integer' } },
  unassignHouse: { required: { entity: 'integer' } },
  unassignWorker: { required: { entity: 'integer' } },
  unequipGood: {
    required: { entity: 'integer', group: { oneOf: EQUIP_CATEGORIES }, slot: 'integer' },
  },
  upgradeBuilding: { required: { building: 'integer' } },
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
  if (check === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`${at}: expected a boolean, got ${described(value)}`);
    }
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
    value.forEach((item: unknown, i) => {
      checkField(item, check.arrayOf, `${at}[${i}]`);
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
  if ('fields' in check) {
    checkFields(asRecord(value, at), check.fields, at);
    return;
  }
  assertNever(check);
}

function described(value: unknown): string {
  return typeof value === 'object' && value !== null ? typeName(value) : JSON.stringify(value);
}
