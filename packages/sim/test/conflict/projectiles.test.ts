import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, Position, Projectile, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../../src/index.js';
import { PROJECTILE_TILES_PER_SPEED_UNIT } from '../../src/systems/index.js';

/**
 * Ranged-combat (projectile) tests — the flight half of combat: a bow shot LAUNCHES a projectile entity
 * at the shooter's ATTACK-event (release) frame, the projectile HOMES on its target and deals damage on
 * CONTACT (not instantly), a lost target makes it EXPIRE, and an enemy inside the weapon's dead zone
 * (< minRange) is never shot. Deterministic: fixed-point straight-line homing, no RNG.
 *
 * The combatants are UNOWNED and of DIFFERENT tribes (a viking archer vs an unrecorded "frank" — a valid
 * civ enemy, see `mayAttack`), so the fight runs on the legacy tribe-hostility axis with no Stance/advance
 * machinery: the archer stands and shoots, the (unarmed) target stands still. The bow's ATTACK event fires
 * at frame 6 of its length-12 draw, so a swing that STARTED at tick T looses its arrow 6 ticks later.
 */

const VIKING = 1; // a civilization tribe (carries a jobEnables tech edge)
const FRANK = 2; // a different tribe with NO record — a valid civ enemy (not an animal), the target
const ARCHER = 40; // the short-bow soldier job (real jobtypes id) — binds the bow by (tribe, job)
const IDLE = 0;
const BOW = 20; // the bow weapon typeId
const COIN = 3; // the good the viking tech edge unlocks (makes VIKING read as a civ, not an animal)
const ARROW = 1; // munitiontype 1 (bow ammo)
const BOW_SPEED = 8; // the real short/long-bow `speed`
const BOW_MIN = 3; // minimumrange — a bow's close-in dead zone
const BOW_MAX = 20; // maximumrange
const BOW_LEN = 12; // the draw animation's length
const RELEASE_FRAME = 6; // the ATTACK event frame (the arrow is loosed here, mid-draw)
const BOW_DAMAGE = 30; // damage vs an unarmored (class-0) target
const TARGET_HP = 1000; // high enough that one 30-dmg hit leaves the target alive (Health stays present)

/** Tiles a `BOW_SPEED` projectile advances per tick — the calibration mapping applied to `speed`. With
 *  the ¼-tile-per-unit constant, `speed 8` = exactly 2 tiles/tick (an integer, so the same-row shot's
 *  arithmetic is exact). */
const BOW_STEP_TILES = fx.toInt(fx.mul(fx.fromInt(BOW_SPEED), PROJECTILE_TILES_PER_SPEED_UNIT));

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  CurrentAtomic.store.clear();
  Projectile.store.clear();
});

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-projectile-test' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: COIN, id: 'coin' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: ARCHER, id: 'archer' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      {
        typeId: BOW,
        id: 'viking_bow',
        tribeType: VIKING,
        jobType: ARCHER,
        mainType: 6, // bow class
        munitionType: ARROW, // ranged marker — makes this a projectile weapon
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
        // release frame — the projectile is loosed there, not at the draw's completion.
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

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(0) };
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
  sim.world.add(e, Settler, {
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

describe('projectiles — launch at the release frame, no instant hit', () => {
  it('the bow is classified ranged and carries its extracted speed (the data seed)', () => {
    const w = content().weapons[0];
    expect(w?.munitionType).toBe(ARROW);
    expect(w?.speed).toBe(BOW_SPEED);
    expect(BOW_STEP_TILES).toBe(2); // speed 8 × ¼ = 2 tiles/tick (the exact-arithmetic mapping)
  });

  it('launches a projectile only AT the release frame — none before, and no instant damage', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    const archer = fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 15, 0, FRANK, IDLE); // dist 15 — inside the 3..20 band, so the archer fires

    // The swing is added on tick 1 (combatSystem) and advances from tick 2; the ATTACK event is frame 6,
    // so the arrow looses on tick 7. Through frame 5 (6 steps) there is no projectile and no damage.
    for (let i = 0; i < RELEASE_FRAME; i++) sim.step();
    expect(projectiles(sim)).toHaveLength(0);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
    expect(sim.world.has(archer, CurrentAtomic)).toBe(true); // the archer is mid-draw

    // One more step crosses the release frame: the arrow is now in flight — but it has NOT landed (it was
    // just loosed at the archer's cell, 15 tiles away), so the target is still at full health. No instant hit.
    sim.step();
    expect(projectiles(sim)).toHaveLength(1);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
  });
});

describe('projectiles — homing flight + on-contact damage', () => {
  it('travels straight toward the target at the mapped speed (fixed-point, exact on a same-row shot)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 15, 0, FRANK, IDLE);

    stepToLaunch(sim);
    const shot = projectiles(sim)[0] as Entity;
    const before = sim.world.get(shot, Position);
    const x0 = before.x;
    const y0 = before.y;
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP); // in flight, not yet landed

    sim.step();
    const after = sim.world.get(shot, Position);
    // A due-east shot advances by exactly BOW_STEP_TILES on x each tick and never drifts off the target's row.
    expect(after.x).toBe(fx.add(x0, fx.fromInt(BOW_STEP_TILES)));
    expect(after.y).toBe(y0);
    expect(after.y).toBe(sim.world.get(target, Position).y);
  });

  it('deals damage only AFTER a multi-tick flight (no instant hit), then the projectile is spent', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 15, 0, FRANK, IDLE);

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

    expect(hitTick).toBeGreaterThan(launchTick + 1); // the arrow spent several ticks in flight — not instant
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE); // step-1 column damage landed
    expect(sawHitEvent).toBe(true); // a projectileHit was announced for render/audio
    expect(projectiles(sim)).toHaveLength(0); // the spent arrow was destroyed on impact
  });
});

describe('projectiles — expiry + dead zone', () => {
  it('expires (no hit, no re-target) when its target dies mid-flight', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 15, 0, FRANK, IDLE);

    stepToLaunch(sim);
    expect(projectiles(sim)).toHaveLength(1);

    // The mark falls (removed from the world) while the arrow is still in the air.
    sim.world.destroy(target);
    sim.step();

    // The homing arrow lost its target: it expires in place — destroyed, no hit event, and (the target
    // being gone) the archer looses nothing new either.
    expect(projectiles(sim)).toHaveLength(0);
    expect(sim.snapshot().events.some((ev) => ev.kind === 'projectileHit')).toBe(false);
    // A few more ticks confirm it stays clear (no re-target, no spurious shot at a dead target).
    for (let i = 0; i < 20; i++) sim.step();
    expect(projectiles(sim)).toHaveLength(0);
  });

  it('does not shoot an enemy inside the bow dead zone (closer than minRange)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(12, 1) });
    const archer = fighterAt(sim, 0, 0, VIKING, ARCHER);
    const target = fighterAt(sim, 2, 0, FRANK, IDLE); // dist 2 < minRange 3 — in the dead zone

    for (let i = 0; i < 20; i++) sim.step();

    expect(sim.world.has(archer, CurrentAtomic)).toBe(false); // no draw was ever started
    expect(projectiles(sim)).toHaveLength(0); // and nothing was loosed
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP); // the target is untouched
  });
});

describe('projectiles — determinism', () => {
  it('two same-seed runs with projectiles active reach the same state hash', () => {
    const run = (): { hash: string; sawProjectile: boolean } => {
      Position.store.clear();
      Settler.store.clear();
      Health.store.clear();
      CurrentAtomic.store.clear();
      Projectile.store.clear();
      const sim = new Simulation({ seed: 9, content: content(), map: grassMap(24, 1) });
      fighterAt(sim, 0, 0, VIKING, ARCHER);
      fighterAt(sim, 15, 0, FRANK, IDLE, 90); // frail — dies under the volley, exercising the death path too
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
