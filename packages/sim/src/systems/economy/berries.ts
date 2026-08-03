import { BerryBush, Position } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { bushesNearNode } from '../spatial/bushes.js';
import { decorInReservedZone } from './reserved-decor.js';

// Berry bushes - wild forageable food. A ripe bush is eaten off directly by any hungry settler (the `forage`
// drive, no job/tool), then regrows its one serving over time. See the {@link BerryBush} component for the
// source basis (the original's `landscapetypes.ini` bush cycle).

/**
 * Ticks a bare {@link BerryBush} takes to regrow its fruit. At {@link TICKS_PER_SECOND} = 12 this is 100 s
 * of game time.
 *
 * Approximation: the original regrows a bush over the `landscapetypes.ini` growth trigger (`transition 7 …`,
 * `bush naked -> flowering -> with fruits`) whose real period is not decoded, so this whole-cycle duration
 * stands in for the two-step flowering cycle. Balance value: long enough that a bush is a limited wild
 * resource, short enough that a foraged patch recovers within a settler's hunger cadence.
 */
export const BERRY_REGROW_TICKS = 1200;

/**
 * Ticks per growth step - half {@link BERRY_REGROW_TICKS}, since the source cycle takes two equal growth
 * triggers (`bush naked → flowering`, then `flowering → with fruits`). A foraged bush blooms `flowering` one
 * step after being eaten and ripens one step after that, so the bloom lands at exactly the regrow midpoint.
 */
export const BERRY_STAGE_TICKS = BERRY_REGROW_TICKS / 2;

/**
 * The largest Manhattan node-distance a hungry settler will look for a ripe {@link BerryBush} to forage:
 * 64 half-cell nodes, about 32 tiles, so a settler with no nearby larder still reaches a berry patch but a
 * lone bush across the map cannot drag a starving one on a suicidal march.
 *
 * Approximation: the original's food-search extent is not decoded. This flat radius caps only the wild-bush
 * fallback, and with signpost navigation on the settler's `NavigationLimit` gates both paths further.
 */
export const BERRY_FORAGE_RADIUS = 64;

/** The resolved shape of a berry bush to place: its half-cell node and an optional render variant. */
export interface BerryBushSpec {
  /** Half-cell lattice coords, converted to a Position by `positionOfNode`. */
  readonly x: number;
  readonly y: number;
  /** Opaque render-variant tag (the fruited-bush landscapeGfx index); omitted for a synthetic spawn. */
  readonly gfxIndex?: number;
}

/**
 * Assemble a wild berry bush, ripe: bushes spawn holding fruit. Unlike a Resource node a bush carries no
 * footprint - bushes are walkable in the original (`landscapetypes.ini` `allowedonland 1`, no block areas) -
 * so a settler stands on the tile to forage it.
 */
export function createBerryBush(world: World, spec: BerryBushSpec): Entity {
  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, BerryBush, {
    stage: 'ripe',
    nextStageAtTick: 0,
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  return e;
}

/**
 * Advance regrowing {@link BerryBush}es one stage at a time. Timing is the exact integer compare
 * `tick >= nextStageAtTick` rather than an accumulated fixed-point step, and the next stage is anchored on
 * the scheduled tick rather than the current one, so a bloom always lands at the forage-anchored midpoint.
 * An absolute schedule also means a regrowing bush's component changes only at its transitions, so the
 * snapshot scenery cache re-clones a bush only then.
 */
export const berryGrowthSystem: System = (world, ctx) => {
  for (const e of world.query(BerryBush)) {
    const bush = world.get(e, BerryBush);
    if (bush.stage === 'ripe') continue;
    if (ctx.tick < bush.nextStageAtTick) continue;
    world.write(e, BerryBush, (b) => {
      if (b.stage === 'bare') {
        b.stage = 'flowering';
        b.nextStageAtTick += BERRY_STAGE_TICKS; // one more step to fruit, anchored on schedule
      } else {
        b.stage = 'ripe';
        b.nextStageAtTick = 0; // unused while ripe
      }
    });
  }
};

/**
 * Clear every wild {@link BerryBush} standing inside `building`'s reserved build-exclusion zone. Observed:
 * a placed building clears the landscape decoration in its reserved footprint; the reserved zone stands in
 * for the exact clear radius, the same `LogicBuildBlockArea` extent the placement gate keeps clear. Bushes
 * are walkable and no placement obstacle, so without this one would be drawn straight through the walls.
 */
export function destroyBerryBushesInReserved(world: World, ctx: SystemContext, building: Entity): void {
  for (const e of decorInReservedZone(world, ctx, building, bushesNearNode)) {
    // Announce the razing before the destroy, reading the position while it still exists, so render can drop
    // the bush's retained static-decor quad: a map bush is drawn by the static layer, not the pool, so its
    // destruction leaves no snapshot entity for the pool cull to reap.
    const bp = world.tryGet(e, Position);
    if (bp !== undefined) ctx.events.emit({ kind: 'berryBushRazed', bush: e, at: eventAt(bp.x, bp.y) });
    world.destroy(e);
  }
}
