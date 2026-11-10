import { type AttackLeash, Owner, Person, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isAnimalTribe, isFighterJob, seatStrikesBackUnarmed } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';
import { strikeParty } from './leash.js';
import { seatFieldsSoldier } from './seat-soldiers.js';

// A computer seat's civilians strike back at an unarmed raider instead of running from its blow, when the
// seat has no soldier to send. A deviation of the computer player's own; the original's civilians always run.

/** How far (map points) from where a civilian striking back stood its target may go before the civilian
 *  lets it go and returns to its work. Approximation: a short reach, so no one chases a raider off. */
export const STRIKE_BACK_LEASH_NODES = 6;

/** Whether `attacker` strikes unarmed: a person who is neither a soldier nor a hero. A tower, a vehicle and
 *  an animal are no person. */
function strikesUnarmed(world: World, ctx: SystemContext, attacker: Entity): boolean {
  const settler = world.tryGet(attacker, Settler);
  if (settler === undefined || !world.has(attacker, Person)) return false;
  return !isFighterJob(ctx.content, settler.jobType) && !isAnimalTribe(ctx.content, settler.tribe);
}

/** Whether a blow on `victim` from `attacker` is one {@link strikeBack} answers at all, asked before its
 *  caller gathers the people near the blow. */
export function mayStrikeBack(world: World, ctx: SystemContext, victim: Entity, attacker: Entity): boolean {
  const owner = world.tryGet(victim, Owner);
  if (owner === undefined || !seatStrikesBackUnarmed(world, owner.player)) return false;
  if (isFighterJob(ctx.content, world.get(victim, Settler).jobType)) return false;
  if (!strikesUnarmed(world, ctx, attacker)) return false;
  return !seatFieldsSoldier(world, ctx, owner.player);
}

/**
 * Answer a blow on a computer seat's civilian from an unarmed `attacker`: the struck one and the nearest
 * free civilians of `people` (the struck side's people in the open near the blow, ascending distance) take
 * it on, each on a leash of where it stood. A seat that fields a soldier leaves the answer to its soldiers
 * (the hit alarm and its defence decision), so its civilians run as the original's do. Answers whether the
 * seat strikes back, so the rest of its people keep to their work; false leaves the blow to the ordinary run.
 */
export function strikeBack(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  victim: Entity,
  attacker: Entity,
  people: readonly { readonly entity: Entity }[],
): boolean {
  const owner = world.tryGet(victim, Owner);
  if (owner === undefined || !mayStrikeBack(world, ctx, victim, attacker)) return false;
  const origin = { player: owner.player, source: 'military' } as const;
  const party = [victim];
  for (const { entity } of people) if (entity !== victim) party.push(entity);
  return (
    strikeParty(world, ctx, terrain, attacker, party, victim, origin, (e) =>
      strikeBackLeash(world, terrain, e),
    ) > 0
  );
}

/** The leash of a civilian striking back: {@link STRIKE_BACK_LEASH_NODES} around where it stands. */
export function strikeBackLeash(world: World, terrain: TerrainGraph, e: Entity): AttackLeash {
  return { at: entityNode(world, terrain, e), radius: STRIKE_BACK_LEASH_NODES };
}
