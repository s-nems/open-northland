import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Armor,
  AttackOrder,
  Building,
  CurrentAtomic,
  Health,
  MoveGoal,
  Owner,
  Position,
  Projectile,
  SettlerProgress,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, nodeOfPosition, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { hexNeighboursOf } from '../../src/nav/halfcell.js';
import { FIGHT_EXPERIENCE_TYPE } from '../../src/systems/index.js';
import { ARMOR_MATERIAL } from '../../src/systems/readviews/index.js';
import { addSettlerOfTribe } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Ranged-combat (projectile) tests - the flight half of combat: a bow shot LAUNCHES a projectile entity
 * at the shooter's ATTACK-event (release) frame, the projectile freezes its aim and, where it comes down,
 * strikes whatever enemy stands there (not instantly), and an enemy inside the weapon's dead zone
 * (< minRange) is never shot. The archer is a practised bowman, so its shots land true; the scatter of a
 * novice is covered in `shot-aim.test.ts`.
 *
 * The combatants are UNOWNED and of DIFFERENT tribes (a viking archer vs an unrecorded "frank" - a valid
 * civ enemy, see `mayAttack`), so the fight runs on the legacy tribe-hostility axis with no Stance/advance
 * machinery: the archer stands and shoots, the (unarmed) target stands still. The bow's ATTACK event fires
 * at frame 6 of its length-12 draw, so a swing that STARTED at tick T looses its arrow 6 ticks later.
 */

const VIKING = 1; // a civilization tribe (carries a jobEnables tech edge)
const FRANK = 2; // a different tribe with NO record - a valid civ enemy (not an animal), the target
const ARCHER = 40; // the short-bow soldier job (real jobtypes id) - binds the bow by (tribe, job)
const HERO = 70; // a hero trade, by its `hero` id prefix, carrying the same bow
const HERO_BOW = 21;
const HUT = 2; // a one-node building that covers the node it stands on
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
const BOW_HIT_SOUND = 77; // `soundtype_Hit 0`: the arrow's impact group id on a bare target
const TARGET_HP = 1000; // high enough that one 30-dmg hit leaves the target alive (Health stays present)
const CHAIN = 3; // an armor class whose column the bow lists apart from a bare target's
const BOW_DAMAGE_VS_CHAIN = 12;
const BOW_HIT_SOUND_VS_CHAIN = 88; // the arrow's impact group id on a chain-armored target
const BOW_DAMAGE_VS_HOUSE = 5;
/** An armor class on the chain column whose `blockingValue` takes a whole arrow. */
const PROOF_CHAIN = 4;

/** A same-row shot at the cell 8 tiles east: 16 map points, so a `speed 8` bow flies 16 ticks. */
const SHOT_TILES = 8;
const SHOT_FLIGHT_TICKS = 16;
/** The chord's first step: the shot reaches its aim the tick before it lands, so the chord is split in
 *  one tick fewer than the flight. */
const FIRST_STEP: Fixed = fx.mulDiv(fx.fromInt(SHOT_TILES), fx.fromInt(1), fx.fromInt(SHOT_FLIGHT_TICKS - 1));

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { mod: 'synthetic-projectile-test' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: COIN, id: 'coin' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: ARCHER, id: 'soldier_bow_short' },
      { typeId: HERO, id: 'hero_archer' },
    ],
    buildings: [
      { typeId: 1, id: 'headquarters', kind: 'storage' },
      {
        typeId: HUT,
        id: 'hut',
        kind: 'home',
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 0, dy: 2 } },
      },
    ],
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
        damage: {
          '0': BOW_DAMAGE,
          [CHAIN]: BOW_DAMAGE_VS_CHAIN,
          [ARMOR_MATERIAL.HOUSE]: BOW_DAMAGE_VS_HOUSE,
        },
        hitSounds: { '0': BOW_HIT_SOUND, [CHAIN]: BOW_HIT_SOUND_VS_CHAIN },
      },
      {
        typeId: HERO_BOW,
        id: 'viking_hero_bow',
        tribeType: VIKING,
        jobType: HERO,
        mainType: 6,
        munitionType: ARROW,
        speed: BOW_SPEED,
        minRange: BOW_MIN,
        maxRange: BOW_MAX,
        damage: { '0': BOW_DAMAGE },
      },
    ],
    armor: [
      { typeId: PROOF_CHAIN, id: 'proof_chain', materialType: CHAIN, blockingValue: BOW_DAMAGE_VS_CHAIN },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // The archer's attack atomic (81) binds to a bow draw whose ATTACK event (type 25) sits at the
        // release frame - the projectile is loosed there, not at the draw's completion.
        atomicBindings: [
          { jobType: ARCHER, atomicId: 81, animation: 'viking_bow_attack' },
          { jobType: HERO, atomicId: 81, animation: 'viking_bow_attack' },
        ],
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
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** Ticks and shots enough to see a novice stray: most of its long shots do. */
const AIM_SAMPLE_TICKS = 300;
const AIM_MIN_SHOTS = 5;

/** Hits past which a bowman never scatters: the aim roll tops out at 99, against hits plus 10. */
const MARKSMAN_BOW_HITS = 90;

/** An archer practised enough that every shot lands on its aim. */
function marksmanAt(sim: Simulation, x: number, y: number): Entity {
  const archer = fighterAt(sim, x, y, VIKING, ARCHER);
  sim.world.mut(archer, SettlerProgress).experience.set(FIGHT_EXPERIENCE_TYPE.BOW, MARKSMAN_BOW_HITS);
  return archer;
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
  });

  it('launches a projectile only AT the release frame - none before, and no instant damage', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    const archer = marksmanAt(sim, 0, 0);
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
    marksmanAt(sim, 0, 0);
    fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    expect(sim.world.get(shot, Position).x).toBe(fx.fromInt(0)); // the archer's own cell

    sim.step();
    expect(sim.world.get(shot, Position).x).toBe(FIRST_STEP); // and only now it flies
  });

  it('flies the map points times 8 over its speed, and strikes on that tick', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    marksmanAt(sim, 0, 0);
    const target = fighterAt(sim, SHOT_TILES, 0, FRANK, IDLE);

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    const { launchTick, landTick } = sim.world.get(shot, Projectile);
    expect(landTick - launchTick).toBe(SHOT_FLIGHT_TICKS);
    while (sim.tick < landTick - 1) sim.step();
    expect(sim.world.get(shot, Position).x).toBe(fx.fromInt(SHOT_TILES)); // held at the aim for one snapshot
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
    sim.step();
    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE);
  });
});

describe('projectiles - frozen flight chord + on-contact damage', () => {
  it('travels straight toward the target at the mapped speed (fixed-point, exact on a same-row shot)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    marksmanAt(sim, 0, 0);
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
    expect(sim.world.get(shot, Projectile).aimX).toBe(fx.fromInt(8));
    expect(sim.world.get(shot, Projectile).aimY).toBe(fx.fromInt(0));
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP); // in flight, not yet landed

    sim.step();
    const after = sim.world.get(shot, Position);
    // A due-east shot advances along x and never drifts off the target's row.
    expect(after.x).toBe(fx.add(x0, FIRST_STEP));
    expect(after.y).toBe(y0);
    expect(after.y).toBe(sim.world.get(target, Position).y);
    expect(sim.world.get(shot, Projectile).originX).toBe(fx.fromInt(0)); // origin stays frozen mid-flight
  });

  it('comes down where the target stood and misses a target that stepped away', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 3) });
    marksmanAt(sim, 0, 1);
    const target = fighterAt(sim, 8, 1, FRANK, IDLE);

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    const releaseAim = { x: fx.fromInt(8), y: fx.fromInt(1) };
    expect(sim.world.get(shot, Projectile)).toMatchObject({ aimX: releaseAim.x, aimY: releaseAim.y });

    // A runner cannot bend the arrow: it lands on the release chord's end, where nobody stands any more.
    const moved = sim.world.mut(target, Position);
    moved.x = fx.fromInt(11);
    moved.y = fx.fromInt(2);
    let missedAt: ReturnType<typeof nodeOfPosition> | undefined;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      const event = sim.snapshot().events.find((candidate) => candidate.kind === 'projectileMissed');
      if (event?.kind === 'projectileMissed') missedAt = event.at;
    }

    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
    expect(missedAt).toEqual(nodeOfPosition(releaseAim.x, releaseAim.y));
  });

  it('strikes another enemy standing where it comes down, against its own armor', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 3) });
    marksmanAt(sim, 0, 1);
    const target = fighterAt(sim, 8, 1, FRANK, IDLE);

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    sim.world.mut(target, Position).x = fx.fromInt(11);
    const bystander = fighterAt(sim, 8, 1, FRANK, IDLE);
    sim.world.add(bystander, Armor, { armorClass: CHAIN });
    let soundType: number | undefined;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      const event = sim.snapshot().events.find((candidate) => candidate.kind === 'projectileHit');
      if (event?.kind === 'projectileHit') soundType = event.soundType;
    }

    expect(sim.world.get(bystander, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE_VS_CHAIN);
    expect(soundType).toBe(BOW_HIT_SOUND_VS_CHAIN);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
  });

  it('passes over its own side where it comes down', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 3) });
    const archer = marksmanAt(sim, 0, 1);
    const target = fighterAt(sim, 8, 1, FRANK, IDLE);
    sim.world.add(archer, Owner, { player: 0 });

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    sim.world.mut(target, Position).x = fx.fromInt(11);
    const comrade = fighterAt(sim, 8, 1, VIKING, IDLE);
    sim.world.add(comrade, Owner, { player: 0 });
    let missed = false;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileMissed')) missed = true;
    }

    expect(missed).toBe(true);
    expect(sim.world.get(comrade, Health).hitpoints).toBe(TARGET_HP);
  });

  it('spares an unowned comrade of its own tribe where it comes down', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 3) });
    marksmanAt(sim, 0, 1);
    const target = fighterAt(sim, 8, 1, FRANK, IDLE);

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    sim.world.mut(target, Position).x = fx.fromInt(11);
    const comrade = fighterAt(sim, 8, 1, VIKING, IDLE);
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) sim.step();

    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sim.world.get(comrade, Health).hitpoints).toBe(TARGET_HP);
  });

  it('strikes an enemy building covering the node only when nobody stands there', () => {
    const struck = (bystanding: boolean) => {
      const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 3) });
      const archer = marksmanAt(sim, 0, 1);
      sim.world.add(archer, Owner, { player: 0 });
      const target = fighterAt(sim, 8, 1, FRANK, IDLE);
      sim.world.add(target, Owner, { player: 1 });

      stepToLaunch(sim);
      const shot = shotInFlight(sim);
      // Only this one shot is under test: the archer leaves, and its arrow still lands.
      sim.world.destroy(archer);
      sim.world.mut(target, Position).x = fx.fromInt(11);
      const house = sim.world.create();
      const { aimX, aimY } = sim.world.get(shot, Projectile);
      sim.world.add(house, Position, { x: aimX, y: aimY });
      sim.world.add(house, Building, { buildingType: HUT, tribe: FRANK, built: ONE, level: 0 });
      sim.world.add(house, Health, { hitpoints: TARGET_HP, max: TARGET_HP });
      sim.world.add(house, Owner, { player: 1 });
      const bystander = bystanding ? fighterAt(sim, 0, 0, FRANK, IDLE) : null;
      if (bystander !== null) {
        const at = sim.world.mut(bystander, Position);
        at.x = aimX;
        at.y = aimY;
        sim.world.add(bystander, Owner, { player: 1 });
      }
      let structure = false;
      for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
        sim.step();
        const event = sim.snapshot().events.find((candidate) => candidate.kind === 'projectileHit');
        if (event?.kind === 'projectileHit') structure = event.structure === true;
      }
      return {
        house: sim.world.get(house, Health).hitpoints,
        bystander: bystander === null ? null : sim.world.get(bystander, Health).hitpoints,
        structure,
      };
    };

    const empty = struck(false);
    expect(empty.house).toBe(TARGET_HP - BOW_DAMAGE_VS_HOUSE);
    expect(empty.structure).toBe(true);

    const crowded = struck(true);
    expect(crowded.house).toBe(TARGET_HP);
    expect(crowded.bystander).toBe(TARGET_HP - BOW_DAMAGE);
    expect(crowded.structure).toBe(false);
  });

  it('deals damage only AFTER a multi-tick flight (no instant hit), then the projectile is spent', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    marksmanAt(sim, 0, 0);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const launchTick = sim.tick;
    const shot = shotInFlight(sim);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);

    // Fly it until the blow lands (the target loses health), capturing the impact event and tick.
    let hitTick = -1;
    let hitEvent: { soundType?: number } | undefined;
    for (let i = 0; i < 30 && sim.world.get(target, Health).hitpoints === TARGET_HP; i++) {
      sim.step();
      hitEvent ??= sim.snapshot().events.find((ev) => ev.kind === 'projectileHit');
      if (sim.world.get(target, Health).hitpoints < TARGET_HP) hitTick = sim.tick;
    }

    expect(hitTick).toBeGreaterThan(launchTick + 1); // the arrow spent several ticks in flight - not instant
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE); // the column damage landed, with no experience on an arrow
    // A projectileHit was announced for render/audio, carrying the impact the bow lists for a bare target.
    expect(hitEvent?.soundType).toBe(BOW_HIT_SOUND);
    expect(sim.world.isAlive(shot)).toBe(false); // the spent arrow was destroyed on impact
  });

  it('snapshots the arrow at its aim before resolving contact', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    marksmanAt(sim, 0, 0);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE);

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    for (let i = 0; i < 20 && sim.world.get(shot, Position).x !== fx.fromInt(8); i++) sim.step();

    expect(sim.world.isAlive(shot)).toBe(true);
    expect(sim.world.get(shot, Position)).toEqual({ x: fx.fromInt(8), y: fx.fromInt(0) });
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);

    sim.step();
    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE);
  });
});

describe('projectiles - aim', () => {
  it('a hero shoots true however green, where a novice strays', () => {
    const aims = (jobType: number) => {
      const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 3) });
      fighterAt(sim, 0, 1, VIKING, jobType);
      fighterAt(sim, 9, 1, FRANK, IDLE);
      const seen = new Set<Entity>();
      const offMark: boolean[] = [];
      for (let i = 0; i < AIM_SAMPLE_TICKS; i++) {
        sim.step();
        for (const p of projectiles(sim)) {
          if (seen.has(p)) continue;
          seen.add(p);
          const { aimX, aimY } = sim.world.get(p, Projectile);
          offMark.push(aimX !== fx.fromInt(9) || aimY !== fx.fromInt(1));
        }
      }
      return offMark;
    };

    const hero = aims(HERO);
    expect(hero.length).toBeGreaterThan(AIM_MIN_SHOTS);
    expect(hero.every((off) => !off)).toBe(true);
    expect(aims(ARCHER).some((off) => off)).toBe(true);
  });
});

describe('projectiles - expiry + dead zone', () => {
  it('thuds like a miss when the armor takes the whole arrow', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    const archer = marksmanAt(sim, 0, 0);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE);
    sim.world.add(target, Armor, { armorClass: PROOF_CHAIN });

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    let sawMiss = false;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileHit'))
        throw new Error('a silent hit sounded');
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileMissed')) sawMiss = true;
    }
    expect(sawMiss).toBe(true);
    expect(sim.world.get(target, Health).hitpoints).toBe(TARGET_HP);
    expect(sim.world.get(archer, SettlerProgress).experience.get(FIGHT_EXPERIENCE_TYPE.BOW)).toBe(
      MARKSMAN_BOW_HITS,
    );
  });

  it('comes down in the dirt when its target leaves the world mid-flight', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    marksmanAt(sim, 0, 0);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    sim.world.destroy(target);
    let sawMiss = false;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileMissed')) sawMiss = true;
    }

    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sawMiss).toBe(true);
  });

  it('lands in the dirt where the mark fell, instead of evaporating in mid-air', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 1) });
    marksmanAt(sim, 0, 0);
    const target = fighterAt(sim, 8, 0, FRANK, IDLE); // 16 nodes - in band

    stepToLaunch(sim);
    const shot = shotInFlight(sim);
    // The mark drops (0 hitpoints) with the arrow still well short of it, the way it does when an earlier
    // shot of the same volley kills the man everyone is loosing at.
    sim.world.mut(target, Health).hitpoints = 0;
    sim.step();
    expect(sim.world.isAlive(shot)).toBe(true);

    let sawMiss = false;
    for (let i = 0; i < 20 && sim.world.isAlive(shot); i++) {
      sim.step();
      if (sim.snapshot().events.some((ev) => ev.kind === 'projectileMissed')) sawMiss = true;
    }
    expect(sim.world.isAlive(shot)).toBe(false);
    expect(sawMiss).toBe(true);
    expect(sim.snapshot().events.some((ev) => ev.kind === 'projectileHit')).toBe(false);
  });

  it('does not shoot an enemy inside the bow dead zone (closer than minRange)', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(12, 1) });
    const archer = marksmanAt(sim, 0, 0);
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
      marksmanAt(sim, 0, 0);
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

describe('projectiles - area shots', () => {
  const CATAPULT_DAMAGE = 800;
  const AIM = { hx: 16, hy: 4 } as const;

  /** A catapult stone already in flight from `shooter`, landing on {@link AIM} next tick. */
  function stone(sim: Simulation, shooter: Entity, target: Entity, hitSelf: boolean): Entity {
    const from = sim.world.get(shooter, Position);
    const aim = positionOfNode(AIM.hx, AIM.hy);
    const p = sim.world.create();
    sim.world.add(p, Position, { x: aim.x, y: aim.y });
    sim.world.add(p, Projectile, {
      source: shooter,
      target,
      player: null,
      hitSelf,
      area: true,
      damage: { '0': CATAPULT_DAMAGE },
      hitSounds: {},
      weaponMainType: null,
      missSounds: {},
      munitionType: 2,
      originX: from.x,
      originY: from.y,
      aimX: aim.x,
      aimY: aim.y,
      cover: null,
      launchTick: sim.tick,
      landTick: sim.tick + 1,
      impact: null,
    });
    return p;
  }

  function onNode(sim: Simulation, node: { hx: number; hy: number }, tribe: number): Entity {
    const e = fighterAt(sim, 0, 0, tribe, IDLE);
    sim.world.mut(e, Position).x = positionOfNode(node.hx, node.hy).x;
    sim.world.mut(e, Position).y = positionOfNode(node.hx, node.hy).y;
    return e;
  }

  it('strikes everything on the landing point and its six neighbours, and nothing further', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 6) });
    const shooter = marksmanAt(sim, 0, 0);
    const ring = [AIM, ...hexNeighboursOf(AIM.hx, AIM.hy)].map((node) => onNode(sim, node, FRANK));
    const beyond = onNode(sim, { hx: AIM.hx + 2, hy: AIM.hy }, FRANK);
    const [centre] = ring;
    if (centre === undefined) throw new Error('no centre victim');
    stone(sim, shooter, centre, false);
    sim.step();
    for (const e of ring) expect(sim.world.get(e, Health).hitpoints).toBe(TARGET_HP - CATAPULT_DAMAGE);
    expect(sim.world.get(beyond, Health).hitpoints).toBe(TARGET_HP);
  });

  it('strikes its own side only when the weapon hits itself', () => {
    for (const hitSelf of [false, true]) {
      const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 6) });
      const shooter = marksmanAt(sim, 0, 0);
      const enemy = onNode(sim, AIM, FRANK);
      const comrade = onNode(sim, { hx: AIM.hx + 1, hy: AIM.hy }, VIKING);
      stone(sim, shooter, enemy, hitSelf);
      sim.step();
      expect(sim.world.get(enemy, Health).hitpoints).toBe(TARGET_HP - CATAPULT_DAMAGE);
      expect(sim.world.get(comrade, Health).hitpoints).toBe(
        hitSelf ? TARGET_HP - CATAPULT_DAMAGE : TARGET_HP,
      );
    }
  });
});

describe('projectiles - the first thing on the landing point', () => {
  it('strikes the victim loosed at, else the lowest-id man there, never two', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(24, 6) });
    const shooter = marksmanAt(sim, 0, 0);
    const first = fighterAt(sim, 8, 2, FRANK, IDLE);
    const second = fighterAt(sim, 8, 2, FRANK, IDLE);
    const aim = sim.world.get(first, Position);
    const shot = sim.world.create();
    sim.world.add(shot, Position, { x: aim.x, y: aim.y });
    sim.world.add(shot, Projectile, {
      source: shooter,
      target: second,
      player: null,
      hitSelf: false,
      area: false,
      damage: { '0': BOW_DAMAGE },
      hitSounds: {},
      weaponMainType: null,
      missSounds: {},
      munitionType: ARROW,
      originX: fx.fromInt(0),
      originY: fx.fromInt(0),
      aimX: aim.x,
      aimY: aim.y,
      cover: null,
      launchTick: sim.tick,
      landTick: sim.tick + 1,
      impact: null,
    });
    sim.step();
    expect(sim.world.get(second, Health).hitpoints).toBe(TARGET_HP - BOW_DAMAGE); // the one loosed at
    expect(sim.world.get(first, Health).hitpoints).toBe(TARGET_HP);
  });
});

describe('projectiles - the standoff an archer closes to', () => {
  it('walks in to (2 * max - min) / 2 nodes of a far target, not only to its farthest shot', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(28, 1) });
    const archer = marksmanAt(sim, 0, 0);
    sim.world.add(archer, Owner, { player: 0 });
    const target = fighterAt(sim, 15, 0, FRANK, IDLE); // 30 nodes, past the bow's 20
    sim.world.add(target, Owner, { player: 1 });
    sim.world.add(archer, AttackOrder, { target });
    for (let i = 0; i < 3 && !sim.world.has(archer, MoveGoal); i++) sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapless sim');
    const goal = terrain.coordsOf(sim.world.get(archer, MoveGoal).cell);
    const standoff = (2 * BOW_MAX - BOW_MIN) >> 1;
    expect(Math.abs(nodeOfPosition(fx.fromInt(15), fx.fromInt(0)).hx - goal.x)).toBe(standoff);
  });
});
