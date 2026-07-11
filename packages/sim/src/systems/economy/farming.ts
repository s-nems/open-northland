import type { GoodFarming } from '@vinland/data';
import { Building, Crop, Position, Resource, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';

// FIELD FARMING — the content resolution, growth system and atomic-effect appliers behind the farm's
// sow→water→grow→reap loop. The planner half (which field a farmer works next) is the planFarmer drive
// (../agents/drives-farming.ts); this module owns the field's own lifecycle. Source basis: the loop's
// vocabulary is readable original data (`goodtypes.ini` wheat atomics 34/35/29 + `isProducedOnMapFlag`,
// `landscapetypes.ini` wheat lanes 27/28/29 with `maximumValency 5`); its timings/areas are the content
// `farming` block's OBSERVED calibration constants (no readable growth timing or field radius exists).

/**
 * How much faster a WATERED field grows — its growth counter advances this many ticks per tick (an
 * unwatered field advances 1). A named approximation: the original's cultivate atomic exists in data
 * (id 35, the watering-can animation) but its effect on growth is engine-side and not decoded, so
 * watering-doubles-growth is our reading that makes the action matter without ever stalling a field
 * (an unwatered field still ripens, just slower — no deadlock when the farmer never gets to it).
 */
export const WATERED_GROWTH_PER_TICK = 2;

/** A field-farmed good's resolved loop parameters: its content `farming` block + the three atomic ids
 *  the loop's actions run (`atomicForPlanting`/`atomicForCultivating`/`atomicForHarvesting`). */
export interface FarmingSpec {
  readonly goodType: number;
  readonly farming: GoodFarming;
  readonly plantAtomic: number;
  readonly cultivateAtomic: number;
  readonly harvestAtomic: number;
}

/**
 * Resolve a good's {@link FarmingSpec}, or null when the good is not field-farmed — no `farming` block,
 * or any of the plant/cultivate/harvest atomics missing (the loop needs all three actions; wheat, the
 * one farmed good, carries them all in the readable data). A pure content read (memoized index).
 */
export function farmingSpecFor(ctx: SystemContext, goodType: number): FarmingSpec | null {
  const good = contentIndex(ctx.content).goods.get(goodType);
  if (good?.farming === undefined) return null;
  const { plant, cultivate, harvest } = good.atomics;
  if (plant === undefined || cultivate === undefined || harvest === undefined) return null;
  return {
    goodType,
    farming: good.farming,
    plantAtomic: plant,
    cultivateAtomic: cultivate,
    harvestAtomic: harvest,
  };
}

/**
 * The field-farmed good a workplace cultivates, or null when it farms none — the first of the building
 * type's `produces` goods that resolves a {@link FarmingSpec} (`produces` is a fixed content array, so
 * the pick is deterministic). This is the data-driven "is this building a FARM" test the planner and the
 * JobSystem's adopt pass key on — a workplace that produces a farmable good runs the field loop, never a
 * hardcoded building-type id.
 */
export function farmWorkGood(world: World, ctx: SystemContext, workplace: Entity): FarmingSpec | null {
  const b = world.tryGet(workplace, Building);
  if (b === undefined) return null;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  if (type === undefined) return null;
  for (const goodType of type.produces) {
    const spec = farmingSpecFor(ctx, goodType);
    if (spec !== null) return spec;
  }
  return null;
}

/** Whether any standing entity already occupies the half-cell node `(hx, hy)` for sowing purposes — a
 *  resource/field, or a stockpile (a building store, a loose heap, a dropped sheaf). A membership test
 *  (boolean, no pick), so plain query iteration is deterministic-safe. */
function sowNodeOccupied(world: World, hx: number, hy: number): boolean {
  for (const e of world.query(Resource, Position)) {
    const n = nodeOfPosition(world.get(e, Position).x, world.get(e, Position).y);
    if (n.hx === hx && n.hy === hy) return true;
  }
  for (const e of world.query(Stockpile, Position)) {
    const n = nodeOfPosition(world.get(e, Position).x, world.get(e, Position).y);
    if (n.hx === hx && n.hy === hy) return true;
  }
  return false;
}

/**
 * Apply a completed `sow` swing: plant a {@link Crop} field of `goodType` for `farm` at the half-cell
 * node `(x, y)`. The node may have been taken since the planner chose it (a competing farmer's field, a
 * fresh drop) — then the swing struck ploughed ground and plants nothing, the same raced-target no-op
 * stance every goods effect takes. The field starts at stage 1 with `Resource.remaining` 0 — a growing
 * field yields nothing until the CropGrowthSystem ripens it (that remaining-0 gate is what keeps the
 * generic harvest scans off an unripe field).
 */
export function applySow(
  world: World,
  ctx: SystemContext,
  effect: { farm: Entity; goodType: number; x: number; y: number },
): void {
  const spec = farmingSpecFor(ctx, effect.goodType);
  if (spec === null) return; // not a farmable good (content changed under the swing) — plant nothing
  if (sowNodeOccupied(world, effect.x, effect.y)) return; // node taken since the planner chose it
  const e = world.create();
  world.add(e, Position, positionOfNode(effect.x, effect.y));
  world.add(e, Resource, { goodType: effect.goodType, remaining: 0, harvestAtomic: spec.harvestAtomic });
  world.add(e, Crop, {
    goodType: effect.goodType,
    farm: effect.farm,
    stage: 1,
    stages: spec.farming.stages,
    growth: 0,
    ticksPerStage: spec.farming.ticksPerStage,
    watered: false,
    yieldUnits: spec.farming.yieldPerField,
  });
}

/**
 * Apply a completed `water` (cultivate) swing: mark the field `watered`, doubling its growth pace from
 * now on ({@link WATERED_GROWTH_PER_TICK}). A field already ripe, already watered, or gone (reaped mid-
 * swing) is a no-op — the water hit stubble.
 */
export function applyWater(world: World, crop: Entity): void {
  const c = world.tryGet(crop, Crop);
  if (c === undefined || c.watered || c.stage >= c.stages) return;
  c.watered = true;
}

/**
 * CropGrowthSystem — advance every growing field's integer growth counter and step its stage; at the
 * final stage the field is RIPE: its {@link Resource.remaining} becomes the sown `yieldUnits`, which is
 * what makes it harvestable (the reap swing drops exactly that as the ground sheaf). Cost is O(fields)
 * per tick — active work, never entities² (golden rule 7); a world with no fields does nothing.
 *
 * Determinism: per-field independent integer mutation (no cross-entity pick), so store-order iteration
 * is fine; the stage step is the exact integer compare `growth >= ticksPerStage` (never an accumulated
 * fixed-point fraction), carrying the watered overshoot remainder so pacing stays exact.
 */
export const cropGrowthSystem: System = (world) => {
  for (const e of world.query(Crop)) {
    const crop = world.get(e, Crop);
    if (crop.stage >= crop.stages) continue; // ripe — waiting for the scythe
    crop.growth += crop.watered ? WATERED_GROWTH_PER_TICK : 1;
    if (crop.growth < crop.ticksPerStage) continue;
    crop.growth -= crop.ticksPerStage;
    crop.stage += 1;
    if (crop.stage >= crop.stages) {
      crop.growth = 0; // ripe — freeze the counter (display-stable)
      const res = world.tryGet(e, Resource);
      if (res !== undefined) res.remaining = crop.yieldUnits; // now worth its yield to the scythe
    }
  }
};
