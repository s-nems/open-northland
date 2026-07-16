import { BerryBush, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { System } from '../context.js';

// Berry bushes — wild forageable food. A ripe bush is eaten off directly by any hungry settler (the `forage`
// drive, no job/tool), then regrows its one serving over time. See the {@link BerryBush} component for the
// source basis (the original's `landscapetypes.ini` bush cycle).

/**
 * Ticks a bare {@link BerryBush} takes to regrow its fruit — the delay between a bush being foraged and becoming
 * ripe (forageable) again. At {@link TICKS_PER_SECOND} = 12 this is 100 s of game time.
 *
 * Named approximation: the original regrows a bush over the `landscapetypes.ini` growth trigger (`transition 7
 * …`, `bush naked → flowering → with fruits`) whose real period is not decoded, so this single duration stands
 * in for the whole two-step flowering cycle. Tunable balance, not a source-pinned value — long enough that a
 * bush is a limited wild resource, short enough that a foraged patch recovers within a settler's hunger cadence
 * (~150 s to the eat threshold).
 */
export const BERRY_REGROW_TICKS = 1200;

/**
 * The largest Manhattan node-distance a hungry settler will look for a ripe {@link BerryBush} to forage (the
 * wild-food fallback's search radius). Deliberately large — ~64 half-cell nodes ≈ 32 tiles — so a settler with
 * no nearby larder still reaches a berry patch, but bounded so a lone bush across the map doesn't drag a
 * starving settler on a suicidal march.
 *
 * Named approximation / known limitation: a flat radius is the interim rule until the planned signpost system
 * routes settlers to distant food; the original's actual food-search extent is not decoded. Store food is
 * sought unbounded (the eat drive's primary path); only the wild-bush fallback is capped here. Larger than
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
    ripe: true,
    ripeAtTick: 0,
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  return e;
}

/**
 * BerryGrowthSystem — regrow bare {@link BerryBush}es. Each tick, a bush past its `ripeAtTick` flips back to
 * ripe (forageable) and clears the schedule. The timing is the exact integer compare `tick >= ripeAtTick` (like
 * {@link CurrentAtomic}'s `elapsed >= duration`), not an accumulated fixed-point step — and because the schedule
 * is an absolute tick set once at forage time, a regrowing bush's component does not churn every tick: it
 * changes only twice per cycle (foraged, regrown), so the snapshot scenery cache re-clones a bush only at those
 * two moments. A ripe bush is skipped. The flip is `World.touch`ed so the snapshot cache re-reads it.
 */
export const berryGrowthSystem: System = (world, ctx) => {
  for (const e of world.query(BerryBush)) {
    const bush = world.get(e, BerryBush);
    if (bush.ripe) continue; // already fruited — nothing to regrow
    if (ctx.tick < bush.ripeAtTick) continue; // still regrowing
    bush.ripe = true;
    bush.ripeAtTick = 0; // freeze the schedule (display-stable; unused while ripe)
    world.touch(e); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
  }
};
