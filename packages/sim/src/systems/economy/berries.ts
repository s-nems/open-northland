import { BerryBush, LandscapeResource, Position } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { dueForGrowth, LANDSCAPE_GROWTH_PERIOD_TICKS } from '../landscape/growth-clock.js';
import { bushesNearNode } from '../spatial/bushes.js';
import { decorInReservedZone } from './reserved-decor.js';

/** Growth steps from a foraged bush back to fruit: `bush naked -> flowering -> with fruits`. */
const BERRY_GROWTH_STEPS = 2;

/** Ticks between two growth steps of a regrowing bush: one landscape growth period. */
export const BERRY_STAGE_TICKS = LANDSCAPE_GROWTH_PERIOD_TICKS;

/** The longest a foraged bush takes to fruit again; its first step comes at its section's next growth run. */
export const BERRY_REGROW_TICKS = BERRY_GROWTH_STEPS * BERRY_STAGE_TICKS;

/** The resolved shape of a berry bush to place: its half-cell node and an optional render variant. */
export interface BerryBushSpec {
  readonly landscapeId?: number;
  /** Half-cell lattice coords. */
  readonly x: number;
  readonly y: number;
  /** The fruited-bush `landscapeGfx` index; omitted for a synthetic spawn. */
  readonly gfxIndex?: number;
}

/**
 * Assemble a wild berry bush, ripe: bushes spawn holding fruit. Unlike a Resource node a bush carries no
 * footprint - bushes are walkable in the original (`landscapetypes.ini` `allowedonland 1`, no block areas) -
 * so a settler stands on the tile to forage it.
 */
export function createBerryBush(world: World, spec: BerryBushSpec): Entity {
  const e = world.create();
  if (spec.landscapeId !== undefined) world.add(e, LandscapeResource, { id: spec.landscapeId });
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, BerryBush, {
    stage: 'ripe',
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  return e;
}

/**
 * Grow every regrowing {@link BerryBush} in this run's map section one stage. Original behavior: the bush
 * types' `transition 7` on the landscape growth trigger, `bush naked -> flowering -> with fruits`.
 */
export const berryGrowthSystem: System = (world, ctx) => {
  for (const e of dueForGrowth(world, ctx, bushesNearNode)) {
    const stage = world.get(e, BerryBush).stage;
    if (stage === 'bare') world.mut(e, BerryBush).stage = 'flowering';
    else if (stage === 'flowering') world.mut(e, BerryBush).stage = 'ripe';
  }
};

/**
 * Clear every wild {@link BerryBush} standing inside `building`'s reserved build-exclusion zone. Observed:
 * a placed building clears the landscape decoration in its reserved footprint; the reserved zone stands in
 * for the exact clear radius, the same `LogicBuildBlockArea` extent the placement gate keeps clear. A
 * walkable bush is no placement obstacle, so without this one would be drawn straight through the walls.
 */
export function destroyBerryBushesInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const e of decorInReservedZone(world, ctx, building, bushesNearNode)) {
    // Emitted before the destroy so it can still read the Position: a map bush is drawn by the static decor
    // layer, not the sprite pool, so its destruction leaves no snapshot entity for the pool cull to reap.
    const bp = world.tryGet(e, Position);
    if (bp !== undefined) ctx.events.emit({ kind: 'berryBushRazed', bush: e, at: eventAt(bp.x, bp.y) });
    world.destroy(e);
  }
}
