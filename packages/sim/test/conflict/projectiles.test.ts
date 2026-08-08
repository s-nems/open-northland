import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, Position, Projectile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { PROJECTILE_TILES_PER_SPEED_UNIT } from '../../src/systems/index.js';
import { addSettlerOfTribe } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Ranged-combat (projectile) tests - the flight half of combat: a bow shot LAUNCHES a projectile entity
 * at the shooter's ATTACK-event (release) frame, the projectile HOMES on its target and deals damage on
 * CONTACT (not instantly), a lost target makes it EXPIRE, and an enemy inside the weapon's dead zone
 * (< minRange) is never shot. Deterministic: fixed-point straight-line homing, no RNG.
 *
 * The combatants are UNOWNED and of DIFFERENT tribes (a viking archer vs an unrecorded "frank" - a valid
 * civ enemy, see `mayAttack`), so the fight runs on the legacy tribe-hostility axis with no Stance/advance
 * machinery: the archer stands and shoots, the (unarmed) target stands still. The bow's ATTACK event fires
 * at frame 6 of its length-12 draw, so a swing that STARTED at tick T looses its arrow 6 ticks later.
 */

const VIKING = 1; // a civilization tribe (carries a jobEnables tech edge)
const FRANK = 2; // a different tribe with NO record - a valid civ enemy (not an animal), the target
const ARCHER = 40; // the short-bow soldier job (real jobtypes id) - binds the bow by (tribe, job)
const IDLE = 0;
const BOW = 20; // the bow weapon typeId
const COIN = 3; // the good the viking tech edge unlocks (makes VIKING read as a civ, not an animal)
const ARROW = 1; // munitiontype 1 (bow ammo)
const BOW_SPEED = 8; // the real short/long-bow `speed`
const BOW_MIN = 3; // minimumrange - a bow's close-in dead zone
const BOW_MAX = 20; // maximumrange
const BOW_LEN = 12; // the draw animation's length
const RELEASE_FRAME = 6; // the ATTACK event frame (the arrow is loosed here, mid-draw)
const BOW_DAMAGE = 30; // damage vs an unarmored (class-0) target
const TARGET_HP = 1000; // high enough that one 30-dmg hit leaves the target alive (Health stays present)

/** Tiles a `BOW_SPEED` projectile advances per tick - the calibration mapping applied to `speed`. With
 *  the ⅛-tile-per-unit constant, `speed 8` = exactly 1 tile/tick (an integer, so the same-row shot's
 *  arithmetic is exact). */
const BOW_STEP_TILES = fx.toInt(fx.mul(fx.fromInt(BOW_SPEED), PROJECTILE_TILES_PER_SPEED_UNIT));

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-projectile-test' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: COIN, id: 'coin' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: ARCHER, id: 'soldier_bow_short' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      {
        typeId: BOW,
        id: 'viking_bow',
        tribeType: VIKING,
        jobType: ARCHER,
        mainType: 6, // bow class
        munitionType: ARROW, // ranged marker - makes this a projectile weapon
        speed: BOW_SPEED,
        minRange: BOW_MIN,
        maxRange: BOW_MAX,
        damage: { '0': BOW_DAMAGE },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // The archer's attack atomic (81) binds to a bow draw whose ATTACK event (type 25) sits at the
        // release frame - the projectile is loosed there, not at the draw's completion.
        atomicBindings: [{ jobType: ARCHER, atomicId: 81, animation: 'viking_bow_attack' }],
        jobEnables: [{ jobType: ARCHER, kind: 'good', targetId: COIN }],
      },
    ],
    atomicAnimations: [
      {
        id: 'viking_bow_attack',
        name: 'viking_bow_attack',
        length: BOW_LEN,
        events: [{ at: RELEASE_FRAME, type: 25 }],
      },
    ],
  });
}

/** A combatant: a settler with a Health pool at (x,y). `tribe`/`jobType` decide its weapon. */
function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number,
  hitpoints = TARGET_HP,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addSettlerOfTribe(sim, e, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** The projectiles currently in flight. */
function projectiles(sim: Simulation): Entity[] {
  return [...sim.world.query(Projectile)];
}

/** Step until a projectile is in flight (or `max` ticks pass, guarding a broken test from hanging). */
function stepToLaunch(sim: Simulation, max = 30): void {
  for (let i = 0; i < max && projectiles(sim).length === 0; i++) sim.step();
}

/** The single shot in flight, failing with the real reason when nothing was ever loosed. */
function shotInFlight(sim: Simulation): Entity {
  const shot = projectiles(sim)[0];
  if (shot === undefined) throw new Error('no projectile in flight');
  return shot;
}

describe('projectiles - launch at the release frame, no instant hit', () => {
  it('the bow is classified ranged and carries its extracted speed (the data seed)', () => {
    const w = content().weapons[0];
    expect(w?.munitionType).toBe(ARROW);
    expect(w?.speed).toBe(BOW_SPEED);
    expect(BOW_STEP_TILES).toBe(1); // speed 8 × ⅛ = 1 tile/tick (the exact-arithmetic mapping)
  });

  it('launches a projectile only AT the release frame - none before, and no instant damage', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    const archer = fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes away - inside the 3..20 band, so the archer fires

    // The swing is added on tick 1 (combatSystem) and advances from tick 2; the ATTACK event is frame 6,
    // so the arrow looses on tick 7. Through frame 5 (6 steps) there is no projectile and no damage.
    for (let i = 0; i < RELEASE_FRAME; i++) sim.step();
    expect(projectiles(sim)).toHaveLength(0);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
    expect(sim.world.has(archer, CurrentAtomic)).toBe(true); // the archer is mid-draw

    // One more step crosses the release frame: the arrow is now in flight - but it has NOT landed (it was
    // just loosed at the archer's cell, 8 tiles away), so the target is still at full health. No instant hit.
    sim.step();
    expect(projectiles(sim)).toHaveLength(1);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
  });

  it('rests at the bow for its launch tick, then advances one step per tick after it', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    expect(sim.world.get(shot, Position).x).toBe(fx.fromInt(0)); // the archer's own cell

    sim.step();
    expect(sim.world.get(shot, Position).x).toBe(fx.fromInt(BOW_STEP_TILES)); // and only now it flies
  });
});

describe('projectiles - homing flight + on-contact damage', () => {
  it('travels straight toward the target at the mapped speed (fixed-point, exact on a same-row shot)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    const before = sim.world.get(shot, Position);
    const x0 = before.x;
    const y0 = before.y;
    // The launch point is frozen on the payload (the render's ballistic-arc chord start) - the ARCHER's
    // cell (0,0), where the shot also still rests on its launch tick.
    expect(sim.world.get(shot, Projectile).originX).toBe(fx.fromInt(0));
    expect(sim.world.get(shot, Projectile).originY).toBe(fx.fromInt(0));
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP); // in flight, not yet landed

    sim.step();
    const after = sim.world.get(shot, Position);
    // A due-east shot advances by exactly BOW_STEP_TILES on x each tick and never drifts off the target's row.
    expect(after.x).toBe(fx.add(x0, fx.fromInt(BOW_STEP_TILES)));
    expect(after.y).toBe(y0);
    expect(after.y).toBe(sim.world.get(target, Position).y);
    expect(sim.world.get(shot, Projectile).originX).toBe(fx.fromInt(0)); // origin stays frozen mid-flight
  });

  it('deals damage only AFTER a multi-tick flight (no instant hit), then the projectile is spent', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const launchTick = sim.tick;
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);

    // Fly it until the blow lands (the target loses health), capturing the impact event and tick.
    let hitTick = -1;
    let sawHitEvent = false;
    for (let i = 0; i < 30 && sim.world.get(target, Health).hitpoints === TARGET_HP; i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileHit')) sawHitEvent = true;
      if (sim.world.get(target, Health).hitpoints < TARGET_HP) hitTick = sim.tick;
    }

    expect(hitTick).toBeGreaterThan(launchTick + 1); // the arrow spent several ticks in flight - not instant
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE); // step-1 column damage landed
    expect(sawHitEvent).toBe(true); // a projectileHit was announced for render/audio
    expect(projectiles(sim)).toHaveLength(0); // the spent arrow was destroyed on impact
  });
});

describe('projectiles - expiry + dead zone', () => {
  it('is destroyed with no hit when its target leaves the world mid-flight', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    expect(projectiles(sim)).toHaveLength(1);

    // The mark is removed outright while the arrow is still in the air - no Position left, so there is
    // nowhere for the shot to come down.
    sim.world.destroy(target);
    sim.step();

    expect(projectiles(sim)).toHaveLength(0);
    expect(sim.snapshot().events.some((ev) => ev.kind === 'projectileHit')).toBe(false);
    // A few more ticks confirm it stays clear (no re-target, no spurious shot at a dead target).
    for (let i = 0; i < 20; i++) sim.step();
    expect(projectiles(sim)).toHaveLength(0);
  });

  it('lands in the dirt where the mark fell, instead of evaporating in mid-air', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    const spot = sim.world.get(target, Position);
    const fell = { x: spot.x, y: spot.y };

    // The mark drops (0 hitpoints) with the arrow still well short of it, the way it does when an earlier
    // shot of the same volley kills the man everyone is loosing at.
    sim.world.mut(target, Health).hitpoints = 0;
    sim.step();

    // The shot stayed in the air, re-frozen onto the spot the mark fell on.
    expect(sim.world.isAlive(shot)).toBe(true);
    expect(sim.world.get(shot, Projectile).missAim).toEqual(fell);

    // It flies the rest of the way and lands there, dealing nothing.
    let sawMiss = false;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileMissed')) sawMiss = true;
    }
    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sawMiss).toBe(true);
    expect(sim.snapshot().events.some((ev) => ev.kind === 'projectileHit')).toBe(false);
  });

  it('settles the aim of a shot still resting at the bow when its mark falls that same tick', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    // Put the shot back at the bow for the NEXT tick and drop the mark on that same tick - the exact
    // overlap a real volley makes, where one arrow lands the kill in the same pass another is loosed in.
    // The cleanupSystem reaps the corpse at the end of that tick, so the aim has to be taken during it.
    sim.world.mut(shot, Projectile).launchTick = sim.tick + 1;
    sim.world.mut(target, Health).hitpoints = 0;
    sim.step();

    expect(sim.world.isAlive(target)).toBe(false); // reaped, so no position is readable any more
    expect(sim.world.isAlive(shot)).toBe(true); // the shot did not evaporate at the bow
    expect(sim.world.get(shot, Projectile).missAim).not.toBeNull();

    let sawMiss = false;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileMissed')) sawMiss = true;
    }
    expect(sawMiss).toBe(true); // it flew on and came down
  });

  it('does not shoot an enemy inside the bow dead zone (closer than minRange)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(12, 1) });
    const archer = fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 1, 0, FRANK, IDLE); // 2 nodes < minRange 3 - in the dead zone

    for (let i = 0; i < 20; i++) sim.step();

    expect(sim.world.has(archer, CurrentAtomic)).toBe(false); // no draw was ever started
    expect(projectiles(sim)).toHaveLength(0); // and nothing was loosed
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP); // the target is untouched
  });
});

describe('projectiles - determinism', () => {
  it('two same-seed runs with projectiles active reach the same state hash', () => {
    const run = (): { hash: string; sawProjectile: boolean } => {
      const sim = new Simulation({ seed: 9, content: content(), map: grassMap(24, 1) });
      fighterAt(sim, 0, 0, VIKING, ARCHER);
      fighterAt(sim, 8, 0, FRANK, IDLE, 90); // frail, in band - dies under the volley, exercising the death path too
      let sawProjectile = false;
      for (let i = 0; i < 60; i++) {
        sim.step();
        if (projectiles(sim).length > 0) sawProjectile = true;
      }
      return { hash: sim.hashState(), sawProjectile };
    };
    const a = run();
    const b = run();
    expect(a.sawProjectile).toBe(true); // the scenario really put arrows in flight (not a vacuous hash)
    expect(a.hash).toBe(b.hash);
  });
});
