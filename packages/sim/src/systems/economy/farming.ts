import type { GoodFarming } from '@vinland/data';
import { Building, Crop, Position, Resource, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';

// FIELD FARMING — the content resolution, growth system and atomic-effect appliers behind the farm's
// sow→water→grow→reap loop. The planner half (which field a farmer works next) is the planFarmer drive
// (`../agents/farming`); this module owns the field's own lifecycle. Source basis: the loop's
// vocabulary is readable original data (`goodtypes.ini` wheat atomics 34/35/29 + `isProducedOnMapFlag`,
// `landscapetypes.ini` wheat lanes 27/28/29 with `maximumValency 5`); its timings/areas are the content
// `farming` block's OBSERVED calibration constants (no readable growth timing or field radius exists).

// WATERING IS THE GROWTH FUEL: a field grows only while `watered`, and EVERY STAGE STEP consumes its
// watering — the field turns thirsty again and stands until a farmer comes back with the can. So a
// field needs one sowing plus one watering PER STAGE to ripen, and the farm's throughput is literally
// its farmers' labor (a lone farmer cycles fewer fields per hour than a full crew — the
// user-requested "praca spięta z wydajnością produkcji", no idle-while-it-grows dead time). A named,
// user-directed approximation: the cultivate atomic exists in the readable data (id 35, the
// watering-can animation) but its engine-side effect is not decoded. An untended field simply stands
// at its stage — it never ripens by itself, and it deadlocks nothing (the farm keeps working its
// other fields; any farmer can pick it back up later).

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
 *  (boolean, no pick), so plain query iteration is deterministic-safe. Deliberately does NOT re-check
 *  the walk-block overlay the planner filtered (a building raised during the sow-walk): rebuilding the
 *  overlay per swing would cost a full footprint scan, and a crop under a fresh wall is self-limiting —
 *  it stays reapable from a neighbouring node. */
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
  // Grain grows only on PLANTABLE ground (the original's `biocanplanton` class — grass, never sand);
  // the planner already filters, this is the completion-time re-check every goods effect carries.
  if (ctx.terrain !== undefined && !ctx.terrain.isPlantable(ctx.terrain.nodeAtClamped(effect.x, effect.y)))
    return;
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
 * Apply a completed `water` (cultivate) swing: mark the field `watered` — fueling ONE stage of growth
 * (each stage step consumes it; see the module note). A field already ripe, already watered, or gone
 * (reaped mid-swing) is a no-op — the water hit stubble.
 */
export function applyWater(world: World, crop: Entity): void {
  const c = world.tryGet(crop, Crop);
  if (c === undefined || c.watered || c.stage >= c.stages) return;
  c.watered = true;
  world.touch(crop); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
}

/**
 * CropGrowthSystem — advance every WATERED field's integer growth counter and step its stage; each
 * stage step CONSUMES the watering (the field turns thirsty and stands until a farmer re-waters it —
 * growth is farmer-fueled, see the module note above). At the final stage the field is RIPE: its
 * {@link Resource.remaining} becomes the sown `yieldUnits`, which is what makes it harvestable (the
 * reap swing drops exactly that as the ground sheaf). Cost is O(fields) per tick — active work, never
 * entities² (golden rule 7); a world with no fields does nothing.
 *
 * Determinism: per-field independent integer mutation (no cross-entity pick), so store-order iteration
 * is fine; the stage step is the exact integer compare `growth >= ticksPerStage` (never an accumulated
 * fixed-point fraction).
 */
export const cropGrowthSystem: System = (world) => {
  for (const e of world.query(Crop)) {
    const crop = world.get(e, Crop);
    if (crop.stage >= crop.stages) continue; // ripe — waiting for the scythe
    if (!crop.watered) continue; // thirsty — stands until a farmer comes with the can
    crop.growth += 1;
    // In-place write on a snapshot-cached scenery entity (a Crop carries Resource) — log it so the
    // snapshot's scenery-clone cache re-clones the field; a missed touch renders the crop frozen at
    // its first-seen stage forever (the invisible freshly-sown level). One touch covers every write
    // this tick, including the ripe Resource.remaining below. O(watered fields) — active work.
    world.touch(e);
    if (crop.growth < crop.ticksPerStage) continue;
    crop.growth -= crop.ticksPerStage;
    crop.stage += 1;
    crop.watered = false; // the stage consumed its watering — thirsty again (farmer-fueled growth)
    if (crop.stage >= crop.stages) {
      crop.growth = 0; // ripe — freeze the counter (display-stable)
      const res = world.tryGet(e, Resource);
      if (res !== undefined) res.remaining = crop.yieldUnits; // now worth its yield to the scythe
    }
  }
};
