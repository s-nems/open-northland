import { describe, expect, it } from 'vitest';
import { StrandedField } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import {
  fieldReclaimSystem,
  STRANDED_FIELD_CHECK_PERIOD_TICKS,
  STRANDED_FIELD_RECLAIM_TICKS,
  stampResourceFootprintData,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  BLOCKHOUSE,
  Building,
  blockhouseAt,
  Crop,
  cellMap,
  ctxOf,
  FIELD_CAP,
  farmAt,
  farmerAt,
  fieldAt,
  grassMap,
  Position,
  wallsContent,
} from './support.js';

// The reclaim sweep (`systems/economy/field-reclaim.ts`, where the rule is stated): unit cases drive
// the sweep alone with a hand-rolled tick; the walled-pocket case runs the full sim to prove the plot
// slot actually comes back.

/** Latest tick the sweep may still not have destroyed a freshly stranded field (first check up to one
 *  period after creation, destroyed one reclaim span after that check). */
const DEAD_BY = STRANDED_FIELD_RECLAIM_TICKS + 2 * STRANDED_FIELD_CHECK_PERIOD_TICKS;

/** Drive ONLY the reclaim sweep for ticks `[from, to)` — no movement, growth or planner runs, so the
 *  world around the sweep holds perfectly still. */
function driveSweep(sim: Simulation, from: number, to: number): void {
  for (let t = from; t < to; t++) fieldReclaimSystem(sim.world, { ...ctxOf(sim), tick: t });
}

/** A field whose ONLY work stance is the cell two nodes east of its anchor — the real-content shape
 *  (a work area beside the plant, not on it), so a building over that cell strands it. */
function ringFieldAt(sim: Simulation, farm: Entity, x: number, y: number): Entity {
  const e = fieldAt(sim, farm, x, y);
  stampResourceFootprintData(sim.world, e, { walk: [], build: [], work: [{ dx: 2, dy: 0 }] });
  return e;
}

describe('the stranded-field reclaim sweep', () => {
  it('destroys a field its farm can never route to, but only after the sustained span', () => {
    // A river between farm and field — the "terrain cut it off" class: the static components differ,
    // so every route probe refuses immediately, whoever asks.
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: cellMap(12, 12, (x) => (x === 5 ? 'water' : 'grass')),
    });
    const farm = farmAt(sim, 8, 6);
    const field = fieldAt(sim, farm, 2, 6); // far bank

    driveSweep(sim, 0, STRANDED_FIELD_RECLAIM_TICKS - STRANDED_FIELD_CHECK_PERIOD_TICKS);
    expect(sim.world.tryGet(field, Crop)).toBeDefined(); // the grace span holds

    driveSweep(sim, STRANDED_FIELD_RECLAIM_TICKS - STRANDED_FIELD_CHECK_PERIOD_TICKS, DEAD_BY);
    expect(sim.world.tryGet(field, Crop)).toBeUndefined(); // reclaimed
  });

  it('never marks a field because a settler stands on its work cell', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 10) });
    const farm = farmAt(sim, 8, 6);
    const field = fieldAt(sim, farm, 4, 6);
    farmerAt(sim, 4, 6); // parked exactly on the field's own work node; no other system moves it

    driveSweep(sim, 0, DEAD_BY);

    expect(sim.world.tryGet(field, Crop)).toBeDefined();
    expect(sim.world.has(field, StrandedField)).toBe(false); // units are invisible to the sweep
  });

  it('clears the mark when the blocker goes away before the span runs out', () => {
    const sim = new Simulation({ seed: 1, content: wallsContent(), map: grassMap(12, 12) });
    const farm = farmAt(sim, 8, 8);
    const field = ringFieldAt(sim, farm, 3, 3); // work cell at node (9, 6)
    blockhouseAt(sim, 4, 3); // walls over that work cell — every stance blocked

    driveSweep(sim, 0, 2 * STRANDED_FIELD_CHECK_PERIOD_TICKS);
    expect(sim.world.has(field, StrandedField)).toBe(true); // observed cut off, clock running

    const walls = [...sim.world.query(Building)].find(
      (e) => sim.world.get(e, Building).buildingType === BLOCKHOUSE,
    );
    expect(walls).toBeDefined();
    if (walls !== undefined) sim.world.destroy(walls); // the transient clears (site cancelled)

    driveSweep(sim, 2 * STRANDED_FIELD_CHECK_PERIOD_TICKS, 2 * DEAD_BY);
    expect(sim.world.tryGet(field, Crop)).toBeDefined(); // never reclaimed
    expect(sim.world.has(field, StrandedField)).toBe(false);
  });

  it('a farm walled off from one of its fields gets the slot back and refills the plot', () => {
    // The ticket's headline case, end to end: a full-height wall column seals the map's west side
    // (every crossing step must land on node column x = 9 — all walled), leaving the field's own
    // ground open, so the planner's component check passes and only a route probe can see the pocket.
    const sim = new Simulation({ seed: 7, content: wallsContent(), map: grassMap(12, 12) });
    const farm = farmAt(sim, 10, 6);
    farmerAt(sim, 10, 6, farm);
    for (let r = 0; r < 12; r++) blockhouseAt(sim, 4, r);
    const pocket = fieldAt(sim, farm, 2, 6); // sealed west of the wall, holding one of the 6 slots

    sim.run(DEAD_BY + 100);
    expect(sim.world.tryGet(pocket, Crop)).toBeUndefined(); // the sealed field was reclaimed

    // With the slot back the farmer sows the plot to its full cap on the farm's side of the wall.
    let full = false;
    for (let i = 0; i < 200 && !full; i++) {
      sim.run(5);
      full = [...sim.world.query(Crop)].length === FIELD_CAP;
    }
    expect(full).toBe(true);
    for (const e of sim.world.query(Crop)) {
      expect(sim.world.get(e, Position).x).toBeGreaterThan(fx.fromInt(5)); // all east of the wall
    }
  });
});
