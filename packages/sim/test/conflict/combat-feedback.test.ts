import { describe, expect, it } from 'vitest';
import { addCurrentAtomic, Health, Position } from '../../src/components/index.js';
import { eventAt } from '../../src/core/events.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The combat-feedback SIGNAL: a MELEE blow that CONNECTS emits a `combatHit` (the render/audio blood +
 * impact cue), a swing at AIR emits none. This is the sim half of "a hit that lands draws blood, a whiff
 * draws nothing" - the render layer just consumes the event. The ranged twin (`projectileHit`) is covered
 * by the projectile tests; here we pin the melee `combatHit` and its miss guard.
 */

/** The fixture's aggressive animal tribe, which also carries a civilist `setatomic` row. */
const BEAR_TRIBE = 10;

const pos = (x: number, y: number) => ({ x: fx.fromInt(x), y: fx.fromInt(y) });

/** A 1-tick melee attack atomic (id 81) - AtomicSystem lands the blow the first tick. */
function attack(
  sim: Simulation,
  attacker: Entity,
  target: Entity,
  damage: number,
  weaponMainType?: number,
  hitSoundType?: number,
): void {
  addCurrentAtomic(sim.world, attacker, {
    atomicId: 81,
    duration: 1,
    effect: {
      kind: 'attack',
      target,
      damage,
      ...(weaponMainType !== undefined ? { weaponMainType } : {}),
      ...(hitSoundType !== undefined ? { hitSoundType } : {}),
    },
    targetEntity: target,
    targetTile: null,
  });
}

describe('combatHit - a landed melee blow', () => {
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

  it('carries the weapon`s impact sound id when the swing resolved one, and none when it did not', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = sim.world.create();
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(7), y: fx.fromInt(5) });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    attack(sim, attacker, target, 100, 3, 82); // the sword's `soundtype_Hit` for the victim's material
    sim.step();
    expect(sim.snapshot().events.filter((ev) => ev.kind === 'combatHit')[0]).toMatchObject({ soundType: 82 });

    const silent = new Simulation({ seed: 1, content: testContent() });
    const fist = silent.world.create();
    const victim = silent.world.create();
    silent.world.add(victim, Position, { x: fx.fromInt(7), y: fx.fromInt(5) });
    silent.world.add(victim, Health, { hitpoints: 500, max: 500 });
    attack(silent, fist, victim, 100); // a weapon listing no impact for this material lands silently
    silent.step();
    const hit = silent.snapshot().events.find((ev) => ev.kind === 'combatHit');
    expect(hit).toBeDefined();
    expect(hit).not.toHaveProperty('soundType');
  });

  it('emits NO combatHit when the swing strikes air (target has no Health - a miss)', () => {
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

describe('combatSwing - the swing swoosh at the strike frame', () => {
  it('withholds the swoosh from a body whose attack clip sounds its own swing', () => {
    // The woodcutter's `viking_attack` runs 4 ticks and authors `event 2 34 81`, so the clip announces the
    // swing per weapon; a generic swoosh on top of it would ring twice, a tick or two apart.
    const sim = new Simulation({ seed: 1, content: testContent() });
    const attacker = settlerAt(sim, { jobType: 1, position: { x: fx.fromInt(4), y: fx.fromInt(2) } });
    const target = settlerAt(sim, { jobType: 1, position: { x: fx.fromInt(5), y: fx.fromInt(2) } });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    addCurrentAtomic(sim.world, attacker, {
      atomicId: 81,
      duration: 4, // the clip's own length, so its authored frames land where the data put them
      effect: { kind: 'attack', target, damage: 100, weaponMainType: 3 },
      targetEntity: target,
      targetTile: null,
    });

    const evts = [];
    for (let i = 0; i < 4; i++) {
      sim.step();
      evts.push(...sim.snapshot().events);
    }

    expect(evts.filter((ev) => ev.kind === 'combatSwing')).toHaveLength(0);
    expect(evts.filter((ev) => ev.kind === 'atomicSound')).toMatchObject([
      { entity: attacker, soundType: 81 },
    ]);
    expect(evts.filter((ev) => ev.kind === 'combatHit')).toHaveLength(1); // the blow still lands
  });

  it('swooshes for a beast rather than inheriting the civilist body’s punch', () => {
    // The bear's tribe binds atomic 81 under the civilist job too, as the real animal tribes do, and that
    // clip sounds a human fist. Wildlife takes no clip from the human bodies, so the beast falls to the
    // generic swoosh instead of punching like a townsman.
    const sim = new Simulation({ seed: 1, content: testContent() });
    const bear = settlerAt(sim, { jobType: null, tribe: BEAR_TRIBE, position: pos(4, 2) });
    const target = settlerAt(sim, { jobType: 1, position: pos(5, 2) });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    addCurrentAtomic(sim.world, bear, {
      atomicId: 81,
      duration: 4, // the length `viking_attack` runs, so only the body rule can keep the punch away
      effect: { kind: 'attack', target, damage: 10 },
      targetEntity: target,
      targetTile: null,
    });

    const evts = [];
    for (let i = 0; i < 4; i++) {
      sim.step();
      evts.push(...sim.snapshot().events);
    }

    expect(evts.filter((ev) => ev.kind === 'atomicSound')).toHaveLength(0);
    expect(evts.filter((ev) => ev.kind === 'combatSwing')).toHaveLength(1);
  });

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

  it('still swooshes on a whiff - the blade cut air even though no combatHit lands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(24, 1) });
    const attacker = sim.world.create();
    sim.world.add(attacker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    addCurrentAtomic(sim.world, attacker, {
      atomicId: 81,
      duration: 1,
      effect: { kind: 'attack', target, damage: 100, maxRange: 2 },
      targetEntity: target,
      targetTile: null,
    });
    sim.world.mut(target, Position).x = fx.fromInt(10); // backs out of reach before the blow lands

    sim.step();

    const evts = sim.snapshot().events;
    expect(evts.filter((ev) => ev.kind === 'combatSwing')).toHaveLength(1); // the swing was heard
    expect(evts.filter((ev) => ev.kind === 'combatHit')).toHaveLength(0); // but nothing connected
  });
});

describe('melee whiff - the target stepped out of reach', () => {
  /** Place an attacker and a target adjacent, start a 1-tick melee swing carrying reach `maxRange`, then
   *  optionally shove the target away BEFORE the blow lands - the "enemy backed out of the long swing" case. */
  function swingWithMove(maxRange: number, targetTileAtHit: number) {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(24, 1) });
    const attacker = sim.world.create();
    sim.world.add(attacker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    const target = sim.world.create();
    sim.world.add(target, Position, { x: fx.fromInt(1), y: fx.fromInt(0) }); // adjacent at swing start
    sim.world.add(target, Health, { hitpoints: 500, max: 500 });
    addCurrentAtomic(sim.world, attacker, {
      atomicId: 81,
      duration: 1,
      effect: { kind: 'attack', target, damage: 100, maxRange },
      targetEntity: target,
      targetTile: null,
    });
    // Where the target is when the blow lands: it may have backed away during the swing.
    sim.world.mut(target, Position).x = fx.fromInt(targetTileAtHit);
    sim.step();
    return { sim, target };
  }

  it('lands nothing (no damage, no blood) when the target moved beyond the weapon reach', () => {
    const { sim, target } = swingWithMove(2, 10); // reach 2 nodes; target now ~20 nodes away
    expect(sim.world.get(target, Health).hitpoints).toBe(500); // whiffed
    expect(sim.snapshot().events.filter((ev) => ev.kind === 'combatHit')).toHaveLength(0);
  });

  it('still connects when the target stayed within reach (the control)', () => {
    const { sim, target } = swingWithMove(2, 1); // target held its adjacent tile - in reach
    expect(sim.world.get(target, Health).hitpoints).toBe(400); // took the 100 blow
    expect(sim.snapshot().events.filter((ev) => ev.kind === 'combatHit')).toHaveLength(1);
  });
});
