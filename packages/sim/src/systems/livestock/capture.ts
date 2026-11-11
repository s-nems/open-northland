import {
  DraughtAnimal,
  FarmAnimal,
  fightsPlayer,
  HerdMember,
  Livestock,
  LivestockSweep,
  Owner,
  ownerOf,
  Position,
  WildHabitat,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { noteOffence } from '../conflict/offenders.js';
import type { System, SystemContext } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { entityNode } from '../spatial/nodes.js';
import { recountHerdRows } from './herd.js';
import { livestockWithin } from './herd-nodes.js';
import { scatterFrom } from './scatter.js';
import { claimingScouts } from './scouts.js';

/** How close a scout claims from, in hex map points: the original runs the claim over the centre and the
 *  two rings around the scout's new position. */
export const LIVESTOCK_CAPTURE_RANGE = 2;

/**
 * Whether `player` may claim `animal`: a `catchable` creature that is wild, or held by a player this one
 * counts an enemy (`DIPLOMACY_STATE_ENEMY`, the state the original's per-point claim tests) and no lobby
 * peace binds it to.
 * Its own stock is never a candidate.
 */
export function claimableBy(world: World, animal: Entity, player: number): boolean {
  if (!world.has(animal, Livestock)) return false;
  const owner = ownerOf(world, animal);
  if (owner === undefined) return true; // wild
  return owner !== player && fightsPlayer(world, player, owner);
}

/**
 * A player's scout claims livestock it passes: each time an owned scout stands on a map point it has not
 * claimed from, every {@link claimableBy} creature within {@link LIVESTOCK_CAPTURE_RANGE} becomes that
 * player's, leaving its wild herd or the enemy farm that held it. As in the original, a scout that stands
 * still claims nothing more, so an animal that wanders up to it stays free and two enemy scouts beside
 * one animal do not trade it back and forth. A scout seen for the first time claims where it stands.
 * On the same steps the enemy stock it did not take scatters from it ({@link scatterFrom}).
 *
 * Determinism: scouts claim in ascending id order, so two scouts reaching one animal in the same tick
 * leave the higher-id claim standing. No-ops in a mapless sim.
 */
export const livestockCaptureSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  const terrain = ctx.terrain;
  // The candidate store first, so a map with no livestock never syncs the scout index.
  if (world.query(Livestock, Position).next().done === true) return;
  const scouts = claimingScouts(world, ctx.content);
  const found: Entity[] = [];
  for (const scout of scouts) {
    const at = entityNode(world, terrain, scout);
    if (!steppedOnto(world, scout, at)) continue;
    const player = world.get(scout, Owner).player;
    found.length = 0;
    livestockWithin(world, terrain, at, LIVESTOCK_CAPTURE_RANGE, found);
    claimInQueryOrder(
      world,
      ctx,
      found.filter((animal) => claimableBy(world, animal, player)),
      scout,
      player,
    );
    scatterFrom(world, ctx, terrain, at, player);
  }
};

/** Records `at` as the point `scout` claims from, returning whether it differs from the last one. */
function steppedOnto(world: World, scout: Entity, at: NodeId): boolean {
  const swept = world.tryGet(scout, LivestockSweep);
  if (swept === undefined) world.add(scout, LivestockSweep, { node: at });
  else if (swept.node !== at) world.mut(scout, LivestockSweep).node = at;
  else return false;
  return true;
}

/** Claims `found` in the livestock store's query order, the order its stamps land in the Owner store. */
function claimInQueryOrder(
  world: World,
  ctx: SystemContext,
  found: readonly Entity[],
  scout: Entity,
  player: number,
): void {
  if (found.length === 0) return;
  const only = found[0];
  if (found.length === 1 && only !== undefined) {
    claim(world, ctx, only, scout, player);
    return;
  }
  const pending = new Set(found);
  for (const animal of world.query(Livestock, Position)) {
    if (!pending.has(animal)) continue;
    claim(world, ctx, animal, scout, player);
    if (pending.size === 1) return;
    pending.delete(animal);
  }
}

/** Stamp the claim and cut whatever held the animal before it: a wild herd, or an enemy farm mid-summon.
 *  Taking an owned animal is reported as a theft. */
function claim(world: World, ctx: SystemContext, animal: Entity, scout: Entity, player: number): void {
  const victim = ownerOf(world, animal);
  if (victim !== undefined) {
    const p = world.get(animal, Position);
    ctx.events.emit({
      kind: 'livestockStolen',
      animal,
      victim,
      thief: scout,
      thiefPlayer: player,
      at: eventAt(p.x, p.y),
    });
    noteOffence(world, ctx, scout, victim);
  }
  world.add(animal, Owner, { player });
  cutAnimalBindings(world, ctx, animal);
}

/** Cut whatever held an animal before it changed owner: its wild herd, a farm's herd, a cart's
 *  recruitment. Original behavior: every change of an animal's player drops its leader and its house. */
export function cutAnimalBindings(world: World, ctx: SystemContext, animal: Entity): void {
  // Its wild herd re-leads itself on the herding drive's next pass.
  world.remove(animal, HerdMember);
  world.remove(animal, WildHabitat);
  if (world.has(animal, FarmAnimal)) {
    // Leaving a farm abandons its herd and any walk to that farm's door with it.
    const { farm, summoner } = world.get(animal, FarmAnimal);
    world.remove(animal, FarmAnimal);
    if (summoner !== null) clearNavState(world, animal);
    recountHerdRows(world, ctx, farm);
  }
  if (world.has(animal, DraughtAnimal)) {
    // Mid-walk to a cart, it abandons the cart's recruitment and the walk to its door.
    world.remove(animal, DraughtAnimal);
    clearNavState(world, animal);
  }
}
