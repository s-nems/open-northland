import { Health, Position, Rider, Settler, Vehicle, Weapon } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isSoldierJob, isWarship, WEAPON_MAIN_TYPE } from '../readviews/index.js';
import { attackerWeapon, loosesMissile, type MissileWeapon, vehicleWeapon } from './weapons.js';

/** How many bowmen shoot from one deck: the first ones by seat; the rest hold fire. Owner rule. */
export const DECK_ARCHER_LIMIT = 10;

/**
 * Hand `visit` the bowmen who shoot from `ship`'s deck: up to {@link DECK_ARCHER_LIMIT} live soldiers inside
 * it armed with a bow, in seat order, each with his seat and bow. Heroes and hunters do not shoot, nor does
 * anyone aboard anything but a warship. `visit` returns true to stop the walk, and so does this.
 */
export function visitDeckArchers(
  world: World,
  ctx: SystemContext,
  ship: Entity,
  visit: (archer: Entity, seat: number, bow: MissileWeapon) => boolean,
): boolean {
  const state = world.tryGet(ship, Vehicle);
  const type = state === undefined ? undefined : contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (state === undefined || type === undefined || !isWarship(ctx.content, type)) return false;
  let archers = 0;
  for (let seat = 0; seat < state.passengers.length && archers < DECK_ARCHER_LIMIT; seat++) {
    const held = state.passengers[seat];
    if (held == null || !held.inside) continue;
    const bow = deckBowOf(world, ctx, held.entity);
    if (bow === null) continue;
    archers++;
    if (visit(held.entity, seat, bow)) return true;
  }
  return false;
}

/** A vehicle its enemies treat as armed: a siege engine, or a ship with a bowman on deck. */
export function isArmedVehicle(world: World, ctx: SystemContext, vehicle: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  if (state === undefined) return false;
  return vehicleWeapon(ctx, state) !== null || hasDeckArchers(world, ctx, vehicle);
}

/** Whether at least one bowman shoots from `ship`'s deck. */
export function hasDeckArchers(world: World, ctx: SystemContext, ship: Entity): boolean {
  return visitDeckArchers(world, ctx, ship, anyArcher);
}

const anyArcher = (): boolean => true;

/** The body a blow from `attacker` comes from as its victims see it: the warship a bowman shoots from
 *  aboard, or null for anyone else, a siege engine's commander included. */
export function deckShipOf(world: World, ctx: SystemContext, attacker: Entity): Entity | null {
  if (world.has(attacker, Position)) return null;
  const vehicle = world.tryGet(attacker, Rider)?.vehicle;
  if (vehicle === undefined || !world.has(vehicle, Position)) return null;
  const state = world.tryGet(vehicle, Vehicle);
  const type = state === undefined ? undefined : contentIndex(ctx.content).vehicles.get(state.vehicleType);
  return type !== undefined && isWarship(ctx.content, type) ? vehicle : null;
}

/** The bow live soldier `e` shoots, or null when he is no bowman. */
function deckBowOf(world: World, ctx: SystemContext, e: Entity): MissileWeapon | null {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || !isSoldierJob(ctx.content, settler.jobType)) return null;
  if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return null;
  const worn = world.tryGet(e, Weapon)?.weaponTypeId;
  const bow = attackerWeapon(ctx, settler.tribe, settler.jobType, worn, settler.humanForm)?.weapon;
  return bow !== undefined && bow.mainType === WEAPON_MAIN_TYPE.BOW && loosesMissile(bow) ? bow : null;
}
