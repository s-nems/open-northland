import { describe, expect, it } from 'vitest';
import { Carrying, Health, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import { atomicSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, startAtomic, WOOD } from './support.js';

describe('atomicSystem — hunter cadaver-harvest yield (harvest_cadaver follow-up)', () => {
  const VIKING = 1;
  const HUNTER = 15; // job 15 — JOB_TYPE_HUMAN_HUNTER
  const WOODCUTTER = 1; // a non-hunter trade
  const COW = 13; // catchable prey, fixture maximumCadaverSize 4
  const WOLVES = 9; // a known animal tribe with NO animaltypes record (not catchable)
  const MEAT = 21; // goodtypes.ini meat -> type 21

  /** A combatant settler of `tribe`/`job` (no Health pool needed — it is the attacker, not a target). */
  function combatant(sim: Simulation, tribe: number, job: number | null): Entity {
    const e = sim.world.create();
    sim.world.add(e, Settler, {
      tribe,
      jobType: job,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    return e;
  }

  /** A prey/target animal of `tribe` with a Health pool of `hp`. */
  function prey(sim: Simulation, tribe: number, hp: number): Entity {
    const e = sim.world.create();
    sim.world.add(e, Settler, {
      tribe,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(e, Health, { hitpoints: hp, max: hp });
    return e;
  }

  it("a hunter's LETHAL blow on catchable prey yields the cadaver's meat onto its back", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hunter = combatant(sim, VIKING, HUNTER);
    const cow = prey(sim, COW, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, 81); // overkill — lethal
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(0); // felled
    // meat 21, amount = the cow's maximumCadaverSize (4) — the harvest_cadaver yield
    expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: MEAT, amount: 4 });
  });

  it('a NON-lethal hunter blow yields no meat (the kill must fell the prey)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hunter = combatant(sim, VIKING, HUNTER);
    const cow = prey(sim, COW, 1000);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 50 }, 1, 81); // survivable
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(950); // wounded, not dead
    expect(sim.world.has(hunter, Carrying)).toBe(false); // no carcass to harvest yet
  });

  it('a NON-hunter killing the same prey harvests nothing (only a hunter works a cadaver)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const woodcutter = combatant(sim, VIKING, WOODCUTTER);
    const cow = prey(sim, COW, 20);
    startAtomic(sim, woodcutter, { kind: 'attack', target: cow, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(0); // still felled
    expect(sim.world.has(woodcutter, Carrying)).toBe(false); // but no meat — not a hunter
  });

  it('a hunter felling a NON-catchable animal yields nothing (no catchable cadaver)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hunter = combatant(sim, VIKING, HUNTER);
    const wolf = prey(sim, WOLVES, 20); // not catchable (no animal record)
    startAtomic(sim, hunter, { kind: 'attack', target: wolf, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(wolf, Health).hitpoints).toBe(0);
    expect(sim.world.has(hunter, Carrying)).toBe(false); // wolf isn't catchable prey
  });

  it('a hunter already carrying meat merges the new cadaver yield (goods conserved)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hunter = combatant(sim, VIKING, HUNTER);
    sim.world.add(hunter, Carrying, { goodType: MEAT, amount: 4 }); // a prior kill's meat
    const cow = prey(sim, COW, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: MEAT, amount: 8 }); // 4 + 4
  });

  it('a hunter already loaded with a DIFFERENT good drops the meat rather than crashing the tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const hunter = combatant(sim, VIKING, HUNTER);
    sim.world.add(hunter, Carrying, { goodType: WOOD, amount: 2 }); // can't hold a second good type
    const cow = prey(sim, COW, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, 81);
    expect(() => atomicSystem(sim.world, ctxOf(sim))).not.toThrow(); // skip, don't throw
    expect(sim.world.get(cow, Health).hitpoints).toBe(0); // the kill still landed
    expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: WOOD, amount: 2 }); // load untouched
  });
});
