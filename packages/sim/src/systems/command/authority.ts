import { hasMissionBehaviour, MISSION_BEHAVIOUR } from '../../components/behaviour.js';
import { isPlayerDead } from '../../components/match.js';
import { isValidPlayer, ownerOf, ownersCompatible } from '../../components/ownership.js';
import { playerPlacementTribes } from '../../components/player-placement.js';
import type {
  Command,
  CommandEnvelope,
  PlaceBuildingCommand,
  PlayerCommand,
} from '../../core/commands/index.js';
import { COMMAND_ISSUER } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Whether the envelope's origin is entitled to the command it carries. A rejected command still lands
 * in the replay log, so the same log replays to the same state.
 */
export function isAuthorized(world: World, envelope: CommandEnvelope): boolean {
  if (!ownerFieldsValid(envelope.command)) return false;
  if (envelope.origin === 'setup' || envelope.origin === 'admin') return true;
  // A script may put one of a seat's own units beyond the player's reach while the seat's AI keeps
  // commanding it (`MISSIONS.md`, behaviour bit 5).
  if (envelope.origin === 'player' && beyondPlayerControl(world, envelope.command)) return false;
  return seatMayIssue(world, envelope.player, envelope.command);
}

/** An entity is created with the owner the payload names, so an out-of-range slot must not reach the
 *  spawn: it would silently stand up a neutral entity nobody asked for. */
function ownerFieldsValid(command: Command): boolean {
  if ('owner' in command && command.owner !== undefined && !isValidPlayer(command.owner)) return false;
  return !('player' in command) || isValidPlayer(command.player);
}

function beyondPlayerControl(world: World, command: PlayerCommand): boolean {
  return (
    'entity' in command && hasMissionBehaviour(world, command.entity, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)
  );
}

function seatMayIssue(world: World, seat: number, command: PlayerCommand): boolean {
  if (COMMAND_ISSUER[command.kind] !== 'seat') return false;
  // A seat that died in the match keeps watching but never commands again.
  if (isPlayerDead(world, seat)) return false;
  if (command.kind === 'placeBuilding') {
    if (hasAuthoredOptions(command)) return false;
    if (!playerPlacementTribes(world, seat)?.includes(command.tribe)) return false;
  }
  if ('player' in command && command.player !== seat) return false;
  if ('owner' in command && command.owner !== seat) return false;

  // The ordered unit must be the seat's own: a neutral animal and an ally's settler are both off limits,
  // so diplomacy stays a relationship between players rather than shared control of their entities.
  if ('entity' in command && ownerOf(world, command.entity) !== seat) return false;

  const asset = assetTargetOf(command);
  return asset === undefined || ownersCompatible(seat, ownerOf(world, asset));
}

/** Only trusted origins may place finished buildings or supply authored placement options. */
function hasAuthoredOptions(command: PlaceBuildingCommand): boolean {
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
  return undefined;
}
