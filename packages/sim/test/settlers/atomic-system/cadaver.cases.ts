import { describe, expect, it } from 'vitest';
import { Carrying, Health, Position, Resource } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../../src/index.js';
import { atomicSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassCellMap } from '../../fixtures/terrain.js';
import { ctxOf, startAtomic } from './support.js';

describe('atomicSystem - hunter kill leaves a harvestable carcass (spawnCarcasses follow-up)', () => {
  const VIKING = 1;
  const HUNTER = 15; // job 15 - JOB_TYPE_HUMAN_HUNTER
  const WOODCUTTER = 1; // a non-hunter trade
  const COW = 13; // lastResort prey, fixture yield: meat(21) ×4
  const DEER = 14; // normal game, fixture yield: meat(21) ×2 + leather(22) ×1 (the two-node carcass)
  const WOLVES = 9; // a known animal tribe with NO huntPrey row (not huntable)
  const MEAT = 21;
  const LEATHER = 22;
  const HARVEST_CADAVER = 33;

  function simWithMap(): Simulation {
    return new Simulation({ seed: 1, content: testContent(), map: grassCellMap(5, 2) });
  }

  /** A combatant settler of `tribe`/`job` at visual cell (x, y). */
  function combatant(sim: Simulation, tribe: number, job: number | null, x: number, y: number): Entity {
    return settlerAt(sim, { jobType: job, tribe, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
  }

  /** A prey/target animal of `tribe` at visual cell (x, y) with a Health pool of `hp`. */
  function prey(sim: Simulation, tribe: number, x: number, y: number, hp: number): Entity {
    const e = settlerAt(sim, { jobType: null, tribe, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
    sim.world.add(e, Health, { hitpoints: hp, max: hp });
    return e;
  }

  /** Every standing carcass node as `{goodType, remaining, harvestAtomic, position}`, ascending id. */
  function carcasses(sim: Simulation): {
    goodType: number;
    remaining: number;
    harvestAtomic: number;
    position: { x: unknown; y: unknown };
  }[] {
    const out = [];
    for (const e of sim.world.query(Resource, Position)) {
      const r = sim.world.get(e, Resource);
      const p = sim.world.get(e, Position);
      out.push({
        goodType: r.goodType,
        remaining: r.remaining,
        harvestAtomic: r.harvestAtomic,
        position: { x: p.x, y: p.y },
      });
    }
    return out;
  }

  it("a hunter's LETHAL blow on prey leaves its carcass as harvestable nodes, nothing on its back", () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const cow = prey(sim, COW, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, 81); // overkill - lethal
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(0); // felled
    // The cow's carcass: one meat node holding its whole fixture yield, at the node it fell on
    // (visual cell (3,0) → half-cell node (6,0)); the hunter carries nothing off the blow itself.
    expect(carcasses(sim)).toEqual([
      {
        goodType: MEAT,
        remaining: 4,
        harvestAtomic: HARVEST_CADAVER,
        position: positionOfNode(6, 0),
      },
    ]);
    expect(sim.world.has(hunter, Carrying)).toBe(false);
  });

  it('a TWO-good carcass (deer: meat + leather) spreads onto the kill node and its first free neighbour', () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const deer = prey(sim, DEER, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: deer, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    // Meat lands where the deer fell (node (6,0)); leather takes the first free walkable neighbour in
    // canonical N,E,S,W order - N is off-map on row 0, so E: node (7,0).
    expect(carcasses(sim)).toEqual([
      { goodType: MEAT, remaining: 2, harvestAtomic: HARVEST_CADAVER, position: positionOfNode(6, 0) },
      { goodType: LEATHER, remaining: 1, harvestAtomic: HARVEST_CADAVER, position: positionOfNode(7, 0) },
    ]);
  });

  it('a NON-lethal hunter blow leaves no carcass (the kill must fell the prey)', () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const cow = prey(sim, COW, 3, 0, 1000);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 50 }, 1, 81); // survivable
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(950); // wounded, not dead
    expect(carcasses(sim)).toEqual([]); // no carcass while the prey lives
  });

  it('a NON-hunter killing the same prey leaves no carcass (only a hunter fells game for its yield)', () => {
    const sim = simWithMap();
    const woodcutter = combatant(sim, VIKING, WOODCUTTER, 0, 0);
    const cow = prey(sim, COW, 3, 0, 20);
    startAtomic(sim, woodcutter, { kind: 'attack', target: cow, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(cow, Health).hitpoints).toBe(0); // still felled
    expect(carcasses(sim)).toEqual([]); // but no carcass - not a hunter's kill
  });

  it('a hunter felling an animal with NO huntPrey row leaves no carcass (wolves are not game)', () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const wolf = prey(sim, WOLVES, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: wolf, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(wolf, Health).hitpoints).toBe(0);
    expect(carcasses(sim)).toEqual([]); // a wolf is not huntable prey
  });

  it('a MAPLESS kill spawns nothing and does not crash (the fixture-combat guard)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() }); // no map - ctx.terrain undefined
    const hunter = settlerAt(sim, { jobType: HUNTER, tribe: VIKING });
    const e = settlerAt(sim, { jobType: null, tribe: COW });
    sim.world.add(e, Health, { hitpoints: 20, max: 20 });
    startAtomic(sim, hunter, { kind: 'attack', target: e, damage: 100 }, 1, 81);
    expect(() => atomicSystem(sim.world, ctxOf(sim))).not.toThrow();
    expect([...sim.world.query(Resource)]).toEqual([]); // nowhere to fall - nothing spawned
  });
});
