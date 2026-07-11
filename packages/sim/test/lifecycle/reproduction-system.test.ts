import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Building, Position, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, populationWithinHousing, Simulation } from '../../src/index.js';
import {
  housingCapacity,
  isNonWorkingAge,
  NEWBORN_AGE_CLASS,
  reproductionSystem,
  type SystemContext,
  tribePopulation,
} from '../../src/systems/index.js';
import { clearComponentStores } from '../fixtures/stores.js';

/**
 * ReproductionSystem (birth half) — a tribe grows one settler per tick while its population is below
 * the housing capacity its built `home` buildings provide, the first WRITER of the housing read model.
 * A newborn is idle and is born at the tribe's lowest-id built home; the system is self-limiting (it
 * stops at capacity), so the `populationWithinHousing` invariant can never be breached by a birth.
 */

const VIKING = 1;
const OTHER_TRIBE = 2;

// home_small (homeSize 3) + home_large (homeSize 5) + a non-residence HQ. Only goods/jobs/buildings
// are required by parseContentSet; the rest default.
function reproContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [
      { typeId: 1, id: 'headquarters', kind: 'headquarters' }, // not a residence
      { typeId: 2, id: 'home_small', kind: 'home', homeSize: 3 },
      { typeId: 3, id: 'home_large', kind: 'home', homeSize: 5 },
    ],
  });
}

beforeEach(() => {
  clearComponentStores();
});

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** Place a built home (or any building type) for `tribe` at (x, y). */
function placeBuilding(sim: Simulation, buildingType: number, tribe: number, x = 4, y = 4): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe, built: ONE, level: 0 });
  return e;
}

function spawnSettler(sim: Simulation, tribe: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Settler, {
    tribe,
    jobType: 0,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

describe('ReproductionSystem — births fill spare housing', () => {
  it('births one settler per tick while population is below capacity', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 2, VIKING); // home_small, capacity 3
    expect(tribePopulation(sim.world, VIKING)).toBe(0);

    reproductionSystem(sim.world, ctxOf(sim));
    expect(tribePopulation(sim.world, VIKING)).toBe(1); // one birth this tick

    reproductionSystem(sim.world, ctxOf(sim));
    reproductionSystem(sim.world, ctxOf(sim));
    expect(tribePopulation(sim.world, VIKING)).toBe(3); // grew to the capacity-3 ceiling
  });

  it('stops at the housing ceiling and never overshoots', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 2, VIKING); // capacity 3
    for (let i = 0; i < 10; i++) reproductionSystem(sim.world, ctxOf(sim));
    expect(tribePopulation(sim.world, VIKING)).toBe(housingCapacity(sim.world, ctxOf(sim), VIKING));
    expect(tribePopulation(sim.world, VIKING)).toBe(3); // not 4+ — the gate self-limits
  });

  it('does not birth for a tribe with no housing capacity', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 1, VIKING); // a headquarters — not a residence
    reproductionSystem(sim.world, ctxOf(sim));
    expect(tribePopulation(sim.world, VIKING)).toBe(0);
  });

  it('does not birth into an unbuilt home (built < ONE)', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
    sim.world.add(e, Building, { buildingType: 3, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    reproductionSystem(sim.world, ctxOf(sim));
    expect(tribePopulation(sim.world, VIKING)).toBe(0);
  });

  it('births a tribe-specific settler at its own home, independently per tribe', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 2, VIKING, 4, 4); // capacity 3 at (4,4)
    placeBuilding(sim, 3, OTHER_TRIBE, 9, 9); // capacity 5 at (9,9)

    reproductionSystem(sim.world, ctxOf(sim));
    expect(tribePopulation(sim.world, VIKING)).toBe(1);
    expect(tribePopulation(sim.world, OTHER_TRIBE)).toBe(1);

    // The viking newborn is born at the viking home tile (4,4); the other tribe's at (9,9).
    for (const id of sim.world.query(Settler, Position)) {
      const s = sim.world.get(id, Settler);
      const p = sim.world.get(id, Position);
      if (s.tribe === VIKING) {
        expect(fx.toInt(p.x)).toBe(4);
        expect(fx.toInt(p.y)).toBe(4);
      } else {
        expect(fx.toInt(p.x)).toBe(9);
        expect(fx.toInt(p.y)).toBe(9);
      }
    }
  });

  it('births a BABY (the youngest age class) — not born into an adult trade', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 2, VIKING);
    reproductionSystem(sim.world, ctxOf(sim));
    const [born] = [...sim.world.query(Settler)];
    expect(born).toBeDefined();
    const jobType = sim.world.get(born as Entity, Settler).jobType;
    expect(jobType).toBe(NEWBORN_AGE_CLASS); // baby_female (id 1), not null and not an adult job
    expect(isNonWorkingAge(jobType)).toBe(true); // the JobSystem leaves a baby unemployed
  });

  it('keeps population within housing (the invariant never fires across many ticks)', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 3, VIKING); // capacity 5
    spawnSettler(sim, VIKING); // pre-seed one beyond the births, still under the ceiling
    const inv = populationWithinHousing(sim.content);
    for (let i = 0; i < 20; i++) {
      reproductionSystem(sim.world, ctxOf(sim));
      expect(inv(sim.world)).toEqual([]);
    }
    expect(tribePopulation(sim.world, VIKING)).toBe(5);
  });

  it('the invariant FIRES when population is forced past capacity', () => {
    const sim = new Simulation({ seed: 1, content: reproContent() });
    placeBuilding(sim, 2, VIKING); // capacity 3
    for (let i = 0; i < 5; i++) spawnSettler(sim, VIKING); // 5 settlers, capacity 3 — overpopulated
    const violations = populationWithinHousing(sim.content)(sim.world);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('population 5 exceeds housing capacity 3');
  });
});

describe('age classes — the data-pinned baby/child life stages (logicdefines.inc JOB_TYPE_HUMAN_*)', () => {
  it('classifies the baby/child age-class job ids as non-working', () => {
    expect(isNonWorkingAge(1)).toBe(true); // baby_female
    expect(isNonWorkingAge(2)).toBe(true); // baby_male
    expect(isNonWorkingAge(3)).toBe(true); // child_female
    expect(isNonWorkingAge(4)).toBe(true); // child_male
  });

  it('treats woman (5) and adult trades (6+) as working — only ids 1–4 are non-working', () => {
    expect(isNonWorkingAge(5)).toBe(false); // woman is an adult role the original employs
    expect(isNonWorkingAge(6)).toBe(false); // civilist (the first adult trade)
    expect(isNonWorkingAge(8)).toBe(false); // collector
  });

  it('treats an idle/job-seeking adult (null) as not an age class', () => {
    expect(isNonWorkingAge(null)).toBe(false);
  });

  it('the newborn age class is a baby (the youngest, non-working stage)', () => {
    expect(NEWBORN_AGE_CLASS).toBe(1); // baby_female
    expect(isNonWorkingAge(NEWBORN_AGE_CLASS)).toBe(true);
  });
});
