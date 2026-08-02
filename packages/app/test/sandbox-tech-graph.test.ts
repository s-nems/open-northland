import { components, type Entity, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_CARRIER, JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeSandboxBuilding,
  sandboxContent,
  spawnIdleSettler,
  spawnSandboxSettler,
} from '../src/game/sandbox/index.js';
import { buildingOfType } from '../src/scenes/sandbox-queries.js';

/**
 * The sandbox tribe's `jobEnablesHouse` gate (tech-graph.ts): the warehouse (house 7) is gated on a collector
 * being present, and the `assignWorker` order runs through that `buildingEnabled` gate - so with no collector
 * alive it refuses the post, and with one alive it takes it.
 */

const { JobAssignment, Settler } = components;
const MAP = grassTerrain(24, 20);
const WAREHOUSE = { x: 10, y: 6 } as const;
const CARRIER_ROW_Y = WAREHOUSE.y + 3;
/** The warehouse's carrier-slot count (`BUILDING_WORKER_SLOTS[7]`) - what the posts below may fill. */
const CARRIERS = 3;

/** A fresh sim over the real sandbox content, needs off (a jobless enabler must not starve mid-run). */
function makeSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: sandboxContent(MAP), map: halfCellMapFromCells(MAP) });
  sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

/** The one placed warehouse, or a thrown error (a setup bug) so callers never carry a nullable through. */
function warehouse(sim: Simulation): Entity {
  const store = buildingOfType(sim, BUILDING_WAREHOUSE_00);
  if (store === null) throw new Error('warehouse placement command did not run');
  return store;
}

/** Carriers ({@link JOB_CARRIER}) bound to `store` via {@link JobAssignment}. */
function carriersEmployedBy(sim: Simulation, store: Entity): number {
  let bound = 0;
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace !== store) continue;
    if (sim.world.get(e, Settler).jobType === JOB_CARRIER) bound++;
  }
  return bound;
}

// SKIPPED: the building tech-unlock gate (`buildingEnabled`/`jobEnablesHouse`) is disabled feature-wide
// - see docs/tickets/sim/rework-building-unlock-gate.md. Un-skip when the gate is re-enabled.
describe.skip('sandbox jobEnablesHouse gate - the warehouse employment catch-22', () => {
  it('with no enabler, a post to the gated warehouse is refused', () => {
    const sim = makeSim();
    placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y, HUMAN_PLAYER);
    const idlers = Array.from({ length: CARRIERS }, (_, i) =>
      spawnIdleSettler(sim, WAREHOUSE.x - 1 + i, CARRIER_ROW_Y, HUMAN_PLAYER),
    );
    sim.run(50);

    const store = warehouse(sim);
    for (const e of idlers) {
      sim.enqueue({ kind: 'assignWorker', entity: e, building: store, jobPriority: [JOB_CARRIER] });
    }
    sim.run(2);

    // House 7 is gated on a collector and none exists, so the gated building offers no open job.
    expect(carriersEmployedBy(sim, store)).toBe(0);
    for (const e of idlers) expect(sim.world.get(e, Settler).jobType).toBeNull();
  });

  it('with a collector alive, the warehouse unlocks and takes its carriers', () => {
    const sim = makeSim();
    placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y, HUMAN_PLAYER);
    // The tech enabler - a lone collector far from the store, the gatherer the HQ would seed in a real game.
    spawnSandboxSettler(sim, JOB_COLLECTOR, 2, 2, HUMAN_PLAYER);
    const idlers = Array.from({ length: CARRIERS }, (_, i) =>
      spawnIdleSettler(sim, WAREHOUSE.x - 1 + i, CARRIER_ROW_Y, HUMAN_PLAYER),
    );
    sim.run(50);

    const store = warehouse(sim);
    for (const e of idlers) {
      sim.enqueue({ kind: 'assignWorker', entity: e, building: store, jobPriority: [JOB_CARRIER] });
    }
    sim.run(2);

    expect(carriersEmployedBy(sim, store)).toBe(CARRIERS);
  });
});
