import {
  Building,
  isWildlife,
  Palisade,
  Position,
  Vehicle,
  WALK_DIRECTION,
  type WalkDirection,
  WalkFacing,
} from '../../../../../../components/index.js';
import type { Fixed } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import {
  HEX_HEADING,
  HEX_HEADING_COUNT,
  type HexHeading,
  hexHeadingBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
} from '../../../../../../nav/halfcell.js';
import { targetBlocking } from '../../../../../conflict/weapons.js';
import type { SystemContext } from '../../../../../context.js';
import { damageDealtBy, damageTakenBy } from '../../../../../equipment/index.js';
import { INITIAL_WALK_DIRECTION } from '../../../../../movement/turning.js';

const PERCENT = 100;
/** Original behavior: a blow from the back sides lands x1.25, from behind x1.5, in percent. */
const BACK_SIDE_HIT_PCT = 125;
const BEHIND_HIT_PCT = 150;

/**
 * A blow's damage multiplier in percent by how far the victim faces away from where the blow comes from,
 * indexed by the wrapped difference of the two map-point headings: front, front side, back side, behind.
 * Intentional deviation from the original: it takes the unwrapped difference, so one back side and one
 * front side count as behind there, depending on the headings' numbering; here the bins are symmetric.
 */
const HIT_DIRECTION_PCT: readonly number[] = [PERCENT, PERCENT, BACK_SIDE_HIT_PCT, BEHIND_HIT_PCT];

/** Original behavior: a victim's walk facing reads as a map-point heading, north as NE and south as SW. */
const HEX_HEADING_OF_FACING: Readonly<Record<WalkDirection, HexHeading>> = {
  [WALK_DIRECTION.E]: HEX_HEADING.E,
  [WALK_DIRECTION.SE]: HEX_HEADING.SE,
  [WALK_DIRECTION.SW]: HEX_HEADING.SW,
  [WALK_DIRECTION.W]: HEX_HEADING.W,
  [WALK_DIRECTION.NW]: HEX_HEADING.NW,
  [WALK_DIRECTION.NE]: HEX_HEADING.NE,
  [WALK_DIRECTION.N]: HEX_HEADING.NE,
  [WALK_DIRECTION.S]: HEX_HEADING.SW,
};

/**
 * The hitpoints one landed blow takes from `target`, from `base`: the weapon's column for the target,
 * already raised by the striker's fight experience on a melee blow at a person, a beast or a building.
 * Original behavior, by what is struck:
 * - a person: the hit direction multiplier, then its armor's `blockingValue` off, then the striker's
 *   amulets, then the person's own defence amulet;
 * - a building or a wall: nothing for a zero base, then the striker's amulets;
 * - an animal or a vehicle: the striker's amulets.
 * `strikerAmulets` is false for a vehicle's shot, which no amulet raises. A result at or below zero does
 * nothing: no damage and no fight experience.
 */
export function landedDamage(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  target: Entity,
  base: number,
  from: { readonly x: Fixed; readonly y: Fixed } | undefined,
  strikerAmulets: boolean,
): number {
  const dealtBy = (raw: number): number => (strikerAmulets ? damageDealtBy(world, ctx, attacker, raw) : raw);
  if (world.has(target, Building) || world.has(target, Palisade)) return base === 0 ? 0 : dealtBy(base);
  if (isWildlife(world, target) || world.has(target, Vehicle)) return dealtBy(base);
  const directed = Math.trunc((base * hitDirectionPct(world, target, from)) / PERCENT);
  const blocked = directed - targetBlocking(world, ctx, target);
  return damageTakenBy(world, ctx, target, dealtBy(blocked));
}

/**
 * The {@link HIT_DIRECTION_PCT} a blow from `from` lands on `victim` with. Original behavior: a person
 * that has never turned faces {@link INITIAL_WALK_DIRECTION}.
 */
function hitDirectionPct(
  world: World,
  victim: Entity,
  from: { readonly x: Fixed; readonly y: Fixed } | undefined,
): number {
  const at = world.tryGet(victim, Position);
  if (at === undefined || from === undefined) return PERCENT;
  const facing = world.tryGet(victim, WalkFacing)?.direction ?? INITIAL_WALK_DIRECTION;
  const toward = hexHeadingBetween(
    nodeHxOfPosition(at.x, at.y),
    nodeHyOfPosition(at.y),
    nodeHxOfPosition(from.x, from.y),
    nodeHyOfPosition(from.y),
  );
  const apart = Math.abs(toward - HEX_HEADING_OF_FACING[facing]);
  return HIT_DIRECTION_PCT[Math.min(apart, HEX_HEADING_COUNT - apart)] ?? PERCENT;
}
