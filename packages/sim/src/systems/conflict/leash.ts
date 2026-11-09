import {
  type AiOrderOrigin,
  type AttackLeash,
  AttackOrder,
  CurrentAtomic,
  Fleeing,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  PlayerOrder,
  Settler,
  Sheltering,
  Weapon,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler } from '../family/eligibility.js';
import { attackUnit } from '../orders/combat.js';
import { isFighterJob } from '../readviews/index.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { isValidTarget } from './targeting.js';
import { attackerWeapon } from './weapons.js';

// Attacks bound to a place: a defender lets its target go once it strays past the leash's radius.

/** How many civilians at most strike back at one raider: the struck one and one helper. Approximation. */
export const STRIKE_BACK_PARTY = 2;

/** Order `e` at `target` on `leash`; answers whether the order took. */
export function leashedAttack(
  world: World,
  ctx: SystemContext,
  e: Entity,
  target: Entity,
  leash: AttackLeash,
  origin: AiOrderOrigin,
): boolean {
  attackUnit(world, ctx, { kind: 'attackUnit', entity: e, target, assault: true }, origin);
  if (world.tryGet(e, AttackOrder)?.target !== target) return false;
  world.mut(e, AttackOrder).leash = leash;
  return true;
}

/** Whether a defender on `leash` lets its `target` go: the target stands past the leash's radius of its
 *  anchor. */
export function strayedPastLeash(
  world: World,
  terrain: TerrainGraph,
  leash: AttackLeash,
  target: Entity,
): boolean {
  return hexNodeDistance(terrain, leash.at, entityNode(world, terrain, target)) > leash.radius;
}

/**
 * Send the first free civilians of `people` (nearest first) at `attacker`, up to {@link STRIKE_BACK_PARTY}
 * counting those of them already on it, each on the leash `leashOf` gives it; one whose leash `attacker`
 * already stands past stays put. `struck` is the one the blow fell on, who strikes back even woken from
 * sleep, or null. Answers the party's size.
 */
export function strikeParty(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  attacker: Entity,
  people: readonly Entity[],
  struck: Entity | null,
  origin: AiOrderOrigin,
  leashOf: (e: Entity) => AttackLeash,
): number {
  let party = 0;
  for (const e of people) if (strikesBackAt(world, e, attacker)) party++;
  for (const e of people) {
    if (party >= STRIKE_BACK_PARTY) break;
    if (!mayStrikeBack(world, ctx, e, attacker, e === struck)) continue;
    const leash = leashOf(e);
    if (strayedPastLeash(world, terrain, leash, attacker)) continue;
    if (leashedAttack(world, ctx, e, attacker, leash, origin)) party++;
  }
  return party;
}

/** Whether civilian `e` is free to strike back at `attacker`: a grown-up, armed (fists count), in the open
 *  and awake unless it is the struck one, and under no order, run or shelter of its own. */
function mayStrikeBack(
  world: World,
  ctx: SystemContext,
  e: Entity,
  attacker: Entity,
  struck: boolean,
): boolean {
  if (!isAdultSettler(world, e)) return false;
  const settler = world.get(e, Settler);
  if (isFighterJob(ctx.content, settler.jobType)) return false;
  if (world.has(e, PlayerOrder) || world.has(e, AttackOrder) || world.has(e, Fleeing)) return false;
  if (world.has(e, Sheltering) || hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) return false;
  if (!struck && world.tryGet(e, CurrentAtomic)?.effect.kind === 'sleep') return false;
  const weapon = attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
  return weapon !== null && isValidTarget(world, ctx, e, settler, attacker);
}

/** Whether `e` already strikes back at `attacker`. */
function strikesBackAt(world: World, e: Entity, attacker: Entity): boolean {
  const order = world.tryGet(e, AttackOrder);
  return order?.leash !== undefined && order.target === attacker;
}
