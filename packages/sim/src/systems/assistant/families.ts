import {
  AssistantFoundsFamilies,
  Evicted,
  Female,
  Position,
  Residence,
  Rider,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler, isOnMission, mayMarry } from '../family/eligibility.js';
import { homeFamilyCapacity } from '../family/home-quality.js';
import { builtHomeType, familyCountOf, moveFamilyInto } from '../family/households.js';
import { routeRegions } from '../footprint/index.js';
import { assignHouse, weddingStarted } from '../orders/family.js';
import { mayTakeHome } from '../orders/guards.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { interactionCell } from '../settlers/targets/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { hexNodeDistance } from '../spatial/metric.js';

/** Partner searches per player per beat. Each reads every person on the map, so single women with no man
 *  in reach cost a bounded scan a beat. Authored. */
const PARTNER_SEARCHES_PER_DECISION = 2;

/** A standing home with room for another family. */
interface OpenHome {
  readonly house: Entity;
  free: number;
}

/**
 * The assistant's family founding, for every seat with the switch on: each homeless grown woman moves into
 * the nearest home with a free family slot she can walk to, and a woman who already has a home is wed
 * while the seat has a man free to marry, so no bride is homeless. Both go through the player's own
 * orders. A household that had to move out of a home ({@link Evicted}) goes back under a roof the same
 * way whoever it holds, a lone man or an orphan included. Source basis: authored, the switch is this
 * project's addition.
 */
export function foundFamilies(world: World, ctx: SystemContext, beat: number): void {
  const carriers = world.canonicalQuery(AssistantFoundsFamilies);
  const seen = new Set<number>();
  for (const carrier of carriers) {
    const { player } = world.get(carrier, AssistantFoundsFamilies);
    if (seen.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    seen.add(player);
    foundFamiliesOf(world, ctx, player, beat);
  }
}

function foundFamiliesOf(world: World, ctx: SystemContext, player: number, beat: number): void {
  const homeless: Entity[] = [];
  const brides: Entity[] = [];
  let groomFree = false;
  const people = ownedSettlers(world, player);
  for (let i = 0; i < people.length; i++) {
    const e = people[i] as Entity;
    // A member aboard a vehicle waits to step off; the first member ashore takes the whole family.
    if (world.has(e, Evicted) && !world.has(e, Rider)) homeless.push(e);
    if (!world.has(e, Female)) {
      groomFree ||= mayMarry(world, ctx.content, e);
      continue;
    }
    if (!isAdultSettler(world, e) || world.has(e, Rider)) continue;
    if (world.has(e, Residence)) {
      if (mayMarry(world, ctx.content, e) && !anotherSystemOwns(world, e)) brides.push(e);
    } else if (
      !world.has(e, Evicted) &&
      mayTakeHome(world, ctx.content, e) &&
      !isOnMission(ctx.content, world.get(e, Settler).jobType)
    ) {
      homeless.push(e);
    }
  }
  if (homeless.length > 0) houseHouseholds(world, ctx, player, homeless);
  if (!groomFree || brides.length === 0) return;
  // Beat-rotated start, so a woman no man can reach never holds the searches from the others.
  const searches = Math.min(PARTNER_SEARCHES_PER_DECISION, brides.length);
  for (let i = 0; i < searches; i++) {
    const bride = brides[(beat + i) % brides.length];
    if (bride !== undefined && mayMarry(world, ctx.content, bride)) weddingStarted(world, ctx, bride);
  }
}

/**
 * Move each of `homeless`, ascending id, with its family into its nearest open home; one with no home in
 * reach waits. A grown woman goes through the player's `assignHouse`; an evicted household moves back in
 * directly, as it moved out, since a child or a hero would fail the order's gates.
 */
function houseHouseholds(
  world: World,
  ctx: SystemContext,
  player: number,
  homeless: readonly Entity[],
): void {
  const homes: OpenHome[] = [];
  for (const house of ownedBuildings(world, player)) {
    const type = builtHomeType(world, ctx, house);
    if (type === undefined) continue;
    const free = homeFamilyCapacity(world, ctx, house, type) - familyCountOf(world, house);
    if (free > 0) homes.push({ house, free });
  }
  if (homes.length === 0) return;
  for (const e of homeless) {
    if (world.has(e, Residence)) continue; // moved in with an earlier member's family
    const home = nearestOpenHome(world, ctx, e, homes);
    if (home === null) continue;
    if (world.has(e, Evicted)) moveFamilyInto(world, ctx, e, home.house);
    else assignHouse(world, ctx, { kind: 'assignHouse', entity: e, house: home.house });
    if (world.tryGet(e, Residence)?.home === home.house) home.free -= 1;
  }
}

/** The open home nearest `e` that it can walk to, the first of `homes` at equal distance; on a mapless
 *  sim, which has no doors, the first open one. */
function nearestOpenHome(
  world: World,
  ctx: SystemContext,
  e: Entity,
  homes: readonly OpenHome[],
): OpenHome | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return homes.find((home) => home.free > 0) ?? null;
  const position = world.tryGet(e, Position);
  if (position === undefined) return null;
  const at = nodeOfPosition(position.x, position.y);
  const here = terrain.nodeAtClamped(at.hx, at.hy);
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  const regions = routeRegions(world, ctx, terrain);
  let best: OpenHome | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const home of homes) {
    if (home.free <= 0) continue;
    const door = interactionCell(world, ctx, terrain, home.house, here);
    if (limit !== null && !limit.allowsNode(door)) continue;
    if (terrain.componentOf(door) !== terrain.componentOf(here) || regions.unroutable(here, door)) continue;
    const distance = hexNodeDistance(terrain, here, door);
    if (distance < bestDistance) {
      best = home;
      bestDistance = distance;
    }
  }
  return best;
}
