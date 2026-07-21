import type { GoodFarming } from '@open-northland/data';
import { Building, Crop, Position, Resource, type ResourceFootprintData } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { coordHash } from '../../core/coord-hash.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import {
  buildingBlockedCells,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../footprint/index.js';
import { resourcesNearNode } from '../resource-index.js';
import { stockpilesAtNode } from '../stockpile-index.js';

// Field farming — the content resolution, growth system and atomic-effect appliers behind the farm's
// sow→water→grow→reap loop. The planner half (which field a farmer works next) is the planFarmer drive
// (`../agents/farming`); this module owns the field's own lifecycle. Source basis: the loop's vocabulary is
// readable original data (`goodtypes.ini` wheat atomics 34/35/29 + `isProducedOnMapFlag`, `landscapetypes.ini`
// wheat lanes 27/28/29 with `maximumValency 5`); its timings/areas are the content `farming` block's observed
// calibration constants (no readable growth timing or field radius exists).

// Watering is the growth fuel: a field grows only while `watered`, and every stage step consumes its watering —
// the field turns thirsty again and stands until a farmer comes back with the can. So a field needs one sowing
// plus one watering per stage to ripen, which makes the farm's throughput its farmers' labor rather than a
// wall-clock timer: the plot is a fixed size (`maxFields`), and a bigger crew pushes the same plot round faster.
// That is what the original measures out as — ~10 grain per farmer per 10 minutes, straight up to the farm's
// four slots, on a plot that stands at ~24 plants for every one of those crews. A named approximation: the
// cultivate atomic exists in the readable data (id 35, the watering-can animation) but its engine-side effect
// is not decoded. An untended field stands at its stage — it never ripens by itself and deadlocks nothing (the
// farm works its other fields; any farmer can pick it back up later).

/** Distinct growth paces a field can be sown into, spread evenly across the good's
 *  `growthSpreadPercent` band. Enough to keep a plot of a couple of dozen fields visibly out of step;
 *  finer bands buy nothing the player can see. */
const GROWTH_BANDS = 8;

/**
 * The per-stage growth time of a field sown at half-cell node `(x, y)`: the good's nominal
 * `ticksPerStage` shifted into one of {@link GROWTH_BANDS} paces spanning ±`growthSpreadPercent`. A pure
 * coordinate hash, never `world.rng` ({@link coordHash}), so a field's pace is byte-stable across runs
 * and replays. Clamped to at least one tick — a band must never make a field ripen instantly.
 *
 * This spread is what keeps the farm's output continuous. Without it every field of a burst-sown plot
 * crosses every stage on the same tick, so the farm swings between a full plot of green and one mass
 * harvest; the original visibly does neither (its plots stand at mixed heights and ripen a few at a
 * time). Its per-plant timing is not decoded, so the spread is a named approximation of that look.
 */
function stageTicksAt(farming: GoodFarming, x: number, y: number): number {
  const spread = farming.growthSpreadPercent;
  if (spread === 0) return farming.ticksPerStage;
  const band = coordHash(x, y) % GROWTH_BANDS;
  const steps = Math.max(1, GROWTH_BANDS - 1); // a single band is the nominal rate, not a divide by zero
  const percent = -spread + Math.floor((2 * spread * band) / steps); // -spread..+spread
  return Math.max(1, Math.floor((farming.ticksPerStage * (100 + percent)) / 100));
}

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
function farmingSpecFor(ctx: SystemContext, goodType: number): FarmingSpec | null {
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
 * The field-farmed good a workplace cultivates, or null when it farms none — the first of the building type's
 * `produces` goods that resolves a {@link FarmingSpec} (`produces` is a fixed content array, so the pick is
 * deterministic). The data-driven "is this building a farm" test the planner and the JobSystem's adopt pass key
 * on — a workplace that produces a farmable good runs the field loop, never a hardcoded building-type id.
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
 *  resource/field, or a stockpile (a building store, a loose heap, a dropped sheaf). Reads live state, not the
 *  planner's tick-start `sowScan`: this is the completion-time re-check, so it must see a field or heap that
 *  landed on the node *since* the planner chose it. A membership test (boolean, no pick), so the stockpile
 *  index's superset answer needs no canonical ordering. Covers standing entities only; the walls half of the
 *  same race is {@link applySow}'s separate block-set check. Both halves ride incrementally-maintained
 *  indexes, so the sow the swing just planted costs an O(1) index update, not a rebuild. */
function sowNodeOccupied(world: World, hx: number, hy: number): boolean {
  if (stockpilesAtNode(world, hx, hy).length > 0) return true;
  return resourcesNearNode(world, hx, hy, 0).length > 0; // reach 0 — exactly this node's anchors
}

/**
 * A sown field's collision footprint: it blocks NOTHING and is worked from the node it stands on. The
 * original's wheat landscape is walkable with no block areas (`landscapetypes.ini` wheat lanes,
 * `allowedonland 1`), so settlers walk over a plot and a settlement builds straight over its own farmland —
 * the plants under the new walls are cleared by {@link destroyFieldsUnderBuilding} instead of the field
 * refusing the site. Declared here rather than resolved from a landscape record because a field is SOWN by
 * the sim, not spawned from a map gfx index; an empty declaration is what makes it a non-obstacle, since an
 * absent footprint means "undeclared" and placement then assumes a body.
 */
export const FIELD_FOOTPRINT: ResourceFootprintData = Object.freeze({
  walk: [],
  build: [],
  work: [{ dx: 0, dy: 0 }],
});

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
  // Walled in since the planner chose it (a building placed during the sow-walk): a field there would be
  // unreachable from birth, so the swing plants nothing rather than leaving one for the placement pass to
  // clear. A membership test on the memoized block set, not a footprint rebuild.
  if (ctx.terrain !== undefined) {
    const node = ctx.terrain.nodeAtClamped(effect.x, effect.y);
    if (buildingBlockedCells(world, ctx, ctx.terrain).has(node)) return;
  }
  const e = world.create();
  world.add(e, Position, positionOfNode(effect.x, effect.y));
  world.add(e, Resource, { goodType: effect.goodType, remaining: 0, harvestAtomic: spec.harvestAtomic });
  stampResourceFootprintData(world, e, FIELD_FOOTPRINT);
  world.add(e, Crop, {
    goodType: effect.goodType,
    farm: effect.farm,
    stage: 1,
    stages: spec.farming.stages,
    growth: 0,
    ticksPerStage: stageTicksAt(spec.farming, effect.x, effect.y),
    watered: false,
    yieldUnits: spec.farming.yieldPerField,
  });
}

/**
 * Apply a completed `water` (cultivate) swing: mark the field `watered` — fueling one stage of growth (each
 * stage step consumes it; see the module note). A field already ripe, already watered, or gone (reaped
 * mid-swing) is a no-op.
 */
export function applyWater(world: World, crop: Entity): void {
  const c = world.tryGet(crop, Crop);
  if (c === undefined || c.watered || c.stage >= c.stages) return;
  c.watered = true;
  world.touch(crop); // in-place write on a snapshot-cached scenery entity — log it (World.touch doc)
}

/**
 * CropGrowthSystem — advance every watered field's integer growth counter and step its stage; each stage step
 * consumes the watering (the field turns thirsty and stands until a farmer re-waters it — see the module note).
 * At the final stage the field is ripe: its {@link Resource.remaining} becomes the sown `yieldUnits`, which is
 * what makes it harvestable (the reap swing drops exactly that as the ground sheaf). Cost is O(fields) per tick,
 * never entities² (golden rule 7); a world with no fields does nothing.
 *
 * Determinism: per-field independent integer mutation (no cross-entity pick), so store-order iteration is fine;
 * the stage step is the exact integer compare `growth >= ticksPerStage` (never an accumulated fixed-point
 * fraction).
 */
/**
 * Destroy every field standing under `building`'s walls — the way raising a house over a plot takes the
 * plants with it. Called wherever a walk-block appears over ground a field already holds: placement and the
 * tier upgrade that grows a footprint (the placement twin of the bush/stump razing beside it).
 *
 * A field is worked from the node it stands on ({@link FIELD_FOOTPRINT}), so a wall over that node puts it
 * permanently out of reach — `findPath` rejects a blocked goal — and left standing it would hold one of the
 * farm's `maxFields` slots forever. A field never refuses a site (it declares no build area), so this runs
 * on every path that raises walls: an ordinary placement, a `force` placement (scenes, map imports), and a
 * tier upgrade, which never re-validates its grown footprint.
 *
 * Only cells the building actually makes UNWALKABLE clear a field — its door stays passable, and a field
 * merely inside the reserved margin is still walkable, reachable and worth reaping. That is the one
 * difference from the decor razing passes, which clear the whole reserved zone.
 *
 * Bounded by the footprint (golden rule 6): one reach-0 index probe per blocked cell, never a field scan.
 */
export function destroyFieldsUnderBuilding(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless fixture — nothing can be raised over a field
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const footprint = buildingFootprintOf(ctx.content, b.buildingType);
  if (footprint === undefined || footprint.blocked.length === 0) return; // blocks nothing — nothing to clear
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  // Membership in the world's derived block set, not the raw footprint cells: it carves the door back out,
  // so a field on the passable gate cell survives.
  const blocked = buildingBlockedCells(world, ctx, terrain);
  for (const cell of translatedCells(terrain, footprint.blocked, hx, hy)) {
    if (!blocked.has(cell)) continue;
    const at = terrain.coordsOf(cell);
    for (const e of resourcesNearNode(world, at.x, at.y, 0)) {
      if (!world.has(e, Crop)) continue;
      unstampResourceFootprint(world, e); // through the incremental cache, never a full overlay rebuild
      world.destroy(e);
    }
  }
}

export const cropGrowthSystem: System = (world) => {
  for (const e of world.query(Crop)) {
    const crop = world.get(e, Crop);
    if (crop.stage >= crop.stages) continue; // ripe — waiting for the scythe
    if (!crop.watered) continue; // thirsty — stands until a farmer comes with the can
    crop.growth += 1;
    // In-place write on a snapshot-cached scenery entity (a Crop carries Resource) — log it so the snapshot's
    // scenery-clone cache re-clones the field; a missed touch freezes the crop at its first-seen stage forever.
    // One touch covers every write this tick, including the ripe Resource.remaining below.
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
