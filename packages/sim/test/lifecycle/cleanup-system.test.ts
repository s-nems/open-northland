import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  DEFAULT_WORK_FLAG_RADIUS,
  DeliveryFlag,
  Health,
  JobAssignment,
  Position,
  Settler,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, Simulation, fx } from '../../src/index.js';
import { type SystemContext, cleanupSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Unit + integration tests for the CleanupSystem — the death/cleanup half of the combat loop. It
 * destroys every entity whose {@link Health} pool has reached 0 and emits a `settlerDied` event for
 * render/audio. Pairs with the AtomicSystem's `attack` effect (which drains hitpoints): attack drives
 * the pool to 0, cleanup reaps it.
 */

beforeEach(() => {
  Health.store.clear();
  Settler.store.clear();
  Position.store.clear();
  Building.store.clear();
  JobAssignment.store.clear();
  CurrentAtomic.store.clear();
  WorkFlag.store.clear();
  DeliveryFlag.store.clear();
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

describe('cleanupSystem — reaping 0-HP combatants', () => {
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
    sim.world.add(dead, Settler, {
      tribe: 1,
      jobType: 7,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(dead, JobAssignment, { workplace });
    sim.world.add(dead, Health, { hitpoints: 0, max: 1000 });

    cleanupSystem(sim.world, ctxOf(sim));

    // The destroyed entity carried the cross-reference (settler->building), so it leaves no dangling
    // binding — its own components are simply gone.
    expect(sim.world.has(dead, Settler)).toBe(false);
    expect(sim.world.has(dead, Position)).toBe(false);
    expect(sim.world.has(dead, JobAssignment)).toBe(false);
    expect(sim.world.has(dead, Health)).toBe(false);
    expect(sim.world.isAlive(workplace)).toBe(true); // the referenced building is untouched
  });

  it("reaps a dead flag-bound gatherer's drop-off flag along with it (no orphan marker)", () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // A gatherer's flag is a SEPARATE entity it points at (WorkFlag.flag), unlike the settler-owned
    // cross-references above — so reaping the gatherer must also reap the flag, or it orphans on the map.
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

describe('cleanupSystem — end-to-end with attack', () => {
  it('a lethal attack this tick is reaped the same tick (atomic -> cleanup in one step)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Health, { hitpoints: 30, max: 1000 });
    // A 1-tick attack atomic; AtomicSystem applies the hit, CleanupSystem (last in order) reaps it.
    sim.world.add(attacker, CurrentAtomic, {
      atomicId: 81,
      elapsed: 0,
      progress: fx.fromInt(0),
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

describe('cleanupSystem — determinism', () => {
  it('two same-seed runs that kill the same entities reach the same state hash', () => {
    const run = (): string => {
      Health.store.clear();
      const sim = new Simulation({ seed: 9, content: testContent() });
      const survivor = sim.world.create();
      const doomed = sim.world.create();
      sim.world.add(survivor, Health, { hitpoints: 500, max: 500 });
      sim.world.add(doomed, Health, { hitpoints: 5, max: 500 });
      sim.world.add(survivor, Building, { buildingType: 1, tribe: 1, built: ONE, level: 0 });
      sim.world.add(doomed, CurrentAtomic, {
        atomicId: 81,
        elapsed: 0,
        progress: fx.fromInt(0),
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
