import { components, type Entity, halfCellMapFromCells, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  JOB_CARRIER,
  JOB_COLLECTOR,
  placeSandboxBuilding,
  sandboxContent,
  spawnIdleSettler,
  spawnSandboxSettler,
} from '../src/game/sandbox/index.js';
import { buildingOfType } from '../src/scenes/sandbox-queries.js';

/**
 * The sandbox tribe's `jobEnablesHouse` tech graph (tech-graph.ts), exercised headlessly on the real
 * mechanism — the gate that in browser play only surfaced as the warehouse "employs nobody" catch-22. The
 * warehouse (house 7) is gated on a collector being present; both employment paths (the JobSystem's auto
 * assign and the player's `assignWorker` command) run through the same `buildingEnabled` gate, so with no
 * collector alive neither can staff it, and with one alive both can. Proves the enrichment reproduces the
 * bug class instead of leaving it a browser-only surprise.
 */

const { JobAssignment, Settler } = components;
const MAP = grassTerrain(24, 20);
const WAREHOUSE = { x: 10, y: 6 } as const;
const CARRIER_ROW_Y = WAREHOUSE.y + 3;
/** The warehouse's carrier-slot count (`BUILDING_WORKER_SLOTS[7]`): carrier id 24 sorts before the rebased
 *  gatherer slots, so idle settlers fill the carrier slots first — the same reason the warehouse scene sees
 *  exactly three carriers. */
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

describe('sandbox jobEnablesHouse gate — the warehouse employment catch-22', () => {
  it('with no enabler, the gated warehouse employs nobody and assignWorker is a no-op', () => {
    const sim = makeSim();
    placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y, HUMAN_PLAYER);
    const idlers = Array.from({ length: CARRIERS }, (_, i) =>
      spawnIdleSettler(sim, WAREHOUSE.x - 1 + i, CARRIER_ROW_Y, HUMAN_PLAYER),
    );
    sim.run(50);

    const store = warehouse(sim);
    // The auto-assign pass no-ops: house 7 is gated on a collector, and none exists.
    expect(carriersEmployedBy(sim, store)).toBe(0);
    for (const e of idlers) expect(sim.world.get(e, Settler).jobType).toBeNull();

    // The explicit player command hits the same gate — a gated building offers no open job.
    sim.enqueue({ kind: 'assignWorker', entity: idlers[0], building: store, jobPriority: [JOB_CARRIER] });
    sim.run(2);
    expect(sim.world.get(idlers[0], Settler).jobType).toBeNull();
    expect(sim.world.has(idlers[0], JobAssignment)).toBe(false);
  });

  it('with a collector alive, the warehouse unlocks and its carriers are employed', () => {
    const sim = makeSim();
    placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y, HUMAN_PLAYER);
    // The tech enabler — a lone collector far from the store, the gatherer the HQ would seed in a real game.
    spawnSandboxSettler(sim, JOB_COLLECTOR, 2, 2, HUMAN_PLAYER);
    for (let i = 0; i < CARRIERS; i++) {
      spawnIdleSettler(sim, WAREHOUSE.x - 1 + i, CARRIER_ROW_Y, HUMAN_PLAYER);
    }
    sim.run(50);

    expect(carriersEmployedBy(sim, warehouse(sim))).toBe(CARRIERS);
  });
});
