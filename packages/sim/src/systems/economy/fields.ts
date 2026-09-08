import type { GoodFarming } from '@open-northland/data';
import { Building, Crop, Position, Resource } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexNeighboursOf, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import {
  buildingBlockedCells,
  dynamicBlockOverlay,
  stampResourceFootprintOrFallback,
  unstampResourceFootprint,
} from '../footprint/index.js';
import { resourcesAtNode } from '../spatial/resources.js';
import { stockpilesAtNode } from '../spatial/stockpiles.js';

// Source basis for the farm's sow, water and reap loop: its vocabulary is readable original data
// (`goodtypes.ini` wheat atomics 34/35/29 plus `isProducedOnMapFlag`, `landscapetypes.ini` wheat lanes
// 27/28/29 with `maximumValency 5`); its plot size and radius are the content `farming` block's calibration.

// Watering is the only growth: the cultivate clip fires the `GROW` cue (`atomicanimations.ini` `event 14 16`,
// `ATOMIC_ANIMATION_EVENT_TYPE_GROW` in `logicdefines.inc`) and `wheat (growing)` answers the transition of
// the same name with one valency step (`transition 7 27 2 +1 0`: `LANDSCAPE_TRANSITION_GROW`, modifier
// `DELTA`, +1) up to `maximumValency 5`. Approximation: no clock steps a field, which the data leaves
// open - a bush carries a `GROW` transition too and something other than a can fires it there.

/** A field-farmed good's resolved loop parameters: its content `farming` block plus the
 *  `atomicForPlanting` / `atomicForCultivating` / `atomicForHarvesting` ids. */
export interface FarmingSpec {
  readonly goodType: number;
  readonly farming: GoodFarming;
  readonly plantAtomic: number;
  readonly cultivateAtomic: number;
  readonly harvestAtomic: number;
}

/**
 * Resolve a good's {@link FarmingSpec}, or null when it is not field-farmed: no `farming` block, or any of
 * the three loop atomics missing.
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
 * The field-farmed good a workplace cultivates, or null when it farms none: the first of the building type's
 * `produces` goods that resolves a {@link FarmingSpec}, a fixed content array so the pick is deterministic.
 * The data-driven farm test, never a hardcoded building-type id.
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

/** Whether a resource, field or stockpile already occupies half-cell node `(hx, hy)` for sowing purposes.
 *  Both halves of the sow race share this rule, so it must read live state: a field or heap that landed on
 *  the node since the planner chose it still has to reject the swing. A membership test, so the node
 *  indexes' superset answers need no canonical ordering. */
export function sowNodeOccupied(world: World, hx: number, hy: number): boolean {
  return stockpilesAtNode(world, hx, hy).length > 0 || resourcesAtNode(world, hx, hy).length > 0;
}

/**
 * Apply a completed `sow` swing: plant a {@link Crop} field of `goodType` for `farm` at half-cell node
 * `(x, y)`. A node taken since the planner chose it plants nothing, the same raced-target no-op stance
 * every goods effect takes.
 */
export function applySow(
  world: World,
  ctx: SystemContext,
  effect: { farm: Entity; goodType: number; x: number; y: number },
): void {
  const spec = farmingSpecFor(ctx, effect.goodType);
  if (spec === null) return; // content changed under the swing
  // Grain grows only on plantable ground (the original's `biocanplanton` class - grass, never sand); the
  // planner already filters, this is the completion-time re-check every goods effect carries.
  if (ctx.terrain !== undefined && !ctx.terrain.isPlantable(ctx.terrain.nodeAtClamped(effect.x, effect.y)))
    return;
  if (sowNodeOccupied(world, effect.x, effect.y)) return;
  // Blocked since the planner chose it: a field there would be unreachable from birth. Tests the same
  // memoized overlay `nextSowNode` filtered on, since a narrower one would admit a node it had rejected.
  if (ctx.terrain !== undefined) {
    const node = ctx.terrain.nodeAtClamped(effect.x, effect.y);
    if (dynamicBlockOverlay(world, ctx, ctx.terrain).has(node)) return;
  }
  const e = world.create();
  world.add(e, Position, positionOfNode(effect.x, effect.y));
  world.add(e, Resource, { goodType: effect.goodType, remaining: 0, harvestAtomic: spec.harvestAtomic });
  // Landscape-derived on real content, anchor-only on fixture content whose farmed good ships no record.
  stampResourceFootprintOrFallback(world, ctx.content, e, effect.goodType);
  world.add(e, Crop, {
    goodType: effect.goodType,
    farm: effect.farm,
    stage: 1,
    stages: spec.farming.stages,
    yieldUnits: spec.farming.yieldPerField,
  });
}

/**
 * Apply a completed `water` (cultivate) swing at `crop`: one growth step for that field and for every field
 * on its six lattice neighbours. Approximation: the cue's reach is not readable; the ring is the lattice's
 * six nearest nodes under its odd-row stagger. A target reaped or razed since the planner chose it waters
 * nothing.
 */
export function applyWater(world: World, crop: Entity): void {
  const p = world.tryGet(crop, Position);
  if (p === undefined || !world.has(crop, Crop)) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  growFieldsAt(world, hx, hy);
  for (const n of hexNeighboursOf(hx, hy)) growFieldsAt(world, n.hx, n.hy);
}

/** Step every field standing on node `(hx, hy)` one stage; a ripe one stands as it is. */
function growFieldsAt(world: World, hx: number, hy: number): void {
  for (const e of resourcesAtNode(world, hx, hy)) {
    const crop = world.tryGet(e, Crop);
    if (crop === undefined || crop.stage >= crop.stages) continue;
    const grown = world.mut(e, Crop);
    grown.stage += 1;
    if (grown.stage >= grown.stages) world.mut(e, Resource).remaining = grown.yieldUnits;
  }
}

/**
 * Destroy every field standing under `building`'s walls. A field is worked from the node it stands on, so a
 * wall over that node puts it permanently out of reach and it would hold one of the farm's `maxFields`
 * slots forever. Only cells the building actually makes unwalkable clear a field, unlike the decor razing
 * passes which clear the whole reserved zone. Bounded by the footprint: one node probe per blocked cell.
 */
export function destroyFieldsUnderBuilding(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const footprint = buildingFootprintOf(ctx.content, b.buildingType);
  if (footprint === undefined || footprint.blocked.length === 0) return;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  // The world's derived block set, not the raw footprint cells: it carves the door back out, so a field on
  // the passable gate cell survives.
  const blocked = buildingBlockedCells(world, ctx, terrain);
  for (const cell of translatedCells(terrain, footprint.blocked, hx, hy)) {
    if (!blocked.has(cell)) continue;
    const at = terrain.coordsOf(cell);
    // Copied first: the probe hands back the index's live node bucket, which the destroys below splice.
    for (const e of [...resourcesAtNode(world, at.x, at.y)]) {
      if (!world.has(e, Crop)) continue;
      unstampResourceFootprint(world, e);
      world.destroy(e);
    }
  }
}
