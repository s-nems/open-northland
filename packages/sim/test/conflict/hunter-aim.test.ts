import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Frightened, Health, Position, Projectile, Settler, StayPoint } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import {
  HUNTER_BASE_HIT_PCT,
  HUNTER_MASTER_HIT_PCT,
  hunterShotMisses,
} from '../../src/systems/settlers/atomics/effects/combat/hit/aim.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../fixtures/content/index.js';
import { societyContent } from '../fixtures/content/societies.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { COW, DEER, fighterAtNode, HUNTER, VIKING } from './combat-system/support.js';
import { combatantAtNode, P0 } from './stances/support.js';

/**
 * The hunter's AIM model: a hunter's ranged shot misses with a deterministic per-shot roll
 * (`pairHash(tick, shooter)` - outside the RNG stream), at `HUNTER_BASE_HIT_PCT` fresh and saturating
 * at `HUNTER_MASTER_HIT_PCT` with `hunter_general` mastery. A missed arrow still flies - to the aim
 * point frozen at release - and lands in the dirt (`projectileMissed`): no damage, no provocation, no
 * fight XP. Soldiers keep the engine's always-hit reading.
 */

const HUNTER_GENERAL_TRACK = 37; // the fixture hunter_general specialization id
const HUNTER_GENERAL_FACTOR = 200; // its experienceFactor (XP per carcass unit)
const MASTERY_REPEATS = 100; // experienceBonus saturates here
const ROLL_TICKS = 100; // one roll per tick - a full percent-space sweep

/** The fixture content with the hunter's `test_spear` made genuinely RANGED (arrow, bow speed), so the
 *  full swing→launch→flight→miss pipeline runs; every other fixture row is untouched. */
function rangedHunterContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...societyContent,
    ...combatContent,
    weapons: combatContent.weapons.map((w) =>
      w.id === 'test_spear' ? { ...w, munitionType: 1, speed: 8 } : w,
    ),
  });
}

/** Count misses over `ROLL_TICKS` consecutive ticks for a hunter carrying `xp` on its general track. */
function missesOf(sim: Simulation, shooter: Entity, xp: number): number {
  sim.world.mut(shooter, Settler).experience.set(HUNTER_GENERAL_TRACK, xp);
  const ctx = ctxOf(sim);
  let misses = 0;
  for (let tick = 0; tick < ROLL_TICKS; tick++) {
    if (hunterShotMisses(sim.world, { ...ctx, tick }, shooter)) misses++;
  }
  return misses;
}

describe('hunter aim - the deterministic miss roll', () => {
  it('a fresh hunter misses roughly its base rate; mastery drops it to the ceiling rate', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(16, 16) });
    const hunter = fighterAtNode(sim, 8, 8, VIKING, HUNTER);

    const freshMisses = missesOf(sim, hunter, 0);
    const masterMisses = missesOf(sim, hunter, MASTERY_REPEATS * HUNTER_GENERAL_FACTOR);

    // The rolls are a fixed hash sweep, so the counts are exact per build; the bands assert the model
    // (100 - hitPct expected misses) without pinning the hash's sample noise.
    expect(freshMisses).toBeGreaterThanOrEqual(100 - HUNTER_BASE_HIT_PCT - 15);
    expect(freshMisses).toBeLessThanOrEqual(100 - HUNTER_BASE_HIT_PCT + 15);
    expect(masterMisses).toBeGreaterThan(0); // even a master is not an aimbot
    expect(masterMisses).toBeLessThanOrEqual(100 - HUNTER_MASTER_HIT_PCT + 15);
    expect(masterMisses).toBeLessThan(freshMisses); // experience visibly steadies the hand
  });

  it('a woodcutter (non-hunter) never rolls a miss - the engine always-hit reading is preserved', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(16, 16) });
    const woodcutter = fighterAtNode(sim, 8, 8, VIKING, 1);

    expect(missesOf(sim, woodcutter, 0)).toBe(0);
  });
});

describe('hunter aim - the missed arrow', () => {
  it('rests at the bow, flies to the frozen aim point, lands in the dirt, and harms nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(32, 32) });
    const shooter = fighterAtNode(sim, 10, 10, VIKING, null);
    const deer = fighterAtNode(sim, 20, 10, DEER, null);
    const aim = sim.world.get(deer, Position);
    const shot = sim.world.create();
    sim.world.add(shot, Position, positionOfNode(10, 10));
    sim.world.add(shot, Projectile, {
      source: shooter,
      target: deer,
      damage: 70,
      weaponMainType: null,
      hitSoundType: null,
      missSounds: { '1': 78, '2': 79 }, // the bow's `soundtype_NoHit` thuds: 1 water, 2 land
      munitionType: 1,
      speed: 8,
      originX: positionOfNode(10, 10).x,
      originY: positionOfNode(10, 10).y,
      aimX: aim.x,
      aimY: aim.y,
      cover: null, // loosed in the open, not from a garrison
      missAim: { x: aim.x, y: aim.y }, // frozen at "release": exactly where the deer stands
      launchTick: sim.tick + 1, // loosed on the tick the next step runs, which is its rest at the bow
    });

    // The rest guard sits ahead of the miss branch, so a missed shot leaves the bow no earlier than a true one.
    sim.step();
    expect(sim.world.get(shot, Position).x).toBe(positionOfNode(10, 10).x);

    let missed: { missSounds: Readonly<Record<string, number>> } | undefined;
    let sawHit = false;
    for (let i = 0; i < 10 && [...sim.world.query(Projectile)].length > 0; i++) {
      sim.step();
      for (const ev of sim.snapshot().events) {
        if (ev.kind === 'projectileMissed') missed = ev;
        if (ev.kind === 'projectileHit') sawHit = true;
      }
    }

    expect([...sim.world.query(Projectile)]).toHaveLength(0); // the arrow landed and was reaped
    // ... announcing the landing with the bow's per-ground thud table for the audio layer to pick from.
    expect(missed?.missSounds).toEqual({ '1': 78, '2': 79 });
    expect(sawHit).toBe(false); // ... never the impact
    // The deer stands ON the aim point, yet a missed arrow deals nothing - no drain, no provocation.
    expect(sim.world.get(deer, Health).hitpoints).toBe(1000);
  });

  it('a hunting hunter misses some shots yet still lands the kill (the paced hunt)', () => {
    const sim = new Simulation({ seed: 1, content: rangedHunterContent(), map: grassCellMap(64, 64) });
    const hunter = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    // Fully passive prey (no getAngry), so the run isolates the aim model from retaliation.
    const cow = fighterAtNode(sim, 45, 40, COW, null);
    const hunterHp = sim.world.get(hunter, Health).hitpoints;

    // The felled cow is reaped by cleanup the same tick, so "dead" reads as gone-or-drained.
    const cowHp = (): number => sim.world.tryGet(cow, Health)?.hitpoints ?? 0;
    let misses = 0;
    for (let i = 0; i < 900 && cowHp() > 0; i++) {
      sim.step();
      for (const ev of sim.snapshot().events) {
        if (ev.kind === 'projectileMissed') misses++;
      }
    }

    expect(misses).toBeGreaterThan(0); // the hunt visibly costs failed draws
    expect(cowHp()).toBe(0); // yet the kill still lands
    expect(sim.world.get(hunter, Health).hitpoints).toBe(hunterHp); // passive prey never strikes back
  });

  it('a real loosed shot scatters roaming wildlife around its mark (the launch seam)', () => {
    const sim = new Simulation({ seed: 1, content: rangedHunterContent(), map: grassCellMap(64, 64) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');
    combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.IGNORE, { jobType: HUNTER });
    // Roaming wildlife (a StayPoint carrier): the release itself - not the landing - must scare it.
    const cow = fighterAtNode(sim, 45, 40, COW, null);
    sim.world.add(cow, StayPoint, { cell: terrain.nodeAt(45, 40) });

    let guard = 200;
    while (!sim.world.has(cow, Frightened) && guard-- > 0) sim.step();

    expect(sim.world.has(cow, Frightened)).toBe(true); // frightened by the full swing→release pipeline
  });
});
