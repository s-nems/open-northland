import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  addPerson,
  Building,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  Health,
  JobAssignment,
  Owner,
  Position,
  Resource,
  Settler,
  Stockpile,
  WorkFlag,
  YoungAnimal,
} from '../../src/components/index.js';
import { eventAt } from '../../src/core/events.js';
import type { Entity } from '../../src/ecs/world.js';
import { exportSaveGame, fx, ONE, restoreSimulation, Simulation } from '../../src/index.js';
import { atomicSystem, cleanupSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { startAtomic } from '../settlers/atomic-system/support.js';

/**
 * Unit + integration tests for the CleanupSystem - the death/cleanup half of the combat loop. It
 * destroys every entity whose {@link Health} pool has reached 0 and emits a `settlerDied` event for
 * render/audio. Pairs with the AtomicSystem's `attack` effect (which drains hitpoints): attack drives
 * the pool to 0, cleanup reaps it.
 */

/** Tribe 13 in the fixture content: passive livestock, no job enables - an `isAnimalTribe` tribe. */
const ANIMAL_TRIBE = 13;

// The animal remains fixture: the wolves (9) and the bear (10) are no prey, the cow (13) is (meat 21 x4),
// and the `meat` logic landscape (type 44) shows its `meat pile 01` record (index 215), as decoded.
const WOLVES = 9;
const BEAR = 10;
const COW = 13;
const VIKING = 1;
const HUNTER = 15;
const ATTACK_ATOMIC = 81;
const MEAT = 21;
const MEAT_LANDSCAPE_TYPE = 44;
const MEAT_PILE_GFX = 215;
const REMAINS_MAP = {
  ...grassNodeMap(16, 16),
  landscapes: { types: [{ typeId: MEAT_PILE_GFX, walk: [], build: [], groups: [] }], placements: [] },
};

function remainsContent(cadaverSizes: readonly (readonly [tribe: number, size: number])[]): ContentSet {
  const base = testContent();
  const sizes = new Map(cadaverSizes);
  return parseContentSet({
    ...base,
    animals: base.animals.map((a) => {
      const size = sizes.get(a.tribeType);
      return size === undefined ? a : { ...a, maximumCadaverSize: size };
    }),
    landscape: [
      ...base.landscape,
      { typeId: MEAT_LANDSCAPE_TYPE, id: 'meat', walkable: true, buildable: true },
    ],
    landscapeGfx: [
      ...base.landscapeGfx,
      { index: MEAT_PILE_GFX, editName: 'meat pile 01', logicType: MEAT_LANDSCAPE_TYPE },
    ],
  });
}

/** A wild animal of `tribe` drained to 0 hitpoints at visual cell `(x, 5)`. */
function deadAnimal(sim: Simulation, tribe: number, x: number): Entity {
  const e = settlerAt(sim, { jobType: null, tribe, position: { x: fx.fromInt(x), y: fx.fromInt(5) } });
  sim.world.add(e, Health, { hitpoints: 0, max: 500 });
  return e;
}

describe('cleanupSystem - reaping 0-HP combatants', () => {
  it("leaves a third of a wild animal's cadaver size as meat, at least one, and saves it", () => {
    const content = remainsContent([
      [WOLVES, 12],
      [BEAR, 2],
    ]);
    const sim = new Simulation({ seed: 1, content, map: REMAINS_MAP });
    deadAnimal(sim, WOLVES, 4);
    deadAnimal(sim, BEAR, 6);
    cleanupSystem(sim.world, ctxOf(sim));
    expect(sim.landscapeEdits().added).toMatchObject([
      { typeId: MEAT_PILE_GFX, hx: 9, hy: 10, level: 4 },
      { typeId: MEAT_PILE_GFX, hx: 13, hy: 10, level: 1 },
    ]);
    expect(sim.events.current()).toContainEqual({ kind: 'missionLandscapeChanged' });
    const restored = restoreSimulation(exportSaveGame(sim), { content, map: REMAINS_MAP });
    expect(restored.landscapeEdits().added).toEqual(sim.landscapeEdits().added);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it("halves a young animal's pile after taking the third, down to nothing", () => {
    const content = remainsContent([
      [WOLVES, 12],
      [BEAR, 4],
    ]);
    const sim = new Simulation({ seed: 1, content, map: REMAINS_MAP });
    sim.world.add(deadAnimal(sim, WOLVES, 4), YoungAnimal, { adultAt: 100 });
    sim.world.add(deadAnimal(sim, BEAR, 6), YoungAnimal, { adultAt: 100 });
    cleanupSystem(sim.world, ctxOf(sim));
    expect(sim.landscapeEdits().added).toMatchObject([{ typeId: MEAT_PILE_GFX, hx: 9, hy: 10, level: 2 }]);
  });

  it('lays the pile as a meat heap where the terrain types it as the good on the ground', () => {
    const content = remainsContent([[WOLVES, 12]]);
    const map = {
      ...REMAINS_MAP,
      landscapes: {
        types: [{ typeId: MEAT_PILE_GFX, walk: [], build: [], groups: [], good: { goodId: 'meat' } }],
        placements: [],
      },
    };
    const sim = new Simulation({ seed: 1, content, map });
    deadAnimal(sim, WOLVES, 4);
    cleanupSystem(sim.world, ctxOf(sim));
    const heaps = [...sim.world.query(Stockpile)].map((e) => [...sim.world.get(e, Stockpile).amounts]);
    expect(heaps).toEqual([[[MEAT, 4]]]);
  });

  it("leaves a hunter's kill of huntable prey only its harvestable carcass", () => {
    const sim = new Simulation({ seed: 1, content: remainsContent([[COW, 12]]), map: REMAINS_MAP });
    const hunter = settlerAt(sim, {
      jobType: HUNTER,
      tribe: VIKING,
      position: { x: fx.fromInt(1), y: fx.fromInt(5) },
    });
    const cow = settlerAt(sim, {
      jobType: null,
      tribe: COW,
      position: { x: fx.fromInt(4), y: fx.fromInt(5) },
    });
    sim.world.add(cow, Health, { hitpoints: 20, max: 20 });
    startAtomic(sim, hunter, { kind: 'attack', target: cow, damage: 100 }, 1, ATTACK_ATOMIC);
    atomicSystem(sim.world, ctxOf(sim));
    // Approximation: prey another hand kills leaves nothing, where the original lays meat.
    deadAnimal(sim, COW, 6);
    cleanupSystem(sim.world, ctxOf(sim));
    expect(sim.world.isAlive(cow)).toBe(false);
    expect([...sim.world.query(Resource)].map((e) => sim.world.get(e, Resource).goodType)).toEqual([MEAT]);
    expect(sim.landscapeEdits().added).toEqual([]);
  });

  it('leaves nothing for an animal whose cadaver size is 0', () => {
    const sim = new Simulation({ seed: 1, content: remainsContent([[WOLVES, 0]]), map: REMAINS_MAP });
    deadAnimal(sim, WOLVES, 4);
    cleanupSystem(sim.world, ctxOf(sim));
    expect(sim.landscapeEdits().added).toEqual([]);
    expect(sim.events.current()).not.toContainEqual({ kind: 'missionLandscapeChanged' });
  });

  it('destroys an entity whose hitpoints reached 0 and emits settlerDied', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const dead = sim.world.create();
    sim.world.add(dead, Health, { hitpoints: 0, max: 1000 });
    sim.events.clear();

    cleanupSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(dead)).toBe(false); // reaped
    const evts = sim.events.current().filter((ev) => ev.kind === 'settlerDied');
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ kind: 'settlerDied', entity: dead, cause: 'damage' });
  });

  it('carries the death position + owner on settlerDied (for the cadaver marker + the owner-gated stinger)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const mine = settlerAt(sim, { jobType: null, position: { x: fx.fromInt(6), y: fx.fromInt(4) } });
    sim.world.add(mine, Owner, { player: 0 });
    sim.world.add(mine, Health, { hitpoints: 0, max: 1000 });
    // An unowned wild animal - no Owner, an animal tribe.
    const wild = settlerAt(sim, {
      jobType: null,
      tribe: ANIMAL_TRIBE,
      position: { x: fx.fromInt(2), y: fx.fromInt(9) },
    });
    sim.world.add(wild, Health, { hitpoints: 0, max: 1000 });
    sim.events.clear();

    cleanupSystem(sim.world, ctxOf(sim));

    const evts = sim.events.current().filter((ev) => ev.kind === 'settlerDied');
    const owned = evts.find((ev) => ev.entity === mine);
    const beast = evts.find((ev) => ev.entity === wild);
    expect(owned).toMatchObject({ player: 0, at: eventAt(fx.fromInt(6), fx.fromInt(4)) });
    // The human death has no animal flag (its bones render); the animal one is flagged (no bones).
    expect(owned).not.toHaveProperty('animal');
    expect(beast).toMatchObject({ player: null, animal: true, at: eventAt(fx.fromInt(2), fx.fromInt(9)) });
  });

  it('leaves a living combatant (hitpoints > 0) untouched and emits nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const alive = sim.world.create();
    sim.world.add(alive, Health, { hitpoints: 1, max: 1000 });
    sim.events.clear();

    cleanupSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(alive)).toBe(true);
    expect(sim.world.get(alive, Health).hitpoints).toBe(1);
    expect(sim.events.current().filter((ev) => ev.kind === 'settlerDied')).toHaveLength(0);
  });

  it('reaps a 0-HP entity but spares a healthy one in the same pass', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const dead = sim.world.create();
    const alive = sim.world.create();
    sim.world.add(dead, Health, { hitpoints: 0, max: 500 });
    sim.world.add(alive, Health, { hitpoints: 200, max: 500 });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(dead)).toBe(false);
    expect(sim.world.isAlive(alive)).toBe(true);
  });

  it('removes EVERY component of the reaped entity (its Settler/Position/binding vanish with it)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const workplace = sim.world.create();
    const dead = sim.world.create();
    sim.world.add(dead, Position, { x: fx.fromInt(3), y: fx.fromInt(4) });
    addPerson(sim.world, dead, {
      tribe: 1,
      jobType: 7,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(dead, JobAssignment, { workplace });
    sim.world.add(dead, Health, { hitpoints: 0, max: 1000 });

    cleanupSystem(sim.world, ctxOf(sim));

    // The destroyed entity carried the cross-reference (settler->building), so it leaves no dangling
    // binding - its own components are simply gone.
    expect(sim.world.has(dead, Settler)).toBe(false);
    expect(sim.world.has(dead, Position)).toBe(false);
    expect(sim.world.has(dead, JobAssignment)).toBe(false);
    expect(sim.world.has(dead, Health)).toBe(false);
    expect(sim.world.isAlive(workplace)).toBe(true); // the referenced building is untouched
  });

  it("reaps a dead flag-bound gatherer's drop-off flag along with it (no orphan marker)", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A gatherer's flag is a SEPARATE entity it points at (WorkFlag.flag), unlike the settler-owned
    // cross-references above - so reaping the gatherer must also reap the flag, or it orphans on the map.
    const flag = sim.world.create();
    sim.world.add(flag, Position, { x: fx.fromInt(1), y: fx.fromInt(1) });
    sim.world.add(flag, DeliveryFlag, {});
    const gatherer = sim.world.create();
    sim.world.add(gatherer, Health, { hitpoints: 0, max: 1000 });
    sim.world.add(gatherer, WorkFlag, { flag, radius: DEFAULT_WORK_FLAG_RADIUS });

    cleanupSystem(sim.world, ctxOf(sim));

    expect(sim.world.isAlive(gatherer)).toBe(false); // the gatherer reaped …
    expect(sim.world.isAlive(flag)).toBe(false); // … and its now-ownerless flag reaped with it
  });

  it('reaps multiple dead entities in one pass without throwing (mutate-while-scan safety)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ids: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      const e = sim.world.create();
      sim.world.add(e, Health, { hitpoints: 0, max: 100 });
      ids.push(e);
    }
    sim.events.clear();

    expect(() => cleanupSystem(sim.world, ctxOf(sim))).not.toThrow();

    for (const e of ids) expect(sim.world.isAlive(e)).toBe(false);
    expect(sim.events.current().filter((ev) => ev.kind === 'settlerDied')).toHaveLength(5);
  });
});

describe('cleanupSystem - end-to-end with attack', () => {
  it('a lethal attack this tick is reaped the same tick (atomic -> cleanup in one step)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Health, { hitpoints: 30, max: 1000 });
    // A 1-tick attack atomic; AtomicSystem applies the hit, CleanupSystem (last in order) reaps it.
    addCurrentAtomic(sim.world, attacker, {
      atomicId: 81,
      duration: 1,
      effect: { kind: 'attack', target, damage: 100 }, // overkill -> 0 HP
      targetEntity: target,
      targetTile: null,
    });

    sim.step();

    expect(sim.world.isAlive(target)).toBe(false); // dealt 0 HP by attack, reaped by cleanup same tick
    expect(sim.snapshot().events.filter((ev) => ev.kind === 'settlerDied')).toHaveLength(1);
  });
});

describe('cleanupSystem - determinism', () => {
  it('two same-seed runs that kill the same entities reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 9, content: testContent() });
      const survivor = sim.world.create();
      const doomed = sim.world.create();
      sim.world.add(survivor, Health, { hitpoints: 500, max: 500 });
      sim.world.add(doomed, Health, { hitpoints: 5, max: 500 });
      sim.world.add(survivor, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
      addCurrentAtomic(sim.world, doomed, {
        atomicId: 81,
        duration: 1,
        // doomed attacks itself for lethal damage, then cleanup reaps it the same tick.
        effect: { kind: 'attack', target: doomed, damage: 50 },
        targetEntity: doomed,
        targetTile: null,
      });
      sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
