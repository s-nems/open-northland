import { hasMissionBehaviour, MISSION_BEHAVIOUR } from '../../components/behaviour.js';
import { isPlayerDead } from '../../components/match.js';
import { isValidPlayer, ownerOf, ownersCompatible } from '../../components/ownership.js';
import { playerPlacementTribes } from '../../components/player-placement.js';
import type {
  Command,
  CommandEnvelope,
  GroupMember,
  PlaceBuildingCommand,
  PlayerCommand,
  SeatEnvelope,
} from '../../core/commands/index.js';
import { COMMAND_ISSUER } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * The command the envelope applies, or undefined when its origin is not entitled to it. A rejected
 * command still lands in the replay log, so the same log replays to the same state. A seat's group order
 * keeps only the `members` the seat commands, so one held by a script, fallen, or not the seat's own
 * does not void the rest; the log keeps the order as issued, and a replay narrows it the same way.
 */
export function authorizedCommand(world: World, envelope: CommandEnvelope): Command | undefined {
  if (!ownerFieldsValid(envelope.command)) return undefined;
  if (envelope.origin === 'setup' || envelope.origin === 'admin') return envelope.command;
  const command = envelope.command;
  if (!seatMayIssue(world, envelope.player, command)) return undefined;
  const commanded = (e: Entity): boolean => seatCommandsUnit(world, envelope, e);
  if ('entity' in command) return commanded(command.entity) ? command : undefined;
  if ('members' in command) return keepMembers(command, commanded);
  return command;
}

function keepMembers<C extends { readonly members: readonly GroupMember[] }>(
  command: C,
  keep: (e: Entity) => boolean,
): C {
  return { ...command, members: command.members.filter((member) => keep(member.entity)) };
}

/**
 * Whether a seat may order unit `e`: it must be the seat's own, since a neutral animal and an ally's
 * settler are both off limits and diplomacy stays a relationship between players rather than shared
 * control of their entities. A script may also put one of a seat's own units beyond the player's reach
 * while the seat's AI keeps commanding it (`MISSIONS.md`, behaviour bit 5).
 */
function seatCommandsUnit(world: World, envelope: SeatEnvelope, e: Entity): boolean {
  if (ownerOf(world, e) !== envelope.player) return false;
  return envelope.origin !== 'player' || !hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE);
}

/** An entity is created with the owner the payload names, so an out-of-range slot must not reach the
 *  spawn: it would silently stand up a neutral entity nobody asked for. */
function ownerFieldsValid(command: Command): boolean {
  if ('owner' in command && command.owner !== undefined && !isValidPlayer(command.owner)) return false;
  return !('player' in command) || isValidPlayer(command.player);
}

function seatMayIssue(world: World, seat: number, command: PlayerCommand): boolean {
  if (COMMAND_ISSUER[command.kind] !== 'seat') return false;
  // A seat that died in the match keeps watching but never commands again.
  if (isPlayerDead(world, seat)) return false;
  if (command.kind === 'placeBuilding' || command.kind === 'placePalisade') {
    if (hasAuthoredOptions(command)) return false;
    if (!playerPlacementTribes(world, seat)?.includes(command.tribe)) return false;
  }
  if ('player' in command && command.player !== seat) return false;
  if ('owner' in command && command.owner !== seat) return false;

  const asset = assetTargetOf(command);
  if (
    (command.kind === 'demolishPalisade' ||
      command.kind === 'convertPalisadeGate' ||
      command.kind === 'setPalisadeGate') &&
    asset !== undefined
  ) {
    return ownerOf(world, asset) === seat;
  }
  return asset === undefined || ownersCompatible(seat, ownerOf(world, asset));
}

/** Only trusted origins may place finished buildings or supply authored placement options. */
function hasAuthoredOptions(
  command: PlaceBuildingCommand | Extract<PlayerCommand, { kind: 'placePalisade' }>,
): boolean {
  if (command.kind === 'placePalisade')
    return (
      command.underConstruction === false || command.valency !== undefined || command.force !== undefined
    );
  return (
    command.underConstruction === false ||
    command.force !== undefined ||
    command.fillStock !== undefined ||
    command.initialGoods !== undefined ||
    command.missionId !== undefined
  );
}

/**
 * The world asset a seat command acts on besides its own unit. A neutral one is fair game to any seat,
 * matching the economy's `sameSide` pairing, which on a map with unowned scenery also lets any seat raze
 * it. `attackUnit.target` is deliberately not one of these - an attack names someone else's unit.
 */
function assetTargetOf(command: PlayerCommand): Entity | undefined {
  // A trade route names the other side's house on purpose: the exchange happens at it.
  if (command.kind === 'attachTradeHouse' || command.kind === 'detachTradeHouse') return undefined;
  if (command.kind === 'setTradeImport') return undefined;
  if ('building' in command) return command.building;
  if ('site' in command) return command.site;
  if ('house' in command) return command.house;
  if ('signpost' in command) return command.signpost;
  if ('palisade' in command) return command.palisade;
  return undefined;
}
