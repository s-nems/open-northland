import { isValidPlayer, ownerOf, ownersCompatible } from '../../components/ownership.js';
import type { QueuedCommand } from '../../core/command-queue.js';
import type { Command, PlaceBuildingCommand, PlayerCommand } from '../../core/commands/index.js';
import { COMMAND_ISSUER } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';

/**
 * Whether the envelope's origin is entitled to the command it carries. A rejected command still lands
 * in the replay log, so the same log replays to the same state; the reason channel belongs to the
 * dependent admission-outcomes work, not here.
 */
export function isAuthorized(world: World, queued: QueuedCommand): boolean {
  if (!ownerFieldsValid(queued.command)) return false;
  if (queued.origin === 'setup' || queued.origin === 'admin') return true;
  return seatMayIssue(world, queued.player, queued.command);
}

/** An entity is created with the owner the payload names, so an out-of-range slot must not reach the
 *  spawn: it would silently stand up a neutral entity nobody asked for. */
function ownerFieldsValid(command: Command): boolean {
  if ('owner' in command && command.owner !== undefined && !isValidPlayer(command.owner)) return false;
  return !('player' in command) || isValidPlayer(command.player);
}

function seatMayIssue(world: World, seat: number, command: PlayerCommand): boolean {
  if (COMMAND_ISSUER[command.kind] !== 'seat') return false;
  if (command.kind === 'placeBuilding' && hasAuthoredOptions(command)) return false;
  if ('player' in command && command.player !== seat) return false;
  if ('owner' in command && command.owner !== seat) return false;

  // The ordered unit must be the seat's own: a neutral animal and an ally's settler are both off limits,
  // so diplomacy stays a relationship between players rather than shared control of their entities.
  if ('entity' in command && ownerOf(world, command.entity) !== seat) return false;

  const asset = assetTargetOf(command);
  return asset === undefined || ownersCompatible(seat, ownerOf(world, asset));
}

/** A player envelope's `placeBuilding` type has these as `never`, so only an imported or untyped
 *  payload can carry them. */
function hasAuthoredOptions(command: PlaceBuildingCommand): boolean {
  return command.force !== undefined || command.fillStock !== undefined || command.initialGoods !== undefined;
}

/**
 * The world asset a seat command acts on besides its own unit: a workplace, a build site, a home, a
 * garrison, or a signpost. A neutral one is fair game to any seat, matching the economy's `sameSide`
 * pairing. `attackUnit.target` is deliberately not one of these - an attack names someone else's unit.
 */
function assetTargetOf(command: PlayerCommand): Entity | undefined {
  if ('building' in command) return command.building;
  if ('site' in command) return command.site;
  if ('house' in command) return command.house;
  if ('signpost' in command) return command.signpost;
  return undefined;
}
