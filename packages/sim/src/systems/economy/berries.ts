import { BerryBush, Building, Position } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { bushesNearNode } from '../berry-index.js';
import type { System, SystemContext } from '../context.js';
import { reservedZoneOf } from '../footprint/geometry.js';
import { entityNode } from '../spatial.js';

// Berry bushes — wild forageable food. A ripe bush is eaten off directly by any hungry settler (the `forage`
// drive, no job/tool), then regrows its one serving over time. See the {@link BerryBush} component for the
// source basis (the original's `landscapetypes.ini` bush cycle).

/**
 * Ticks a bare {@link BerryBush} takes to regrow its fruit — the delay between a bush being foraged and becoming
 * ripe (forageable) again. At {@link TICKS_PER_SECOND} = 12 this is 100 s of game time.
 *
 * Named approximation: the original regrows a bush over the `landscapetypes.ini` growth trigger (`transition 7
 * …`, `bush naked → flowering → with fruits`) whose real period is not decoded, so this whole-cycle duration
 * stands in for the two-step flowering cycle. Tunable balance, not a source-pinned value — long enough that a
 * bush is a limited wild resource, short enough that a foraged patch recovers within a settler's hunger cadence
 * (~150 s to the eat threshold).
 */
export const BERRY_REGROW_TICKS = 1200;

/**
 * Ticks per growth step — half {@link BERRY_REGROW_TICKS}, since the source cycle takes two equal growth
 * triggers (`bush naked → flowering`, then `flowering → with fruits`). A foraged bush blooms `flowering` one
 * step after being eaten and ripens one step after that, so the bloom lands at exactly the regrow midpoint.
 */
export const BERRY_STAGE_TICKS = BERRY_REGROW_TICKS / 2;

/**
 * The largest Manhattan node-distance a hungry settler will look for a ripe {@link BerryBush} to forage (the
 * wild-food fallback's search radius). Deliberately large — ~64 half-cell nodes ≈ 32 tiles — so a settler with
 * no nearby larder still reaches a berry patch, but bounded so a lone bush across the map doesn't drag a
 * starving settler on a suicidal march.
 *
 * Named approximation: the original's actual food-search extent is not decoded — this flat radius caps only
 * the wild-bush fallback (store food rides the eat drive's primary path). With signpost navigation on, the
 * settler's `NavigationLimit` additionally gates both paths to its allowed area. Larger than
 * {@link DEFAULT_WORK_FLAG_RADIUS} (24) because foraging ranges wider than a bound gatherer's yard.
 */
export const BERRY_FORAGE_RADIUS = 64;

/**
 * The resolved shape of a berry bush to place: its half-cell node (like every sim command/spawn) and an
 * optional render-variant `gfxIndex` (the decoded map's fruited-bush `[GfxLandscape]` index). Consumed by
 * {@link createBerryBush}.
 */
export interface BerryBushSpec {
  /** The bush's half-cell lattice coords (like {@link ResourceNodeSpec} — a `positionOfNode` → Position). */
  readonly x: number;
  readonly y: number;
  /** Opaque render-variant tag (the fruited-bush landscapeGfx index); omitted for a scene/synthetic spawn. */
  readonly gfxIndex?: number;
}

/**
 * Assemble a wild berry bush from a {@link BerryBushSpec}: a {@link Position} + a ripe {@link BerryBush}
 * (bushes spawn holding fruit). The bush twin of {@link createResourceNode} — the map-spawn and scene-setup
 * helpers build directly here as pre-tick-0 authored state, so a map bush and a scene bush are the same entity.
 * Unlike a Resource node a bush carries no footprint (bushes are walkable in the original —
 * `landscapetypes.ini` `allowedonland 1`, no block areas), so a settler stands on the tile to forage it.
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
 * BerryGrowthSystem — advance regrowing {@link BerryBush}es one stage at a time. Each tick, a bush past its
 * `nextStageAtTick` steps `bare → flowering` (rescheduling one more {@link BERRY_STAGE_TICKS} out) or
 * `flowering → ripe` (clearing the schedule). The timing is the exact integer compare `tick >= nextStageAtTick`
 * (like {@link CurrentAtomic}'s `elapsed >= duration`), not an accumulated fixed-point step; the next stage is
 * anchored on the scheduled tick (`+= BERRY_STAGE_TICKS`), not the current one, so a bloom always lands at the
 * forage-anchored midpoint. Because the schedule is an absolute tick, a regrowing bush's component does not
 * churn every tick: it changes only at its stage transitions (foraged, bloomed, ripened), so the snapshot
 * scenery cache re-clones a bush only at those moments. A ripe bush is skipped. Each step is `World.touch`ed so
 * the snapshot cache re-reads it.
 */
export const berryGrowthSystem: System = (world, ctx) => {
  for (const e of world.query(BerryBush)) {
    const bush = world.get(e, BerryBush);
    if (bush.stage === 'ripe') continue; // already fruited — nothing to regrow
    if (ctx.tick < bush.nextStageAtTick) continue; // still growing toward the next stage
    if (bush.stage === 'bare') {
      bush.stage = 'flowering';
      bush.nextStageAtTick += BERRY_STAGE_TICKS; // one more step to fruit, anchored on schedule
    } else {
      bush.stage = 'ripe';
      bush.nextStageAtTick = 0; // freeze the schedule (display-stable; unused while ripe)
    }
    world.touch(e); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
  }
};

/**
 * Clear every wild {@link BerryBush} standing inside `building`'s reserved build-exclusion zone — called at
 * placement so a new building razes the bushes it lands on (source basis: observed original behavior — a
 * placed building clears the landscape decoration in its reserved footprint; the reserved zone stands in for
 * the exact clear radius, the same `LogicBuildBlockArea` extent the placement gate keeps clear of other
 * construction). Bushes are walkable and are not a placement obstacle, so unlike a resource node one can sit
 * under a building; without this it would be drawn straight through the walls.
 *
 * Golden-rule-6 bounded: the reserved zone is a handful of cells, so the scan reads only the bushes within its
 * Chebyshev reach ({@link bushesNearNode}, the region index) and keeps those whose node lies in the zone,
 * never every bush on the map. Collect-then-destroy — `world.destroy` mutates the store `bushesNearNode`
 * derives from — and the order is irrelevant (every matched bush is removed). A mapless sim (no terrain) or a
 * footprint-less type clears nothing.
 */
export function destroyBerryBushesInReserved(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no bushes to place under a building
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const anchor = nodeOfPosition(p.x, p.y);
  const rz = reservedZoneOf(ctx.content, terrain, b.buildingType, anchor.hx, anchor.hy);
  if (rz === undefined) return;
  const doomed = bushesNearNode(world, anchor.hx, anchor.hy, rz.reach).filter((e) =>
    rz.zone.has(entityNode(world, terrain, e)),
  );
  for (const e of doomed) {
    // Announce the razing before the destroy (read the position first — it is gone afterwards) so render can
    // drop the bush's retained static-decor quad; a virgin map bush is drawn by the static layer, not the
    // pool, so its destruction leaves no snapshot entity for the pool cull to reap ({@link SimEvent} berryBushRazed).
    const bp = world.tryGet(e, Position);
    if (bp !== undefined) ctx.events.emit({ kind: 'berryBushRazed', bush: e, at: eventAt(bp.x, bp.y) });
    world.destroy(e);
  }
}
