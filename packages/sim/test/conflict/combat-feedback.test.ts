import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, Position } from '../../src/components/index.js';
import { eventAt } from '../../src/core/events.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import type { TerrainMap } from '../../src/index.js';
import { fx, halfCellMapFromCells, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/** A flat grass map wide enough for the reach tests (cells → the sim's 2W×2H half-cell lattice). */
function grassMap(width: number): TerrainMap {
  return halfCellMapFromCells({ width, height: 1, typeIds: new Array(width).fill(0) });
}

/**
 * The combat-feedback SIGNAL: a MELEE blow that CONNECTS emits a `combatHit` (the render/audio blood +
 * impact cue), a swing at AIR emits none. This is the sim half of "a hit that lands draws blood, a whiff
 * draws nothing" — the render layer just consumes the event. The ranged twin (`projectileHit`) is covered
 * by the projectile tests; here we pin the melee `combatHit` and its miss guard.
 */

beforeEach(() => {
  clearComponentStores();
});

/** A 1-tick melee attack atomic (id 81) — AtomicSystem lands the blow the first tick. */
function attack(
  sim: Simulation,
  attacker: number,
  target: number,
  damage: number,
  weaponMainType?: number,
): void {
  sim.world.add(attacker, CurrentAtomic, {
    atomicId: 81,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration: 1,
    effect: { kind: 'attack', target, damage, ...(weaponMainType !== undefined ? { weaponMainType } : {}) },
    targetEntity: target,
    targetTile: null,
  });
}

describe('combatHit — a landed melee blow', () => {
  it('emits combatHit at the victim, carrying the weapon class, on a connecting swing', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(7), y: fx.fromInt(5) });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 }); // survives the blow
    attack(sim, attacker, target, 100, 3); // a sword (mainType 3)

    sim.step();

    const hits = sim.snapshot().events.filter((ev) => ev.kind === 'combatHit');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      target,
      attacker,
      weaponMainType: 3,
      at: eventAt(fx.fromInt(7), fx.fromInt(5)),
    });
  });

  it('emits NO combatHit when the swing strikes air (target has no Health — a miss)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create(); // a non-combatant / vanished target: no Health pool
    sim.world.add(target, Position, { x: fx.fromInt(7), y: fx.fromInt(5) });
    attack(sim, attacker, target, 100);

    sim.step();

    expect(sim.snapshot().events.filter((ev) => ev.kind === 'combatHit')).toHaveLength(0);
  });

  it('still emits combatHit on a LETHAL blow (blood at the kill; bones follow via settlerDied)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(3), y: fx.fromInt(8) });
    sim.world.add(target, Health, { hitpoints: 20, max: 500 });
    attack(sim, attacker, target, 100); // overkill

    sim.step();

    const evts = sim.snapshot().events;
    expect(evts.filter((ev) => ev.kind === 'combatHit')).toHaveLength(1);
    expect(evts.filter((ev) => ev.kind === 'settlerDied')).toHaveLength(1); // reaped same tick
    expect(sim.world.isAlive(target)).toBe(false);
  });
});

describe('combatSwing — the swing swoosh at the strike frame', () => {
  it('emits combatSwing at the attacker on a connecting swing (the audible twin of a bow release)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    sim.world.add(attacker, Position, { x: fx.fromInt(4), y: fx.fromInt(2) });
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(5), y: fx.fromInt(2) });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    attack(sim, attacker, target, 100, 3);

    sim.step();

    const swings = sim.snapshot().events.filter((ev) => ev.kind === 'combatSwing');
    expect(swings).toHaveLength(1);
    expect(swings[0]).toMatchObject({ attacker, at: eventAt(fx.fromInt(4), fx.fromInt(2)) });
  });

  it('still swooshes on a whiff — the blade cut air even though no combatHit lands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24) });
    const attacker = sim.world.create();
    sim.world.add(attacker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    sim.world.add(attacker, CurrentAtomic, {
      atomicId: 81,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'attack', target, damage: 100, maxRange: 2 },
      targetEntity: target,
      targetTile: null,
    });
    sim.world.get(target, Position).x = fx.fromInt(10); // backs out of reach before the blow lands

    sim.step();

    const evts = sim.snapshot().events;
    expect(evts.filter((ev) => ev.kind === 'combatSwing')).toHaveLength(1); // the swing was heard
    expect(evts.filter((ev) => ev.kind === 'combatHit')).toHaveLength(0); // but nothing connected
  });
});

describe('melee whiff — the target stepped out of reach', () => {
  /** Place an attacker and a target adjacent, start a 1-tick melee swing carrying reach `maxRange`, then
   *  optionally shove the target away BEFORE the blow lands — the "enemy backed out of the long swing" case. */
  function swingWithMove(maxRange: number, targetTileAtHit: number) {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(24) });
    const attacker = sim.world.create();
    sim.world.add(attacker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(1), y: fx.fromInt(0) }); // adjacent at swing start
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    sim.world.add(attacker, CurrentAtomic, {
      atomicId: 81,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1,
      effect: { kind: 'attack', target, damage: 100, maxRange },
      targetEntity: target,
      targetTile: null,
    });
    // Where the target is when the blow lands: it may have backed away during the swing.
    sim.world.get(target, Position).x = fx.fromInt(targetTileAtHit);
    sim.step();
    return { sim, target };
  }

  it('lands nothing (no damage, no blood) when the target moved beyond the weapon reach', () => {
    const { sim, target } = swingWithMove(2, 10); // reach 2 nodes; target now ~20 nodes away
    expect(sim.world.get(target, Health).hitpoints).toBe(500); // whiffed
    expect(sim.snapshot().events.filter((ev) => ev.kind === 'combatHit')).toHaveLength(0);
  });

  it('still connects when the target stayed within reach (the control)', () => {
    const { sim, target } = swingWithMove(2, 1); // target held its adjacent tile — in reach
    expect(sim.world.get(target, Health).hitpoints).toBe(400); // took the 100 blow
    expect(sim.snapshot().events.filter((ev) => ev.kind === 'combatHit')).toHaveLength(1);
  });
});
