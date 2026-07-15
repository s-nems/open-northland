import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Position,
  Resource,
  Settler,
} from '../../../src/components/index.js';
import { fx, Simulation } from '../../../src/index.js';
import { aiSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import {
  anchorCell,
  ctxOf,
  grassMap,
  HARVEST_ATOMIC,
  storeAt,
  VIKING,
  WOOD,
  woodAt,
  woodcutterAt,
} from './support.js';

describe('atomicPlanner — choosing the next atomic', () => {
  it('sets a MoveGoal to the nearest harvestable resource when empty-handed and not on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, MoveGoal)).toBe(true);
    expect(sim.world.get(cutter, MoveGoal).cell).toBe(anchorCell(sim, 3, 0));
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
  });

  it('starts a harvest atomic (duration from content) when standing on a resource', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 3, 0);
    const node = woodAt(sim, 3, 0); // same cell

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(cutter, MoveGoal)).toBe(false);
    const atomic = sim.world.get(cutter, CurrentAtomic);
    expect(atomic.atomicId).toBe(HARVEST_ATOMIC);
    expect(atomic.duration).toBe(3); // resolved via viking setatomic -> viking_chop length 3
    expect(atomic.effect).toEqual({ kind: 'harvest', resource: node, goodType: WOOD });
  });

  it('picks the NEAREST harvestable resource (Manhattan), tie-broken by cell id', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 4, 0); // node distance 8
    woodAt(sim, 2, 0); // node distance 4 — should win
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cutter, MoveGoal).cell).toBe(anchorCell(sim, 2, 0));
  });

  it('does not harvest a resource its job is not allowed to (data-driven gate)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    // A resource harvested with a different atomic the woodcutter does not have in allowedAtomics.
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 99 });
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(cutter, MoveGoal)).toBe(false); // nothing it may harvest -> idle
    expect(sim.world.has(cutter, CurrentAtomic)).toBe(false);
  });

  it('ignores a depleted resource (remaining 0)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 3, 0, 0); // depleted
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(cutter, MoveGoal)).toBe(false);
  });

  it('sets a MoveGoal to a store when carrying and not on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });
    storeAt(sim, 4, 0);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cutter, MoveGoal).cell).toBe(anchorCell(sim, 4, 0));
  });

  it('starts a pileup atomic when carrying and standing on a store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 4, 0);
    sim.world.add(cutter, Carrying, { goodType: WOOD, amount: 1 });
    const store = storeAt(sim, 4, 0);
    aiSystem(sim.world, ctxOf(sim));
    const atomic = sim.world.get(cutter, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pileup', store });
  });

  it('does nothing while an atomic is already running', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    woodAt(sim, 3, 0);
    sim.world.add(cutter, CurrentAtomic, {
      atomicId: 1,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 5,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(cutter, MoveGoal)).toBe(false); // busy — planner left it alone
  });

  it('an unemployed settler (no job) runs no atomics', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(e, Settler, {
      tribe: VIKING,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    woodAt(sim, 3, 0);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.has(e, CurrentAtomic)).toBe(false);
  });
});
