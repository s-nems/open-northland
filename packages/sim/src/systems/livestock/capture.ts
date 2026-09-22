import {
  diplomacyStance,
  FarmAnimal,
  HerdMember,
  Livestock,
  Owner,
  ownerOf,
  Person,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { System } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { isScoutJob } from '../readviews/index.js';
import { entityNode } from '../spatial/nodes.js';

/** How close a scout claims from, in hex map points: the original runs the claim over the centre and the
 *  two rings around the scout's new position. */
export const LIVESTOCK_CAPTURE_RANGE = 2;

/**
 * Whether `player` may claim `animal`: a `catchable` creature that is wild, or held by a player this one
 * counts an enemy (`DIPLOMACY_STATE_ENEMY`, the state the original's per-point claim tests).
 * Its own stock is never a candidate.
 */
export function claimableBy(world: World, animal: Entity, player: number): boolean {
  if (!world.has(animal, Livestock)) return false;
  const owner = ownerOf(world, animal);
  if (owner === undefined) return true; // wild
  return owner !== player && diplomacyStance(world, player, owner) === 'enemy';
}

/**
 * A player's scout claims livestock it passes: every {@link claimableBy} creature within
 * {@link LIVESTOCK_CAPTURE_RANGE} of an owned scout becomes that player's, leaving its wild herd or the
 * enemy farm that held it.
 *
 * Approximation: the original runs the claim on each new map position the scout reaches, this on every
 * tick, so an animal that wanders up to a standing scout is claimed too.
 *
 * Determinism: scouts claim in ascending id order, so two scouts reaching one animal in the same tick
 * leave the higher-id claim standing, and two enemy scouts in range trade it each tick. No-ops in a
 * mapless sim.
 */
export const livestockCaptureSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  const terrain = ctx.terrain;
  // The candidate store first, so a map with no livestock never walks the settler population. No
  // canonical sort: every in-range animal is claimed, so order cannot change the result.
  const herds = [...world.query(Livestock, Position)];
  if (herds.length === 0) return;
  const scouts: Entity[] = [];
  for (const e of world.query(Person, Owner, Position)) {
    if (isScoutJob(ctx.content, world.get(e, Settler).jobType)) scouts.push(e);
  }
  if (scouts.length === 0) return;
  scouts.sort((a, b) => a - b);
  for (const scout of scouts) {
    const player = world.get(scout, Owner).player;
    const at = terrain.coordsOf(entityNode(world, terrain, scout));
    for (const animal of herds) {
      if (!claimableBy(world, animal, player)) continue;
      const on = terrain.coordsOf(entityNode(world, terrain, animal));
      if (hexDistanceBetween(at.x, at.y, on.x, on.y) > LIVESTOCK_CAPTURE_RANGE) continue;
      claim(world, animal, player);
    }
  }
};

/** Stamp the claim and cut whatever held the animal before it: a wild herd, or an enemy farm mid-summon. */
function claim(world: World, animal: Entity, player: number): void {
  // Only an animal still in a wild herd can have followers, so a re-claim skips the successor scan.
  const wasHerded = world.has(animal, HerdMember);
  world.add(animal, Owner, { player });
  world.remove(animal, HerdMember);
  if (world.has(animal, FarmAnimal)) {
    // A steal off an enemy farm abandons its herd and any walk to that farm's door with it.
    const summoned = world.get(animal, FarmAnimal).summoner !== null;
    world.remove(animal, FarmAnimal);
    if (summoned) clearNavState(world, animal);
  }
  if (wasHerded) promoteWildLeader(world, animal);
}

/** Re-point a claimed leader's wild followers onto their lowest-id remaining member, which then leads
 *  itself, so the wild herd does not follow the claimed animal to the farm. */
function promoteWildLeader(world: World, claimed: Entity): void {
  let successor: Entity | null = null;
  for (const f of world.query(HerdMember)) {
    if (world.get(f, HerdMember).leader !== claimed) continue;
    if (successor === null || f < successor) successor = f;
  }
  if (successor === null) return;
  const leader = successor;
  for (const f of world.query(HerdMember)) {
    if (world.get(f, HerdMember).leader !== claimed) continue;
    world.mut(f, HerdMember).leader = leader;
  }
}
