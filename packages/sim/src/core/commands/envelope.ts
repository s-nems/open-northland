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
export const COMMAND_ENVELOPE_VERSION = 1;

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
export type SeatEnvelope =
  | {
      readonly v: Version;
      readonly origin: 'player';
      readonly player: number;
      readonly command: PlayerCommand;
    }
  | { readonly v: Version; readonly origin: 'ai'; readonly player: number; readonly command: PlayerCommand };

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

export function aiCommand(player: number, command: PlayerCommand): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'ai', player, command };
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
  assignWorker: 'seat',
  attachTradeHouse: 'seat',
  addTradeAgreement: 'trusted',
  attackMoveUnit: 'seat',
  attackUnit: 'seat',
  cancelTraining: 'seat',
  cancelUpgrade: 'seat',
  debugCompleteConstruction: 'trusted',
  debugFillStockpile: 'trusted',
  debugKill: 'trusted',
  debugSetNeeds: 'trusted',
  declareDiplomacy: 'seat',
  demolish: 'seat',
  demolishSignpost: 'seat',
  detachTradeHouse: 'seat',
  clearTradeImports: 'seat',
  dropGood: 'trusted',
  equipGood: 'seat',
  exploreArea: 'seat',
  grantPaper: 'trusted',
  makeChild: 'seat',
  marry: 'seat',
  moveUnit: 'seat',
  openChest: 'seat',
  orderNeed: 'seat',
  payTribute: 'seat',
  placeBoat: 'trusted',
  placeBuilding: 'seat',
  placeResource: 'trusted',
  placeSignpost: 'seat',
  setAssistantCounter: 'seat',
  setAssistantGrant: 'seat',
  setCraftGoods: 'seat',
  setDefenceMode: 'seat',
  setDiplomacy: 'trusted',
  setFogMode: 'trusted',
  setGatherGood: 'seat',
  setHomeQualityUse: 'seat',
  setJob: 'seat',
  setMatchParticipants: 'trusted',
  setMissionsEnabled: 'trusted',
  setNeedsEnabled: 'trusted',
  setPlayerAi: 'trusted',
  setPlayerPlacementTribes: 'trusted',
  setProfessionProgression: 'trusted',
  setRegeneration: 'seat',
  setSharedVision: 'trusted',
  setSignpostNavigation: 'trusted',
  setStance: 'seat',
  setTradeAgreement: 'seat',
  setTradeImport: 'seat',
  setWorkFlag: 'seat',
  spawnAnimalHerd: 'trusted',
  spawnSettler: 'trusted',
  trainSoldier: 'seat',
  unassignBuilder: 'seat',
  learn: 'seat',
  unassignHouse: 'seat',
  unassignWorker: 'seat',
  unequipGood: 'seat',
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
      return aiCommand(envelope.player, seatOwned(envelope.command, envelope.player));
    default:
      return assertNever(envelope);
  }
}

function seatOwned(command: PlayerCommand, player: number): PlayerCommand {
  const owned = clonePlainData(command);
  if (owned.kind !== 'placeBuilding') return owned;
  return {
    ...owned,
    owner: owned.owner === undefined ? player : owned.owner,
    underConstruction: owned.underConstruction === undefined ? true : owned.underConstruction,
  };
}

/**
 * Commands are plain serializable data by contract, so anything else in a payload throws rather than
 * being silently flattened into the replay log. The accumulator is prototype-less because a
 * `JSON.parse`d payload can carry an own `__proto__` key, which an object literal would apply as a
 * prototype instead of copying - and the authority gate reads `owner`/`player` with `in`.
 */
function clonePlainData<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((member: unknown) => clonePlainData(member)) as T;
  if (!isPlainRecord(value)) {
    throw new Error(`command payload holds a non-serializable ${valueShapeName(value)}`);
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) out[key] = clonePlainData(value[key]);
  return out as T;
}
