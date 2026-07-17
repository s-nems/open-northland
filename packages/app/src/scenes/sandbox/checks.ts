import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { resolveVikingBuilding } from '../../catalog/buildings.js';
import { WOOD_YIELD_PER_NODE } from '../../catalog/felling.js';
import { JOB_CARRIER, staffableCrewFor } from '../../game/sandbox/index.js';
import { GATHERER_BY_GOOD, type GatherCamp, MINE_DEPOSIT_SCALE, WAREHOUSE_IDS } from './placements.js';

/** The world queries the sandbox scene's checks are stated in — staffing tallies, camp depletion, and
 *  the seeded warehouse stores. */

const { Building, JobAssignment, Resource, Settler, Stockpile } = components;

/** Bound settlers per (building, jobType) — the check-side mirror of the JobSystem's staffing tally. */
function boundCrewCount(sim: Simulation, building: Entity, jobType: number): number {
  let n = 0;
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace !== building) continue;
    if (sim.world.get(e, Settler).jobType === jobType) n++;
  }
  return n;
}

/** Every placed building's staffable production (non-carrier) slots hold exactly their crew. Carriers are
 *  covered by the settlement-wide total instead (a loose carrier reports in to the first open post in
 *  canonical order, so an individual carrier may post to a neighbour). */
export function producingCrewsComplete(sim: Simulation): boolean {
  for (const e of sim.world.query(Building)) {
    const type = sim.world.get(e, Building).buildingType;
    for (const slot of staffableCrewFor(sim, type)) {
      if (slot.jobType === JOB_CARRIER) continue;
      if (boundCrewCount(sim, e, slot.jobType) !== slot.count) return false;
    }
  }
  return true;
}

/** Total staffable slots across the placed settlement vs total bound settlers — the carriers' half of the
 *  staffing proof (see {@link producingCrewsComplete}). */
export function settlementFullyStaffed(sim: Simulation): boolean {
  let expected = 0;
  for (const e of sim.world.query(Building)) {
    const type = sim.world.get(e, Building).buildingType;
    for (const slot of staffableCrewFor(sim, type)) expected += slot.count;
  }
  let bound = 0;
  for (const _ of sim.world.query(JobAssignment)) bound++;
  return expected > 0 && bound === expected;
}

/** The units a camp's authored nodes start with, from the gatherer catalog (per-mode node yield). */
export function initialUnits(camp: GatherCamp): number {
  const g = GATHERER_BY_GOOD.get(camp.good);
  if (g === undefined) return 0;
  const perNode =
    g.mode === 'fell'
      ? WOOD_YIELD_PER_NODE
      : g.mode === 'mine'
        ? (g.depositUnits ?? 0) * MINE_DEPOSIT_SCALE
        : 1;
  return camp.nodes.length * perNode;
}

/** The units still sitting in `good`'s live resource nodes (a fully consumed node is gone entirely). */
export function remainingUnits(sim: Simulation, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Resource)) {
    const r = sim.world.get(e, Resource);
    if (r.goodType === good) total += r.remaining;
  }
  return total;
}

/** Every placed warehouse tier holds every one of its stock slots at its capacity. */
export function warehousesFull(sim: Simulation): boolean {
  let seen = 0;
  for (const id of WAREHOUSE_IDS) {
    const typeId = resolveVikingBuilding(id).typeId;
    const slots = sim.content.buildings.find((b) => b.typeId === typeId)?.stock ?? [];
    if (slots.length === 0) return false;
    for (const e of sim.world.query(Building)) {
      if (sim.world.get(e, Building).buildingType !== typeId) continue;
      seen++;
      const amounts = sim.world.get(e, Stockpile).amounts;
      if (!slots.every((s) => (amounts.get(s.goodType) ?? 0) === s.capacity)) return false;
    }
  }
  return seen === WAREHOUSE_IDS.size;
}
