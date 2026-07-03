import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import { Armor, CurrentAtomic, Health, Position, Settler } from '../../src/components/index.js';
import type { AtomicEffect } from '../../src/core/commands.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../../src/index.js';
import {
  FIGHT_EXPERIENCE_TYPE,
  type SystemContext,
  WEAPON_MAIN_TYPE,
  atomicSystem,
  combatSystem,
} from '../../src/systems/index.js';

/**
 * Combat cadence + hit-frame + stagger + need-drain + fight-XP — the "make a melee exchange run at the
 * data's cadence" slice (combat rework part 1). The shared fixture's attack animations are length-only
 * (no ATTACK event, no need-drain, no weapon `mainType`), so those tests exercise only the fallback
 * paths; THIS fixture mirrors the real soldier data (`atomicanimations12/atomicanimations.ini` +
 * `weapons.ini`, verified 2026-07-03) — attack animations carrying the `event <frame> 25` ATTACK cue
 * and the `event 2 {1,2} -20`/`-100` need-drains, the AP-asymmetric spear/sword `damagevalue` columns,
 * and the civilian `setatomic 82 "..._attacked"` stagger binding — so the mechanics can be pinned to
 * the exact frames/values the data specifies. Synthetic (no copyrighted bytes), but numerically faithful.
 */

const VIKING = 1;
const SAXON = 2;
const OTHER = 99; // a tribe with NO content record — a valid PvP enemy (not an animal), never fights back

const WOMAN = 5;
const SOLDIER_UNARMED = 31;
const SOLDIER_SPEAR = 33;
const SOLDIER_SWORD_SHORT = 34;
const SOLDIER_SWORD_LONG = 35;
const SOLDIER_SABER = 36;

const CHAIN_CLASS = 3; // armor typeId/material 3
const PLATE_CLASS = 4; // armor typeId/material 4

const ATTACK_ATOMIC = 81;
const ATTACKED_ATOMIC = 82;

// Real weapon damagevalue columns (viking, verified in the extracted IR) — the AP asymmetry the test pins:
// the iron spear is anti-plate (2090 vs plate 4 / 950 vs chain 3); the long sword is anti-chain (the mirror).
const IRON_SPEAR_DAMAGE = { '0': 3800, '1': 1900, '2': 2850, '3': 950, '4': 2090, '6': 200, '7': 500 };
const LONG_SWORD_DAMAGE = { '0': 3800, '1': 1900, '2': 2850, '3': 2090, '4': 950, '6': 200, '7': 500 };
const SHORT_SWORD_DAMAGE = { '0': 1600, '1': 800, '2': 1200, '3': 400, '4': 400, '6': 60, '7': 225 };
const WOMAN_FIST_DAMAGE = { '0': 400, '1': 80, '2': 300, '3': 40, '4': 40, '6': 20, '7': 50 };

const SOLDIER_DRAIN = -20; // soldier swings carry `event 2 1 -20` + `event 2 2 -20`
const WOMAN_DRAIN = -100; // woman/civilist swings carry `event 2 1 -100` + `event 2 2 -100`

/** The REST/HUNGER channel event pair a swing carries, at frame 2 (`event 2 1 <d>` + `event 2 2 <d>`). */
function drainEvents(delta: number): Array<{ at: number; type: number; value: number }> {
  return [
    { at: 2, type: 1, value: delta },
    { at: 2, type: 2, value: delta },
  ];
}

/** A synthetic-but-numerically-faithful soldier combat content: real damage columns, real ATTACK-event
 *  frames, real need-drains, real stagger bindings. Two playable tribes (viking/saxon) so the two-squad
 *  scenario runs a mutual exchange; the saxon mirrors the viking's spear so both sides fight identically. */
function combatCadenceContent(): ContentSet {
  const soldierJobs = [
    SOLDIER_UNARMED,
    SOLDIER_SPEAR,
    SOLDIER_SWORD_SHORT,
    SOLDIER_SWORD_LONG,
    SOLDIER_SABER,
  ];
  // Both tribes bind the same (job → attack animation) rows — the animation names are tribe-agnostic join
  // keys; the per-tribe asymmetry lives in the weapons. The woman alone carries the ATTACKED (82) stagger.
  const bindings = [
    { jobType: WOMAN, atomicId: ATTACK_ATOMIC, animation: 'woman_attack' },
    { jobType: WOMAN, atomicId: ATTACKED_ATOMIC, animation: 'woman_attacked' },
    { jobType: SOLDIER_UNARMED, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_unarmed' },
    { jobType: SOLDIER_SPEAR, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_spear_iron' },
    { jobType: SOLDIER_SWORD_SHORT, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_sword_short' },
    { jobType: SOLDIER_SWORD_LONG, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_sword_long' },
    // The saber attack animation carries NO ATTACK event — the completion-fallback + saber-has-no-fight-XP case.
    { jobType: SOLDIER_SABER, atomicId: ATTACK_ATOMIC, animation: 'soldier_attack_saber' },
  ];
  const weaponsFor = (tribe: number) => [
    {
      typeId: 2,
      id: 'woman_fist',
      tribeType: tribe,
      jobType: WOMAN,
      mainType: WEAPON_MAIN_TYPE.UNARMED,
      minRange: 1,
      maxRange: 1,
      damage: WOMAN_FIST_DAMAGE,
    },
    {
      typeId: 1,
      id: 'fist',
      tribeType: tribe,
      jobType: SOLDIER_UNARMED,
      mainType: WEAPON_MAIN_TYPE.UNARMED,
      minRange: 1,
      maxRange: 1,
      damage: WOMAN_FIST_DAMAGE,
    },
    {
      typeId: 5,
      id: 'iron_spear',
      tribeType: tribe,
      jobType: SOLDIER_SPEAR,
      mainType: WEAPON_MAIN_TYPE.SPEAR,
      minRange: 1,
      maxRange: 2,
      damage: IRON_SPEAR_DAMAGE,
    },
    {
      typeId: 7,
      id: 'short_sword',
      tribeType: tribe,
      jobType: SOLDIER_SWORD_SHORT,
      mainType: WEAPON_MAIN_TYPE.SWORD,
      minRange: 1,
      maxRange: 1,
      damage: SHORT_SWORD_DAMAGE,
    },
    {
      typeId: 8,
      id: 'long_sword',
      tribeType: tribe,
      jobType: SOLDIER_SWORD_LONG,
      mainType: WEAPON_MAIN_TYPE.SWORD,
      minRange: 1,
      maxRange: 2,
      damage: LONG_SWORD_DAMAGE,
    },
    {
      typeId: 10,
      id: 'saber',
      tribeType: tribe,
      jobType: SOLDIER_SABER,
      mainType: WEAPON_MAIN_TYPE.SABER,
      minRange: 1,
      maxRange: 1,
      damage: SHORT_SWORD_DAMAGE,
    },
  ];

  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 35, id: 'chain', classification: { producedInHouse: true } },
      { typeId: 36, id: 'plate', classification: { producedInHouse: true } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
      ...soldierJobs.map((typeId) => ({ typeId, id: `soldier_${typeId}` })),
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' as const }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [...weaponsFor(VIKING), ...weaponsFor(SAXON)],
    armor: [
      { typeId: CHAIN_CLASS, id: 'chain_armor', goodType: 35, materialType: 3, blockingValue: 5 },
      { typeId: PLATE_CLASS, id: 'plate_armor', goodType: 36, materialType: 4, blockingValue: 5 },
    ],
    tribes: [
      // A `jobEnables` edge makes each a civilization (not an animal — isAnimalTribe is false), so the two
      // tribes are mutually hostile through the real `mayAttack` relation. The edge kind is irrelevant here.
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: bindings,
        jobEnables: [{ jobType: SOLDIER_SPEAR, kind: 'house', targetId: 1 }],
      },
      {
        typeId: SAXON,
        id: 'saxon',
        atomicBindings: bindings,
        jobEnables: [{ jobType: SOLDIER_SPEAR, kind: 'house', targetId: 1 }],
      },
    ],
    atomicAnimations: [
      // The ATTACK event frame (type 25) is the exact frame the extracted IR carries for each weapon.
      {
        id: 'soldier_attack_unarmed',
        name: 'soldier_attack_unarmed',
        length: 12,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 6, type: 25 }],
      },
      {
        id: 'soldier_attack_spear_iron',
        name: 'soldier_attack_spear_iron',
        length: 27,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 17, type: 25 }],
      },
      {
        id: 'soldier_attack_sword_short',
        name: 'soldier_attack_sword_short',
        length: 12,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 9, type: 25 }],
      },
      {
        id: 'soldier_attack_sword_long',
        name: 'soldier_attack_sword_long',
        length: 29,
        events: [...drainEvents(SOLDIER_DRAIN), { at: 16, type: 25 }],
      },
      // The saber swing has the drains but NO ATTACK event (type 25) — the completion-fallback case.
      {
        id: 'soldier_attack_saber',
        name: 'soldier_attack_saber',
        length: 12,
        events: [...drainEvents(SOLDIER_DRAIN)],
      },
      {
        id: 'woman_attack',
        name: 'woman_attack',
        length: 16,
        events: [...drainEvents(WOMAN_DRAIN), { at: 6, type: 25 }],
      },
      // The stagger animation: length 50, zero events (purely visual flinch), NOT interruptible.
      { id: 'woman_attacked', name: 'woman_attacked', length: 50, interruptible: false },
    ],
    // The `soldier general` track (type 69) whose experienceFactor is the per-swing fight-XP rate.
    jobExperience: [
      {
        typeId: 69,
        id: 'soldier_general',
        name: 'soldier general',
        jobType: SOLDIER_UNARMED,
        experienceFactor: 1,
      },
    ],
  });
}

function grass(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(0) };
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/** A combatant of `tribe`/`jobType` at (x,y), optionally armored. */
function fighterAt(
  sim: Simulation,
  x: number,
  y: number,
  tribe: number,
  jobType: number | null,
  opts: { hitpoints?: number; armorClass?: number } = {},
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
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints: opts.hitpoints ?? 100_000, max: opts.hitpoints ?? 100_000 });
  if (opts.armorClass !== undefined) sim.world.add(e, Armor, { armorClass: opts.armorClass });
  return e;
}

/** Hand-build a swing (bypassing targeting) so an executor mechanic can be driven in isolation. */
function startSwing(
  sim: Simulation,
  attacker: Entity,
  effect: Omit<Extract<AtomicEffect, { kind: 'attack' }>, 'kind'>,
  duration: number,
  atomicId = ATTACK_ATOMIC,
): void {
  sim.world.add(attacker, CurrentAtomic, {
    atomicId,
    elapsed: 0,
    progress: fx.fromInt(0),
    duration,
    effect: { kind: 'attack', ...effect },
    targetEntity: effect.target,
    targetTile: null,
  });
}

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  Armor.store.clear();
  CurrentAtomic.store.clear();
});

describe('combat damage — armor material column (the AP asymmetry)', () => {
  // A plate-armored (material 4) target takes 2090 from an iron spear and 950 from a long sword — the
  // anti-armor asymmetry from the real weapontypes: the spear is anti-plate, the sword anti-chain.
  const cases = [
    { job: SOLDIER_SPEAR, armor: PLATE_CLASS, expected: 2090, desc: 'iron spear vs plate' },
    { job: SOLDIER_SPEAR, armor: CHAIN_CLASS, expected: 950, desc: 'iron spear vs chain' },
    { job: SOLDIER_SWORD_LONG, armor: PLATE_CLASS, expected: 950, desc: 'long sword vs plate' },
    { job: SOLDIER_SWORD_LONG, armor: CHAIN_CLASS, expected: 2090, desc: 'long sword vs chain' },
  ];
  for (const { job, armor, expected, desc } of cases) {
    it(`${desc} → ${expected} damage (the material column, no blockingValue subtracted)`, () => {
      const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
      const attacker = fighterAt(sim, 0, 0, VIKING, job);
      fighterAt(sim, 1, 0, OTHER, null, { armorClass: armor }); // an armored enemy, one cell away

      combatSystem(sim.world, ctxOf(sim));

      expect(sim.world.get(attacker, CurrentAtomic).effect).toMatchObject({
        kind: 'attack',
        damage: expected,
      });
    });
  }

  it('an unarmored enemy takes the material-0 column (3800 for the iron spear)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    fighterAt(sim, 1, 0, OTHER, null); // no Armor -> material 0
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, CurrentAtomic).effect).toMatchObject({ damage: 3800 });
  });
});

describe('combatSystem — the swing carries the ATTACK-event hit-frame + the weapon class', () => {
  it('stamps hitAt from the animation ATTACK event and weaponMainType from the weapon', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const spearman = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    fighterAt(sim, 1, 0, OTHER, null);
    combatSystem(sim.world, ctxOf(sim));
    // iron spear: ATTACK @17 of the 27-frame swing, weapon class SPEAR.
    expect(sim.world.get(spearman, CurrentAtomic).effect).toMatchObject({
      hitAt: 17,
      weaponMainType: WEAPON_MAIN_TYPE.SPEAR,
    });
    expect(sim.world.get(spearman, CurrentAtomic).duration).toBe(27);
  });

  it('omits hitAt when the attack animation carries no ATTACK event (falls back to completion)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const saberer = fighterAt(sim, 0, 0, VIKING, SOLDIER_SABER); // saber animation has no `event <f> 25`
    fighterAt(sim, 1, 0, OTHER, null);
    combatSystem(sim.world, ctxOf(sim));
    const effect = sim.world.get(saberer, CurrentAtomic).effect;
    expect('hitAt' in effect).toBe(false); // no ATTACK event -> no hitAt -> executor uses completion
    expect(effect).toMatchObject({ weaponMainType: WEAPON_MAIN_TYPE.SABER });
  });
});

describe('atomicSystem — the blow lands at the ATTACK-event frame, not at completion', () => {
  it('drains the target exactly once, at the ATTACK frame mid-animation', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 2090, hitAt: 17 }, 27);

    // Frames 1..16: the swing is winding up — the target is untouched.
    for (let i = 0; i < 16; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000);

    // Frame 17: the blow lands.
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 2090);

    // Frames 18..27 (follow-through): no second hit, and the swing completes at 27 (attacker freed).
    for (let i = 0; i < 10; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 2090); // still one blow only
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false); // completed
  });

  it('falls back to the completion frame when the swing carries no hitAt', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SABER);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 400 }, 4); // no hitAt -> resolve at completion (frame 4)

    for (let i = 0; i < 3; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000); // untouched until the last frame

    atomicSystem(sim.world, ctxOf(sim)); // frame 4 = completion
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 400);
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });
});

describe('atomicSystem — repeating swings at the animation cadence', () => {
  it('a survivor is re-struck one animation-length apart (cadence IS the swing length)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR); // spear: 27-frame swing, ATTACK @17
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 1_000_000 });

    const hitTicks: number[] = [];
    let prevHp = sim.world.get(target, Health).hitpoints;
    for (let tick = 1; tick <= 60; tick++) {
      sim.step();
      const hp = sim.world.get(target, Health).hitpoints;
      if (hp < prevHp) hitTicks.push(tick);
      prevHp = hp;
    }

    expect(hitTicks.length).toBeGreaterThanOrEqual(2);
    // Consecutive blows land exactly one swing (27 ticks) apart — the cadence is the animation length,
    // no invented cooldown.
    expect(hitTicks[1] - hitTicks[0]).toBe(27);
    // Each blow took a full spear-vs-unarmored column (3800) off the pool.
    expect(1_000_000 - sim.world.get(target, Health).hitpoints).toBe(3800 * hitTicks.length);
  });
});

describe('atomicSystem — a struck civilian staggers (data-driven `82` ATTACKED atomic)', () => {
  it('gives a struck woman her 82 flinch (she has the setatomic 82 binding)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const woman = fighterAt(sim, 1, 0, VIKING, WOMAN, { hitpoints: 10_000 }); // survives the blow
    startSwing(sim, attacker, { target: woman, damage: 2090, hitAt: 1 }, 27);

    atomicSystem(sim.world, ctxOf(sim)); // frame 1 = the blow lands

    const flinch = sim.world.get(woman, CurrentAtomic);
    expect(flinch.atomicId).toBe(ATTACKED_ATOMIC); // she is staggering
    expect(flinch.duration).toBe(50); // woman_attacked length
    expect(flinch.effect).toEqual({ kind: 'idle' }); // purely visual — no state mutation
  });

  it('does NOT stagger a struck soldier (no 82 binding for the soldier class)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const soldier = fighterAt(sim, 1, 0, OTHER, SOLDIER_SWORD_SHORT, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target: soldier, damage: 2090, hitAt: 1 }, 27);

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(soldier, CurrentAtomic)).toBe(false); // soldiers don't flinch
  });

  it('does NOT re-stagger a victim already mid-uninterruptible-action', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const woman = fighterAt(sim, 1, 0, VIKING, WOMAN, { hitpoints: 10_000 });
    // The woman is mid-swing (her own attack 81, uninterruptible) — the blow must not cut it short.
    startSwing(sim, woman, { target: attacker, damage: 0 }, 100);
    startSwing(sim, attacker, { target: woman, damage: 2090, hitAt: 1 }, 27);

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(woman, CurrentAtomic).atomicId).toBe(ATTACK_ATOMIC); // still her own swing, not a flinch
    expect(sim.world.get(woman, Health).hitpoints).toBe(10_000 - 2090); // but the blow still landed (damage applies)
  });
});

describe('atomicSystem — the attacker pays the swing need-drain on completion', () => {
  it('a soldier swing drains rest + hunger by the animation deltas (−20 each → same bar rise)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 0, hitAt: 17 }, 27);

    for (let i = 0; i < 27; i++) atomicSystem(sim.world, ctxOf(sim)); // run to completion

    // −20 on the ~10000-unit reserve → +20/10000·ONE on the 0..ONE need bar (the reserve drain raises the need).
    const expected = fx.div(fx.fromInt(20), fx.fromInt(10_000));
    expect(sim.world.get(attacker, Settler).fatigue).toBe(expected);
    expect(sim.world.get(attacker, Settler).hunger).toBe(expected);
  });

  it('a woman swing drains 5× as much (−100 each) — the relative magnitude is faithful', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOMAN);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 0, hitAt: 6 }, 16);

    for (let i = 0; i < 16; i++) atomicSystem(sim.world, ctxOf(sim));

    const soldierRise = fx.div(fx.fromInt(20), fx.fromInt(10_000));
    const womanRise = fx.div(fx.fromInt(100), fx.fromInt(10_000));
    expect(sim.world.get(attacker, Settler).fatigue).toBe(womanRise);
    expect(womanRise).toBe(soldierRise * 5); // a woman's swing costs 5× a soldier's — the data ratio
  });
});

describe('atomicSystem — a damaging swing accrues fight XP into the weapon-class bucket', () => {
  it('a spear swing accrues into the SPEAR fight bucket (the needfor-gate id space)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 2090, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR }, 4);

    atomicSystem(sim.world, ctxOf(sim)); // the blow lands (frame 1) and trains the weapon class

    const xp = sim.world.get(attacker, Settler).experience;
    expect(xp.get(FIGHT_EXPERIENCE_TYPE.SPEAR)).toBe(1); // soldier-general factor 1 per swing
    expect(xp.get(FIGHT_EXPERIENCE_TYPE.SWORD)).toBeUndefined(); // only the spear bucket
  });

  it('maps each weapon class to its fight bucket (sword → SWORD, fist → FIST)', () => {
    const check = (mainType: number, bucket: number): void => {
      Settler.store.clear();
      Health.store.clear();
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
      const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_UNARMED);
      const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
      startSwing(sim, attacker, { target, damage: 100, hitAt: 1, weaponMainType: mainType }, 2);
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(attacker, Settler).experience.get(bucket)).toBe(1);
    };
    check(WEAPON_MAIN_TYPE.SWORD, FIGHT_EXPERIENCE_TYPE.SWORD);
    check(WEAPON_MAIN_TYPE.UNARMED, FIGHT_EXPERIENCE_TYPE.FIST);
  });

  it('trains nothing on a 0-damage swing, and nothing for a class with no fight track (saber)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    // A 0-damage swing (fully-absorbed / missed material) trains nothing.
    startSwing(sim, attacker, { target, damage: 0, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, Settler).experience.size).toBe(0);

    // A saber (no JOB_EXPERIENCE_TYPE_FIGHT_SABER in the data) trains no fight bucket even when it hits.
    startSwing(sim, attacker, { target, damage: 400, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SABER }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, Settler).experience.size).toBe(0);
  });
});

describe('two squads exchange blows at the data cadence (extended headless scenario)', () => {
  function seedSquads(sim: Simulation): { vikings: Entity[]; saxons: Entity[] } {
    // Two spear squads, interleaved within reach, on a small line — each viking has a saxon in range and back.
    const vikings = [
      fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR, { hitpoints: 20_000 }),
      fighterAt(sim, 2, 0, VIKING, SOLDIER_SPEAR, { hitpoints: 20_000 }),
    ];
    const saxons = [
      fighterAt(sim, 1, 0, SAXON, SOLDIER_SPEAR, { hitpoints: 20_000, armorClass: PLATE_CLASS }),
      fighterAt(sim, 3, 0, SAXON, SOLDIER_SPEAR, { hitpoints: 20_000, armorClass: PLATE_CLASS }),
    ];
    return { vikings, saxons };
  }

  it('both squads land blows, accrue fight XP, and tire — through the real step() schedule', () => {
    const sim = new Simulation({ seed: 3, content: combatCadenceContent(), map: grass(4, 1) });
    const { vikings, saxons } = seedSquads(sim);
    for (let i = 0; i < 60; i++) sim.step();

    // Both sides took damage (a mutual exchange), and the plate-armored saxons took the spear's anti-plate
    // column (2090/hit) while the unarmored vikings took the full 3800.
    expect(sim.world.get(saxons[0], Health).hitpoints).toBeLessThan(20_000);
    expect(sim.world.get(vikings[0], Health).hitpoints).toBeLessThan(20_000);
    // A surviving spearman accrued SPEAR fight XP (the needfor-gate bucket) and tired from swinging.
    const anyViking = vikings.find((v) => sim.world.isAlive(v) && sim.world.has(v, Settler));
    if (anyViking !== undefined) {
      expect(
        sim.world.get(anyViking, Settler).experience.get(FIGHT_EXPERIENCE_TYPE.SPEAR) ?? 0,
      ).toBeGreaterThan(0);
      expect(sim.world.get(anyViking, Settler).fatigue).toBeGreaterThan(0);
    }
  });

  it('is deterministic — two same-seed runs of the skirmish reach the same state hash', () => {
    const run = (): string => {
      Position.store.clear();
      Settler.store.clear();
      Health.store.clear();
      Armor.store.clear();
      CurrentAtomic.store.clear();
      const sim = new Simulation({ seed: 7, content: combatCadenceContent(), map: grass(4, 1) });
      seedSquads(sim);
      for (let i = 0; i < 80; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
