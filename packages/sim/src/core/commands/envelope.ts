import type { AssistantCommand } from './assistant.js';
import type { Command } from './index.js';
import type { PlayerPlacementCommand } from './placement.js';
import type { UnitOrderCommand } from './unit-orders.js';

/** Wire version of {@link CommandEnvelope}. An imported log carrying another version is rejected. */
export const COMMAND_ENVELOPE_VERSION = 1;

/**
 * Who issued a command. `player` is a human seat and `ai` a machine seat: both act for one player id
 * and reach only that player's assets. `setup` is authored pre-run assembly (scenes, decoded map
 * imports, fixtures) and `admin` is the rules and debug channel; both are trusted, so they may edit the
 * world, set global rules, and create intentionally neutral entities.
 */
export type CommandOrigin = 'player' | 'ai' | 'setup' | 'admin';

/**
 * The commands a seat may issue for itself. World edits (spawns, resource nodes, loose goods, boats),
 * global rules, the AI-seat flag, and the debug pokes need a trusted envelope, as do the authored
 * `placeBuilding` options.
 */
export type PlayerCommand = PlayerPlacementCommand | UnitOrderCommand | AssistantCommand;

/**
 * A command plus the authority it was issued under - the serializable external input the sim accepts.
 * A seat envelope carries the player it acts for and can only hold a {@link PlayerCommand}, so a
 * forced placement or a global rule change is unrepresentable in one.
 */
export type CommandEnvelope = SeatEnvelope | TrustedEnvelope;

/** An envelope issued for one player: the seat is held to its own units, assets, and placements. */
export type SeatEnvelope =
  | {
      readonly v: Version;
      readonly origin: 'player';
      readonly player: number;
      readonly command: PlayerCommand;
    }
  | { readonly v: Version; readonly origin: 'ai'; readonly player: number; readonly command: PlayerCommand };

/** An envelope from a trusted producer, which may issue any command. */
export type TrustedEnvelope =
  | { readonly v: Version; readonly origin: 'setup'; readonly command: Command }
  | { readonly v: Version; readonly origin: 'admin'; readonly command: Command };

type Version = typeof COMMAND_ENVELOPE_VERSION;

/** An order a human seat issues for player `player`. */
export function playerCommand(player: number, command: PlayerCommand): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'player', player, command };
}

/** An order the strategic AI issues for the seat it plays. */
export function aiCommand(player: number, command: PlayerCommand): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'ai', player, command };
}

/** Authored world assembly: scenes, decoded map imports, and fixtures, which may leave an entity
 *  neutral and use the authored placement options. */
export function setupCommand(command: Command): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'setup', command };
}

/** The rules and debug channel, and the overseer view that commands every seat. */
export function adminCommand(command: Command): CommandEnvelope {
  return { v: COMMAND_ENVELOPE_VERSION, origin: 'admin', command };
}

/**
 * Which origins may issue each command kind, mirroring the {@link PlayerCommand} type so the import
 * validator enforces at runtime what the types enforce at compile time. The mapped value is derived
 * from that type, so a kind moving between the two sides fails to compile until this table follows.
 */
export const COMMAND_ISSUER: {
  readonly [K in Command['kind']]: K extends PlayerCommand['kind'] ? 'seat' : 'trusted';
} = {
  assignBuilder: 'seat',
  assignHouse: 'seat',
  assignWorker: 'seat',
  attackMoveUnit: 'seat',
  attackUnit: 'seat',
  cancelUpgrade: 'seat',
  debugCompleteConstruction: 'trusted',
  debugFillStockpile: 'trusted',
  debugKill: 'trusted',
  debugSetNeeds: 'trusted',
  demolish: 'seat',
  demolishSignpost: 'seat',
  dropGood: 'trusted',
  equipGood: 'seat',
  makeChild: 'seat',
  marry: 'seat',
  moveUnit: 'seat',
  placeBoat: 'trusted',
  placeBuilding: 'seat',
  placeResource: 'trusted',
  placeSignpost: 'seat',
  setAssistantCounter: 'seat',
  setAssistantGrant: 'seat',
  setCraftGoods: 'seat',
  setDefenceMode: 'seat',
  setFogMode: 'trusted',
  setGatherGood: 'seat',
  setJob: 'seat',
  setNeedsEnabled: 'trusted',
  setPlayerAi: 'trusted',
  setProfessionProgression: 'trusted',
  setSignpostNavigation: 'trusted',
  setStance: 'seat',
  setWorkFlag: 'seat',
  spawnAnimalHerd: 'trusted',
  spawnSettler: 'trusted',
  trainSoldier: 'seat',
  unassignHouse: 'seat',
  unequipGood: 'seat',
  upgradeBuilding: 'seat',
};

/**
 * A queue-owned copy of `envelope`, with an omitted owner on a seat placement filled in from the
 * issuing seat. Commands are JSON-shaped by contract, so the object/array walk is an exact copy: the
 * queue keeps no alias to a caller's payload, and a post-enqueue mutation cannot rewrite what applies
 * or what the replay log carries.
 */
export function ownedEnvelope(envelope: CommandEnvelope): CommandEnvelope {
  if (envelope.origin === 'setup' || envelope.origin === 'admin') {
    return { ...envelope, command: clonePlainData(envelope.command) };
  }
  const command = clonePlainData(envelope.command);
  if (command.kind !== 'placeBuilding' || command.owner !== undefined) {
    return { ...envelope, command };
  }
  return { ...envelope, command: { ...command, owner: envelope.player } };
}

function clonePlainData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((member: unknown) => clonePlainData(member)) as T;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) out[key] = clonePlainData(member);
    return out as T;
  }
  return value;
}
