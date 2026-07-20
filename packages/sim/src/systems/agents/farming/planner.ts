import {
  Building,
  CARRY_CAPACITY,
  Crop,
  FarmTask,
  JobAssignment,
  Position,
  Resting,
  UnderConstruction,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type FarmingSpec, farmWorkGood } from '../../economy/farming.js';
import { buildingEnabled } from '../../progression/index.js';
import { atomicDuration } from '../../readviews/animations.js';
import { manhattan } from '../../spatial.js';
import { buildingWorkerJobs } from '../../stores/index.js';
import { atOrWalk, startAtomic, startPickup } from '../actions.js';
import type { PlannerContext } from '../planner-context.js';
import { closer, interactionCell, jobAtomics } from '../targets/index.js';

// The farmer drive — the field-cultivation rung of the planner ladder: a worker bound to a farm (a workplace
// producing a field-farmed good, `farmWorkGood`) walks its farm's surroundings sowing, watering and reaping
// wheat fields and carries each cut sheaf home. The field lifecycle itself (growth, the sow/water/reap effects)
// lives in ../economy/farming.ts; this module decides what the farmer does next. Source basis: the actions and
// their animations are the original's own farmer vocabulary (atomics 34/35/29); the loop's ordering is
// engine-side and not decoded, so the priority below (reap > carry > sow > water > wait) is a named
// approximation of the observed original.

import type { FarmClaims } from './claims.js';
import { nearestFarmSheaf, nextSowNode } from './targets.js';

/**
 * The farm a bound settler should work as a field-farmer, with the farmed good's resolved spec — or null when
 * the settler isn't a field-farmer here (it then falls through to the producer/gatherer rungs). The farm twin
 * of `boundWorkplaceTarget`, differing in the workplace test: a producing workplace carries a `recipe`, a farm
 * produces a `farming` good ({@link farmWorkGood}); the settler must also be permitted the good's plant atomic
 * (the data-driven "is the field trade" gate — the farm's carrier slot shares the building but may not sow, so
 * it falls through to the porter rung).
 */
function boundFarmTarget(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): { farm: Entity; spec: FarmingSpec } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null; // unassigned — no farm to work
  const b = binding.workplace;
  const building = world.tryGet(b, Building);
  if (building === undefined || building.tribe !== tribe) return null; // gone / wrong tribe
  // A foundation fields no crew — the readable original gates the farmer trade on a finished house
  // (`jobtypes.ini` farmer `mustHaveFinishedWorkHouseFlag 1`), so a farm still being raised neither sows its
  // ring nor shelters a Resting worker inside its skeleton.
  if (world.has(b, UnderConstruction)) return null;
  const spec = farmWorkGood(world, ctx, b);
  if (spec === null) return null; // not a farm
  if (!jobAtomics(ctx, jobType).has(spec.plantAtomic)) return null; // not the field trade (a carrier)
  if (!buildingWorkerJobs(world, ctx, b).has(jobType)) return null; // doesn't employ this job
  if (!buildingEnabled(world, ctx, tribe, building.buildingType)) return null; // building-unlock gate (disabled — see buildingEnabled)
  if (!world.has(b, Position)) return null; // a position-less farm has no fields to ring
  return { farm: b, spec };
}

/**
 * 2. FARMER — the field-cultivation loop for a settler bound to a farm, in priority order (each step targets
 * the nearest candidate, Manhattan + ascending-cell-id tie-break over the canonical lists):
 *
 *  a. **Reap** a ripe field of this farm (the scythe swing — the good's harvest atomic; the cut wheat drops as
 *     a ground sheaf where the field stood).
 *  b. **Carry a sheaf home** — pick up a cut-wheat {@link import('../../components/index.js').GroundDrop} lying
 *     within the farm's field radius (the delivery rung then routes the load into the farm's own store — the
 *     bound storage sink).
 *  c. **Sow** a new field while the farm holds fewer than `maxFields` — a flat per-farm plot size, unchanged
 *     by crew size (observed) — walk to the next free node of the jittered field lattice around the farm and
 *     run the plant atomic. Sowing beats
 *     the can: with per-stage watering some field is almost always thirsty, so a water-first farmer would tend
 *     two seedlings forever and never expand the plot; a sown-but-dry field loses nothing by standing a moment.
 *  d. **Water** a thirsty field (the cultivate atomic) — every stage consumes one watering, so between sowings
 *     the farmer circles its growing fields with the can (see the farming module note).
 *  e. **Rest inside the farm** — nothing to reap, carry, water or sow this tick: walk to the farm and step
 *     inside (the {@link Resting} marker — the render hides the settler), back out the moment a field needs the
 *     can. The original's off-duty workers wait in the house, not lined at the door.
 *
 * Always returns true once bound to a farm (a farmer is spoken for, like the flag-bound gatherer); returns
 * false only for a settler that isn't a field-farmer here. The ordering is a named approximation (the
 * original's engine-side loop has no oracle); sow-before-water is load-bearing under per-stage watering (step c).
 *
 * Work division: every candidate scan skips nodes in `claims` (a colleague is en route — its live
 * {@link FarmTask}, or planned earlier this tick), and every issued action claims its node + stamps this
 * settler's own FarmTask — so N farmers spread over N different fields instead of walking in lockstep to one.
 *
 * Store-full pause: reap + sheaf-carry only run while some store can still take the crop (the farm's own wheat
 * slot, or any warehouse — {@link nearestStoreFor}); with every sink full, ripe fields stand and sheaves lie
 * until space frees, then the loop resumes by itself. Sowing/watering continue meanwhile (bounded by the field
 * cap), so a paused farm keeps a ripe buffer ready — a named approximation (no readable oracle).
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

  /** How long one field action takes: the atomic's animation length replayed `workRepeats` times — the
   *  farmer scythes/sows/waters several strokes per spot, not one (see the good's `workRepeats`). */
  const swingTicks = (atomic: number): number =>
    atomicDuration(ctx.content, settler, atomic) * spec.farming.workRepeats;

  /** Claim `node` for this settler's next action and record the in-flight intent (see FarmTask). */
  const take = (node: NodeId, sow: boolean): void => {
    claims.nodes.add(node);
    if (sow) claims.byFarm.set(farm, (claims.byFarm.get(farm) ?? 0) + 1);
    world.add(e, FarmTask, { farm, node, sow });
  };

  // One pass over this farm's own fields: count them (the max-fields gate) and pick the nearest unclaimed
  // ripe one (to reap) + unwatered growing one (to water). Canonical list + (dist, cell) tie-break.
  let fields = 0;
  let ripe: Entity | null = null;
  let ripeCell = 0 as NodeId;
  let ripeDist = Number.POSITIVE_INFINITY;
  let thirsty: Entity | null = null;
  let thirstyCell = 0 as NodeId;
  let thirstyDist = Number.POSITIVE_INFINITY;
  for (const c of targets.cropsByFarm.get(farm) ?? []) {
    const crop = world.get(c, Crop);
    fields++;
    const cell = interactionCell(world, ctx, terrain, c, here);
    if (claims.nodes.has(cell)) continue; // a colleague is already on this field
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

  // The store-full gate for the crop-moving steps (reap/carry): some store can still take the good — the farm's
  // own slot, or any warehouse (then the delivery rung overflows the load there). Checked lazily, only when a
  // ripe field or sheaf actually exists this tick.
  const cropSinkExists = (): boolean => targets.sinks.has(spec.goodType);

  // a. Reap the nearest ripe field (the scythe swing; the yield drops as a sheaf where it stood).
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

  // b. Carry a sheaf home — the delivery rung then routes the load into the farm's own store (or, with
  // the farm full, overflows it to the nearest warehouse that still has room).
  const sheaf = nearestFarmSheaf(plan, { anchor, spec, claims });
  if (sheaf !== null && cropSinkExists()) {
    const cell = interactionCell(world, ctx, terrain, sheaf, here);
    take(cell, false);
    atOrWalk(world, e, here, cell, () =>
      startPickup(world, ctx, e, settler, sheaf, spec.goodType, CARRY_CAPACITY),
    );
    return true;
  }

  // c. Sow the next field while the farm is under its plot cap (in-flight sow-walks counted in). The cap
  // belongs to the FARM, not its crew — measured in the original, a farm holds the same ~24 plants whether
  // one farmer or four work it; extra farmers make the plot turn over faster, they do not enlarge it.
  // Before the can: with per-stage watering something is almost always thirsty, so a water-first farmer
  // would never expand.
  if (fields + (claims.byFarm.get(farm) ?? 0) < spec.farming.maxFields) {
    const node = nextSowNode(plan, { anchor, spec, claims });
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

  // d. Water the nearest thirsty field — each stage step consumes a watering, so the farmer circles its plot
  // with the can between sowings.
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

  // e. Nothing to tend this tick — walk home and wait inside the farm (re-stamped every idle tick, so the
  // marker holds without flicker; the replan sweep in ai.ts clears it the moment work appears).
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, farm, here), () =>
    world.add(e, Resting, { at: farm }),
  );
  return true;
}
