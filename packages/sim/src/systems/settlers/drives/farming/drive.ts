import {
  Building,
  CARRY_CAPACITY,
  Crop,
  FarmTask,
  JobAssignment,
  Position,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { type FarmingSpec, farmWorkGood } from '../../../economy/fields.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import {
  buildingEnabled,
  scaledWorkRepeats,
  workRepeatsFor,
  workSpeedBonus,
} from '../../../progression/index.js';
import { atomicDuration } from '../../../readviews/animations.js';
import { closer, manhattan } from '../../../spatial/nodes.js';
import { buildingWorkerJobs } from '../../../stores/index.js';
import { atOrWalk, startAtomic, startPickup } from '../../atomics/start.js';
import { enterBuilding } from '../../indoors.js';
import type { PlannerContext } from '../../planner/context.js';
import { interactionCell, jobAtomics, unreachableWorkCell, type WorkCellGates } from '../../targets/index.js';
import { unreachableGoals } from '../../unreachable-goals.js';

// The field lifecycle itself (growth, the sow/water/reap effects) lives in ../../../economy/fields.ts; this
// module decides what a farmer does next. The actions and their animations are the original's own farmer
// atomics; approximation: their ordering is engine-side and not decoded.

import type { FarmClaims } from './claims.js';
import { nearestFarmSheaf, nextSowNode } from './targets.js';

/**
 * The farm a bound settler should work as a field-farmer, with the farmed good's resolved spec, or null when
 * the settler is not the field trade here. The plant atomic is the gate: a farm's carrier slot shares the
 * building but may not sow, so it falls through to the porter rung.
 */
function boundFarmTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): { farm: Entity; spec: FarmingSpec } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const b = binding.workplace;
  const building = world.tryGet(b, Building);
  if (building === undefined || building.tribe !== tribe) return null;
  // `jobtypes.ini` farmer `mustHaveFinishedWorkHouseFlag 1`: a farm still being raised fields no crew.
  if (world.has(b, UnderConstruction)) return null;
  const spec = farmWorkGood(world, ctx, b);
  if (spec === null) return null;
  if (!jobAtomics(ctx, jobType).has(spec.plantAtomic)) return null; // not the field trade (a carrier)
  if (!buildingWorkerJobs(world, ctx, b).has(jobType)) return null;
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null;
  if (!world.has(b, Position)) return null;
  return { farm: b, spec };
}

/**
 * The field-cultivation loop for a settler bound to a farm: reap, carry a sheaf home, sow, water, else wait
 * inside the farm. Returns false only for a settler that is not a field-farmer here.
 *
 * Approximation: the priority order has no decoded oracle. Sowing before watering is load-bearing, since
 * per-stage watering leaves something thirsty almost always and a water-first farmer would never expand the
 * plot. Reap and sheaf-carry pause while no store can take the crop; sowing and watering continue.
 */
export function planFarmer(plan: PlannerContext, claims: FarmClaims): boolean {
  const { world, ctx, terrain, entity: e, here, targets } = plan;
  const settler = plan;
  const bound = boundFarmTarget(world, ctx, e, settler.jobType, settler.tribe);
  if (bound === null) return false;
  const { farm, spec } = bound;
  const fp = world.get(farm, Position);
  const fn = nodeOfPosition(fp.x, fp.y);
  const anchor = terrain.nodeAtClamped(fn.hx, fn.hy);

  // Strokes per spot: the crop's `baserepeatcounter`, cut by experience on its track. Approximation: the
  // labor-gated farm loop, and with it the farm's output, approaches 2x at mastery.
  const strokes = scaledWorkRepeats(
    workRepeatsFor(ctx, settler.jobType, spec.goodType),
    workSpeedBonus(world, ctx, e, spec.goodType),
  );

  /** One field action: the atomic's animation length replayed `strokes` times. */
  const swingTicks = (atomic: number): number => atomicDuration(ctx.content, settler, atomic) * strokes;

  /** Claim `node` for this settler's next action, so colleagues planned later this tick skip it. */
  const take = (node: NodeId, sow: boolean): void => {
    claims.nodes.add(node);
    if (sow) claims.byFarm.set(farm, (claims.byFarm.get(farm) ?? 0) + 1);
    world.add(e, FarmTask, { farm, node, sow });
  };

  // The reachability layers every field and sheaf pick is filtered through. A field is worked from its own
  // node, so a walled-in one is a goal `findPath` always rejects and the nearest-first pick would re-choose
  // that same doomed field every replan.
  const gates: WorkCellGates = {
    terrain,
    blocked: dynamicBlockOverlay(world, ctx, terrain),
    memo: unreachableGoals(world, ctx, e),
  };

  // One pass over this farm's fields serves both the plot cap and the nearest unclaimed ripe and thirsty
  // pick, by (distance, cell) over the canonical list.
  let fields = 0;
  let ripe: Entity | null = null;
  let ripeCell = 0 as NodeId;
  let ripeDist = Number.POSITIVE_INFINITY;
  let thirsty: Entity | null = null;
  let thirstyCell = 0 as NodeId;
  let thirstyDist = Number.POSITIVE_INFINITY;
  for (const c of targets.cropsByFarm.get(farm) ?? []) {
    const crop = world.get(c, Crop);
    // Counted before the reachability gate: the plot cap is a fact about the farm, not about which farmer
    // is asking.
    fields++;
    const cell = interactionCell(world, ctx, terrain, c, here);
    if (claims.nodes.has(cell)) continue;
    if (unreachableWorkCell(gates, here, cell)) continue;
    const dist = manhattan(terrain, here, cell);
    if (crop.stage >= crop.stages) {
      if (closer(dist, cell, ripeDist, ripeCell)) {
        ripe = c;
        ripeDist = dist;
        ripeCell = cell;
      }
    } else if (!crop.watered) {
      if (closer(dist, cell, thirstyDist, thirstyCell)) {
        thirsty = c;
        thirstyDist = dist;
        thirstyCell = cell;
      }
    }
  }

  // Any store that could take the crop: the farm's own slot, or a warehouse the delivery rung overflows to.
  const cropSinkExists = (): boolean => targets.sinks.has(spec.goodType);

  // Reap the nearest ripe field; the yield drops as a sheaf where it stood.
  if (ripe !== null && cropSinkExists()) {
    const node = ripe;
    take(ripeCell, false);
    atOrWalk(world, e, here, ripeCell, () =>
      startAtomic(
        world,
        e,
        spec.harvestAtomic,
        { kind: 'harvest', resource: node, goodType: spec.goodType },
        swingTicks(spec.harvestAtomic),
        node,
      ),
    );
    return true;
  }

  // Carry a sheaf home; the delivery rung routes the load into the farm's own store, or overflows it to
  // the nearest warehouse with room.
  const sheaf = nearestFarmSheaf(plan, { anchor, spec, claims, gates });
  if (sheaf !== null && cropSinkExists()) {
    const cell = interactionCell(world, ctx, terrain, sheaf, here);
    take(cell, false);
    atOrWalk(world, e, here, cell, () =>
      startPickup(world, ctx, e, settler, sheaf, spec.goodType, CARRY_CAPACITY),
    );
    return true;
  }

  // Sow the next field while the farm is under its plot cap, in-flight sow-walks counted in. Observation:
  // the cap belongs to the farm, not its crew - extra farmers turn the plot over faster without enlarging
  // it.
  if (fields + (claims.byFarm.get(farm) ?? 0) < spec.farming.maxFields) {
    const node = nextSowNode(plan, { anchor, spec, claims, gates });
    if (node !== null) {
      take(node, true);
      const at = terrain.coordsOf(node);
      atOrWalk(world, e, here, node, () =>
        startAtomic(
          world,
          e,
          spec.plantAtomic,
          { kind: 'sow', farm, goodType: spec.goodType, x: at.x, y: at.y },
          swingTicks(spec.plantAtomic),
          farm,
        ),
      );
      return true;
    }
  }

  // Water the nearest thirsty field; every growth stage consumes one watering.
  if (thirsty !== null) {
    const crop = thirsty;
    take(thirstyCell, false);
    atOrWalk(world, e, here, thirstyCell, () =>
      startAtomic(
        world,
        e,
        spec.cultivateAtomic,
        { kind: 'water', crop },
        swingTicks(spec.cultivateAtomic),
        crop,
      ),
    );
    return true;
  }

  // Nothing to tend this tick: wait inside the farm.
  enterBuilding(world, e, farm, here, interactionCell(world, ctx, terrain, farm, here));
  return true;
}
