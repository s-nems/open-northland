import { describe, expect, it } from 'vitest';
import { Building, Production, Stockpile } from '../../../src/components/index.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  CYCLE_TICKS,
  ctxOf,
  HEADQUARTERS,
  PLANK,
  sawmill,
  spawnSettler,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('productionSystem — gating', () => {
  it('does not start a cycle when the input good is missing', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 0]]);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // never started
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // nothing produced
  });

  it('does not produce while the workplace is still under construction (built < ONE)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A staffed sawmill with its input present — but the building is still a construction site
    // (built < ONE). Its delivered build materials happen to include the recipe input (WOOD), yet an
    // unbuilt workplace must produce nothing: the build-completion gate, not an output-good accident.
    const { mill } = sawmill(sim, [
      [WOOD, 5],
      [PLANK, 0],
    ]);
    sim.world.get(mill, Building).built = fx.fromInt(0); // demote to under-construction
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // never started — site doesn't produce
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5); // input untouched (not raided)
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // nothing produced

    // Once built, the very next tick the same workplace starts consuming/producing as usual.
    sim.world.get(mill, Building).built = ONE;
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // produced once built
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(3); // two cycles' worth consumed
  });

  it('enforces per-good output capacity: no cycle starts when the output is full', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Plank already at its cap (20) — no room for the +1 output, so production must not start
    // (and so must not consume the input either). This is the capacity enforcement.
    const { mill } = sawmill(sim, [
      [WOOD, 5],
      [PLANK, 20],
    ]);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5); // input untouched (no waste)
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // never exceeds capacity
  });

  it('resumes producing once the full output makes room again', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [
      [WOOD, 5],
      [PLANK, 20],
    ]);
    // Blocked while full.
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    // Make room (e.g. a carrier hauled a plank away), then a cycle can start.
    sim.world.get(mill, Stockpile).amounts.set(PLANK, 19);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // produced exactly to the cap
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(4); // one input consumed
  });

  it('does not start a cycle when the output good is gated-out (jobEnablesGood, no enabling settler)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Inputs present, output room free, carpenter operator on the tile — but NO woodcutter exists in
    // the tribe, and PLANK is gated by `jobEnablesGood 1 2`. So the tech-graph gate blocks production.
    const { mill } = sawmill(sim, [[WOOD, 5]], true, false);
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // gated out — never started
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(5); // input untouched (no waste)
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // nothing produced
  });

  it('starts producing once the enabling-job settler appears (gate opens mid-run)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 5]], true, false); // staffed, but PLANK gated-out
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false); // blocked while the woodcutter is absent

    // A woodcutter joins the tribe — the jobEnablesGood gate for PLANK now opens.
    spawnSettler(sim, WOODCUTTER, 9, 9);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // produced once unlocked
    // The first cycle completes on the CYCLE_TICKS+1-th tick and a second starts the same tick, so two
    // wood are consumed by the end of the loop (5 → 3) while only the first cycle's plank is out yet.
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(3);
  });

  it('ignores a building whose type carries no recipe (not a workplace)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hq = sim.world.create();
    sim.world.add(hq, Building, { buildingType: HEADQUARTERS, tribe: 1, built: ONE, level: 0 });
    sim.world.add(hq, Stockpile, { amounts: new Map([[WOOD, 10]]) });
    for (let t = 0; t < CYCLE_TICKS + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hq, Production)).toBe(false);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10); // untouched
  });
});
