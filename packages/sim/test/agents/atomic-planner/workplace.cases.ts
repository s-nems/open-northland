import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  Position,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { aiSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { clearComponentStores } from '../../fixtures/stores.js';
import { anchorCell, ctxOf, grassMap, VIKING, woodAt, woodcutterAt } from './support.js';

beforeEach(clearComponentStores);

describe('atomicPlanner — walk-to-workplace drive (a BOUND operator reaches ITS station)', () => {
  const CARPENTER = 2; // the sawmill's worker job; harvests nothing (empty allowedAtomics)
  const SAWMILL = 2; // a producing workplace (recipe plank<-wood) employing the carpenter

  // The walk drive now reads the JobAssignment binding the JobSystem sets — the operator heads for
  // *its* mill, not the nearest one. These planner unit tests set the binding directly (the JobSystem
  // integration is exercised in job-system.test.ts) so they test the AI drive in isolation.
  function carpenterAt(sim: Simulation, x: number, y: number, boundTo?: Entity): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
    sim.world.add(e, Settler, {
      tribe: VIKING,
      jobType: CARPENTER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
    return e;
  }

  function sawmillAt(sim: Simulation, x: number, y: number): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
    sim.world.add(e, Building, { buildingType: SAWMILL, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(e, Stockpile, { amounts: new Map() });
    return e;
  }

  it('sets a MoveGoal to its bound workplace when the operator is standing elsewhere', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const mill = sawmillAt(sim, 3, 0); // its station, three cells away
    const carp = carpenterAt(sim, 0, 0, mill); // bound to that mill

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(carp, MoveGoal)).toBe(true);
    expect(sim.world.get(carp, MoveGoal).cell).toBe(anchorCell(sim, 3, 0));
    expect(sim.world.has(carp, CurrentAtomic)).toBe(false); // it walks, it doesn't start an atomic yet
  });

  it('leaves an operator already standing on its bound workplace put (no MoveGoal — the pin holds)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const mill = sawmillAt(sim, 3, 0);
    const carp = carpenterAt(sim, 3, 0, mill); // same cell as its bound mill — already on station

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(carp, MoveGoal)).toBe(false);
    expect(sim.world.has(carp, CurrentAtomic)).toBe(false);
  });

  it('does not move an UNBOUND operator (no station assigned yet — it idles)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    sawmillAt(sim, 3, 0);
    const carp = carpenterAt(sim, 0, 0); // employed but unbound (no JobAssignment)

    aiSystem(sim.world, ctxOf(sim));

    // With no binding the drive has no station to walk to, and a carpenter harvests nothing — so it
    // idles rather than being lured to a mill the JobSystem never assigned it.
    expect(sim.world.has(carp, MoveGoal)).toBe(false);
  });

  it('heads for ITS bound mill even when a nearer same-type mill exists', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(7, 1) });
    sawmillAt(sim, 2, 0); // nearer (node distance 4) — but NOT this carpenter's binding
    const mine = sawmillAt(sim, 5, 0); // farther (node distance 10) — this is the bound station
    const carp = carpenterAt(sim, 0, 0, mine);

    aiSystem(sim.world, ctxOf(sim));

    // Latched to its own mill: it walks to cell 5, not the nearer mill at 2 — two same-type workplaces
    // staff independently because each operator follows its binding, not proximity.
    expect(sim.world.get(carp, MoveGoal).cell).toBe(anchorCell(sim, 5, 0));
  });

  it('a woodcutter still prefers harvesting over walking to a workplace that does not employ it', () => {
    // The sawmill employs the carpenter, not the woodcutter, and the HQ (woodcutter slots) has no
    // recipe — so neither is a walk-to-workplace target for a woodcutter; it harvests as before.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const cutter = woodcutterAt(sim, 0, 0);
    sawmillAt(sim, 5, 0);
    woodAt(sim, 2, 0);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(cutter, MoveGoal).cell).toBe(anchorCell(sim, 2, 0)); // the tree, not the mill
  });
});
