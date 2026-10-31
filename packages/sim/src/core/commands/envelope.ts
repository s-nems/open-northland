import type { ComputerModuleId } from '../../components/ai/control.js';
import { assertNever } from '../brand.js';
import { isPlainRecord, valueShapeName } from '../plain-value.js';
import type { AssistantCommand } from './assistant.js';
import type { DiplomacyCommand } from './diplomacy.js';
import type { Command } from './index.js';
import type { PlayerPlacementCommand } from './placement.js';
import type { TradeCommand } from './trade.js';
import type { TributeCommand } from './tribute.js';
import type { UnitOrderCommand } from './unit-orders.js';

/** Wire version of {@link CommandEnvelope}. An imported log carrying another version is rejected. */
export const COMMAND_ENVELOPE_VERSION = 2;

/** The commands a seat may issue for itself; {@link COMMAND_ISSUER} is the full split. */
export type PlayerCommand =
  | PlayerPlacementCommand
  | UnitOrderCommand
  | AssistantCommand
  | TributeCommand
  | DiplomacyCommand
  | TradeCommand;

/** A command plus the authority it was issued under - the serializable external input the sim accepts. */
export type CommandEnvelope = SeatEnvelope | TrustedEnvelope;

/**
 * An envelope acting for one player: `player` is a human seat and `ai` a machine seat, and both reach
 * only that player's assets.
 */
export type AiDecisionSource = ComputerModuleId | 'map-ai' | 'settlement-defence';

export type SeatEnvelope =
  | {
      readonly v: Version;
      readonly origin: 'player';
      readonly player: number;
      readonly command: PlayerCommand;
    }
  | {
      readonly v: Version;
      readonly origin: 'ai';
      readonly player: number;
      readonly command: PlayerCommand;
      /** Present for planner decisions; generic AI-authority inputs need no planner. */
      readonly decisionSource?: AiDecisionSource;
    };

/**
 * An envelope from a producer the sim trusts with any command: `setup` is authored pre-run assembly
 * (scenes, decoded map imports, fixtures) and `admin` the rules, debug, and overseer channel.
 */
export type TrustedEnvelope =
  | { readonly v: Version; readonly origin: 'setup'; readonly command: Command }
  | { readonly v: Version; readonly origin: 'admin'; readonly command: Command };

type Version = typeof COMMAND_ENVELOPE_VERSION;

export function playerCommand(player: number, command: PlayerCommand): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'player', player, command };
}

export function aiCommand(
  player: number,
  command: PlayerCommand,
  decisionSource?: AiDecisionSource,
): CommandEnvelope {
  return {
    v: COMMAND_ENVELOPE_VERSION,
    origin: 'ai',
    player,
    command,
    ...(decisionSource === undefined ? {} : { decisionSource }),
  };
}

export function setupCommand(command: Command): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'setup', command };
}

export function adminCommand(command: Command): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'admin', command };
}

/**
 * Which origins may issue each command kind - the runtime gate, read by the authority check and the
 * import validator, for what {@link PlayerCommand} enforces at compile time.
 */
export const COMMAND_ISSUER: {
  readonly [K in Command['kind']]: K extends PlayerCommand['kind'] ? 'seat' : 'trusted';
} = {
  assignBuilder: 'seat',
  assignHouse: 'seat',
  assignHouseGroup: 'seat',
  assignWorker: 'seat',
  assignWorkerGroup: 'seat',
  attachTradeHouse: 'seat',
  addTradeAgreement: 'trusted',
  attachToVehicle: 'seat',
  attackMoveUnit: 'seat',
  attackMoveUnitGroup: 'seat',
  moveUnitGroup: 'seat',
  attackUnitGroup: 'seat',
  setStanceGroup: 'seat',
  setRegenerationGroup: 'seat',
  unitActionGroup: 'seat',
  unitOrdersGroup: 'seat',
  boardVehicle: 'seat',
  attackUnit: 'seat',
  attackWithVehicle: 'seat',
  attackWithVehicleGroup: 'seat',
  moveVehicleGroup: 'seat',
  setVehicleStanceGroup: 'seat',
  cancelTraining: 'seat',
  cancelUpgrade: 'seat',
  clearHaulFlag: 'seat',
  debugCompleteConstruction: 'trusted',
  debugFillStockpile: 'trusted',
  debugKill: 'trusted',
  debugSetHealth: 'trusted',
  debugSetNeeds: 'trusted',
  debugTeleport: 'trusted',
  declareDiplomacy: 'seat',
  demolish: 'seat',
  demolishPalisade: 'seat',
  demolishSignpost: 'seat',
  detachFromVehicle: 'seat',
  detachTradeHouse: 'seat',
  dockVehicle: 'seat',
  claimAnimal: 'seat',
  clearTradeImports: 'seat',
  createVehicle: 'trusted',
  dropGood: 'trusted',
  equipGood: 'seat',
  explore: 'seat',
  grantPaper: 'trusted',
  makeChild: 'seat',
  marry: 'seat',
  moveUnit: 'seat',
  moveVehicle: 'seat',
  openChest: 'seat',
  orderNeed: 'seat',
  payTribute: 'seat',
  placeBuilding: 'seat',
  placePalisade: 'seat',
  convertPalisadeGate: 'seat',
  placeRoadSite: 'seat',
  cancelRoadSite: 'seat',
  placeResource: 'trusted',
  placeSignpost: 'seat',
  setAlliedVision: 'trusted',
  setBioGroundWaived: 'trusted',
  setAssistantCounter: 'seat',
  setAssistantGrant: 'seat',
  setAssistantGrantAudience: 'seat',
  setAssistantPostGraduates: 'seat',
  setAssistantMoveFlags: 'seat',
  setAssistantWeaponVeto: 'seat',
  setAssistantArmorOrder: 'seat',
  setAssistantWeaponOrder: 'seat',
  setProductionGoods: 'seat',
  setProductionCount: 'seat',
  setDefenceMode: 'seat',
  setDiplomacy: 'trusted',
  setFogMode: 'trusted',
  setGatherGood: 'seat',
  setHouseholdGoodUse: 'seat',
  setStorageMinimum: 'seat',
  setJob: 'seat',
  setMatchParticipants: 'trusted',
  continueMatch: 'trusted',
  endMatchContinuation: 'trusted',
  setMissionsEnabled: 'trusted',
  setNeedsEnabled: 'trusted',
  setAiControl: 'trusted',
  setPlayerPlacementTribes: 'trusted',
  setProfessionProgression: 'trusted',
  setRegeneration: 'seat',
  setPalisadeGate: 'seat',
  setPalisadeGateMode: 'seat',
  setSignpostNavigation: 'trusted',
  setStance: 'seat',
  setVehicleStance: 'seat',
  setTradeAgreement: 'seat',
  setTradeAgreementLimits: 'seat',
  setTradeSettlement: 'seat',
  setTradeImport: 'seat',
  setTradeImportLimits: 'seat',
  setVehicleWanted: 'seat',
  clearVehicleWanted: 'seat',
  setWorkFlag: 'seat',
  marryPlaced: 'trusted',
  parentPlacedChild: 'trusted',
  spawnAnimalHerd: 'trusted',
  spawnSettler: 'trusted',
  stopVehicle: 'seat',
  trainSoldier: 'seat',
  unassignBuilder: 'seat',
  learn: 'seat',
  leaveCarrier: 'seat',
  loadIntoVehicle: 'seat',
  unassignHouse: 'seat',
  unassignWorker: 'seat',
  unequipGood: 'seat',
  unloadPeople: 'seat',
  upgradeBuilding: 'seat',
};

/**
 * An owned copy of `envelope`; seat placements default to construction sites owned by the issuing
 * seat. The copy keeps no alias to a caller's payload, so a post-enqueue mutation cannot
 * rewrite what applies or what the replay log carries.
 */
export function ownedEnvelope(envelope: CommandEnvelope): CommandEnvelope {
  switch (envelope.origin) {
    case 'setup':
      return setupCommand(clonePlainData(envelope.command));
    case 'admin':
      return adminCommand(clonePlainData(envelope.command));
    case 'player':
      return playerCommand(envelope.player, seatOwned(envelope.command, envelope.player));
    case 'ai':
      return aiCommand(
        envelope.player,
        seatOwned(envelope.command, envelope.player),
        envelope.decisionSource,
      );
    default:
      return assertNever(envelope);
  }
}

function seatOwned(command: PlayerCommand, player: number): PlayerCommand {
  const owned = clonePlainData(command);
  if (owned.kind === 'placeRoadSite') return { ...owned, owner: owned.owner ?? player };
  if (owned.kind !== 'placeBuilding' && owned.kind !== 'placePalisade') return owned;
  return {
    ...owned,
    owner: owned.owner === undefined ? player : owned.owner,
    underConstruction: owned.underConstruction === undefined ? true : owned.underConstruction,
  };
}

/**
 * Commands are plain JSON data by contract - the wire a multiplayer command crosses and the replay log
 * both carry them as JSON - so the copy keeps exactly what JSON keeps, and a local command is judged
 * the same way a replayed one is: a non-finite number and an undefined list member become `null`,
 * `-0` becomes `0` and a record field holding `undefined` is left out.
 * The accumulator is prototype-less because a `JSON.parse`d payload can carry an own `__proto__` key,
 * which an object literal would apply as a prototype instead of copying - and the authority gate reads
 * `owner`/`player` with `in`.
 */
function clonePlainData<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null as T;
    return (value === 0 ? 0 : value) as T;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((member: unknown) => (member === undefined ? null : clonePlainData(member))) as T;
  }
  if (!isPlainRecord(value)) {
    throw new Error(`command payload holds a non-serializable ${valueShapeName(value)}`);
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const field = value[key];
    if (field !== undefined) out[key] = clonePlainData(field);
  }
  return out as T;
}
