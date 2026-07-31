import { describe, expect, it } from 'vitest';
import {
  Carrying,
  Health,
  Position,
  Resource,
  ResourceLayers,
  Settler,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, positionOfNode, Simulation } from '../../../src/index.js';
import { atomicSystem } from '../../../src/systems/index.js';
import { harvestFromNode } from '../../../src/systems/settlers/atomics/effects/goods/harvest.js';
import { testContent } from '../../fixtures/content.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassCellMap } from '../../fixtures/terrain.js';
import { ctxOf, startAtomic } from './support.js';

describe('atomicSystem - hunter kill leaves a harvestable carcass (spawnCarcasses follow-up)', () => {
  const VIKING = 1;
  const HUNTER = 15; // job 15 - JOB_TYPE_HUMAN_HUNTER
  const WOODCUTTER = 1; // a non-hunter trade
  const COW = 13; // lastResort prey, fixture yield: meat(21) ×4
  const DEER = 14; // normal game, fixture yield: meat(21) ×2 + leather(22) ×1 (the layered carcass)
  const WOLVES = 9; // a known animal tribe with NO huntPrey row (not huntable)
  const MEAT = 21;
  const LEATHER = 22;
  const HARVEST_CADAVER = 33;
  const HUNTER_GENERAL_TRACK = 37; // the fixture hunter_general specialization id
  const HUNTER_GENERAL_FACTOR = 200; // its experienceFactor (XP per carcass unit)

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

  it('a TWO-good carcass (deer: meat + leather) is ONE body whose yields interleave as layers', () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const deer = prey(sim, DEER, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: deer, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    // One node where the deer fell (user rule: one body, one decal). The open good is the first unit of
    // the meat-first interleave; the rest is buried as layers (leather, then the second meat).
    expect(carcasses(sim)).toEqual([
      { goodType: MEAT, remaining: 1, harvestAtomic: HARVEST_CADAVER, position: positionOfNode(6, 0) },
    ]);
    const node = [...sim.world.query(Resource)][0];
    if (node === undefined) throw new Error('carcass missing');
    expect(sim.world.get(node, ResourceLayers).layers).toEqual([
      { goodType: LEATHER, amount: 1, harvestAtomic: HARVEST_CADAVER },
      { goodType: MEAT, amount: 1, harvestAtomic: HARVEST_CADAVER },
    ]);
  });

  it('draining a layer re-arms the SAME body as the next good; only the last drain removes it', () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const deer = prey(sim, DEER, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: deer, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    const node = [...sim.world.query(Resource)][0];
    if (node === undefined) throw new Error('carcass missing');

    // Meat, skin, meat off the one body - the alternating cadaver stages (see ResourceLayers).
    for (const expected of [MEAT, LEATHER, MEAT]) {
      expect(sim.world.get(node, Resource).goodType).toBe(expected);
      startAtomic(sim, hunter, { kind: 'harvest', resource: node, goodType: expected }, 1, HARVEST_CADAVER);
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: expected, amount: 1 });
      sim.world.remove(hunter, Carrying); // banked off-screen - the next pluck lifts a different good
    }
    expect(sim.world.isAlive(node)).toBe(false); // the last layer's drain removed the body
    const depleted = sim.events.current().filter((ev) => ev.kind === 'resourceDepleted');
    expect(depleted).toHaveLength(1); // one removal cue - the stage swaps are not depletions
  });

  it("the pluck costs the track's baseRepeatCounter strokes per unit (the extracted 5)", () => {
    // The base fixture's hunter track carries no baseRepeatCounter (single-stroke, like the goldens);
    // grafting the extracted 5 onto it turns each unit into a 5-stroke job with a strike counter.
    const HUNTER_STROKES = 5;
    const base = testContent();
    const content = {
      ...base,
      jobExperience: base.jobExperience.map((t) =>
        t.id === 'hunter_general' ? { ...t, baseRepeatCounter: HUNTER_STROKES } : t,
      ),
    };
    const sim = new Simulation({ seed: 1, content, map: grassCellMap(5, 2) });
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const cow = prey(sim, COW, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    const node = [...sim.world.query(Resource)][0];
    if (node === undefined) throw new Error('carcass missing');

    // Four strokes bank on the node's counter and pluck nothing; the fifth frees the unit.
    for (let stroke = 1; stroke < HUNTER_STROKES; stroke++) {
      startAtomic(sim, hunter, { kind: 'harvest', resource: node, goodType: MEAT }, 1, HARVEST_CADAVER);
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.has(hunter, Carrying)).toBe(false);
      expect(sim.world.get(node, Resource).strikes).toBe(stroke);
    }
    startAtomic(sim, hunter, { kind: 'harvest', resource: node, goodType: MEAT }, 1, HARVEST_CADAVER);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: MEAT, amount: 1 });
    expect(sim.world.get(node, Resource).remaining).toBe(3); // one unit off the cow's four
    expect(sim.world.get(node, Resource).strikes).toBeUndefined(); // a fresh count for the next unit
    // XP counts UNITS, never strokes: five strokes, one unit, one experienceFactor grant.
    expect(sim.world.get(hunter, Settler).experience.get(HUNTER_GENERAL_TRACK)).toBe(HUNTER_GENERAL_FACTOR);
  });

  it('a swing planned against a good the body no longer holds yields NOTHING (the re-arm race)', () => {
    const sim = simWithMap();
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const deer = prey(sim, DEER, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: deer, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    const node = [...sim.world.query(Resource)][0];
    if (node === undefined) throw new Error('carcass missing');

    // A second hunter's in-flight swing lands after the body re-armed to another good: it hit air.
    expect(harvestFromNode(sim.world, ctxOf(sim), hunter, node, LEATHER)).toBe(0);
    expect(sim.world.has(hunter, Carrying)).toBe(false); // nothing minted, nothing transmuted
    expect(sim.world.get(node, Resource)).toMatchObject({ goodType: MEAT, remaining: 1 });
  });

  it("a mastered stroke's overshoot carries into the next unit (the strikes remainder persists)", () => {
    const HUNTER_STROKES = 5;
    const base = testContent();
    const content = {
      ...base,
      jobExperience: base.jobExperience.map((t) =>
        t.id === 'hunter_general' ? { ...t, baseRepeatCounter: HUNTER_STROKES } : t,
      ),
    };
    const sim = new Simulation({ seed: 1, content, map: grassCellMap(5, 2) });
    const hunter = combatant(sim, VIKING, HUNTER, 0, 0);
    const cow = prey(sim, COW, 3, 0, 20);
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, 81);
    atomicSystem(sim.world, ctxOf(sim));
    const node = [...sim.world.query(Resource)][0];
    if (node === undefined) throw new Error('carcass missing');

    // Double swings (gather mastery): 2, 4 bank; 6 crosses 5 - the unit frees and 1 stroke carries over.
    expect(harvestFromNode(sim.world, ctxOf(sim), hunter, node, MEAT, 2)).toBe(0);
    expect(harvestFromNode(sim.world, ctxOf(sim), hunter, node, MEAT, 2)).toBe(0);
    expect(harvestFromNode(sim.world, ctxOf(sim), hunter, node, MEAT, 2)).toBe(1);
    expect(sim.world.get(hunter, Carrying)).toEqual({ goodType: MEAT, amount: 1 });
    expect(sim.world.get(node, Resource).strikes).toBe(1); // the overshoot, banked toward the next unit
    expect(sim.world.get(node, Resource).remaining).toBe(3);
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
