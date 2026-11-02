import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  Equipment,
  EquipOrder,
  Health,
  MISSION_BEHAVIOUR,
  Owner,
  Settler,
  Stockpile,
  setMissionBehaviour,
  Weapon,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { exportSaveGame, fx, restoreSimulation, Simulation } from '../../../src/index.js';
import { attackerWeapon, startAttack } from '../../../src/systems/conflict/weapons.js';
import { changeUnitTribe } from '../../../src/systems/lifecycle/unit-form.js';
import type { MissionPass } from '../../../src/systems/missions/pass.js';
import { handHumansToPlayer, handPlayerToPlayer } from '../../../src/systems/missions/results/ownership.js';
import { spawnScriptedHumans } from '../../../src/systems/missions/results/spawn.js';
import {
  equipFromStore,
  unequipWornGood,
} from '../../../src/systems/settlers/atomics/effects/goods/equip.js';
import { takeUpWeaponGood } from '../../../src/systems/settlers/atomics/effects/goods/weapon-class.js';
import { createSettler, type SettlerSpec, spawnSettler } from '../../../src/systems/spawn/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

const WOOD = 32;
const IRON = 33;
const WOOD_GOOD = 901;
const IRON_GOOD = 902;
const TRIBE = 3;
const OTHER_TRIBE = 1;
const HUMAN = 0;
const MACHINE = 1;

function variantContent() {
  const base = testContent();
  return parseContentSet({
    ...base,
    jobs: [
      ...base.jobs.filter((j) => j.typeId !== WOOD && j.typeId !== IRON),
      { typeId: WOOD, id: 'soldier_spear_wooden' },
      { typeId: IRON, id: 'soldier_spear' },
    ],
    goods: [
      ...base.goods,
      { typeId: WOOD_GOOD, id: 'wooden_weapon' },
      { typeId: IRON_GOOD, id: 'iron_weapon' },
    ],
    tribes: [
      ...base.tribes.filter((t) => t.typeId !== TRIBE),
      {
        typeId: TRIBE,
        id: 'variant_test',
        atomicBindings: [
          { jobType: WOOD, atomicId: 81, animation: 'five_strikes' },
          { jobType: IRON, atomicId: 81, animation: 'one_strike' },
        ],
        unitVariants: [
          {
            jobType: WOOD,
            form: 'human',
            hitpoints: 5000,
            weapon: { tribeType: OTHER_TRIBE, typeId: 4 },
            animationJobType: IRON,
            graphicsJobType: IRON,
          },
          { jobType: WOOD, form: 'native', hitpoints: 20000 },
        ],
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: 4,
        id: 'ordinary_spear',
        tribeType: OTHER_TRIBE,
        jobType: WOOD,
        goodType: WOOD_GOOD,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 2400 },
      },
      {
        typeId: 4,
        id: 'dragon_spear',
        tribeType: TRIBE,
        jobType: WOOD,
        goodType: WOOD_GOOD,
        minRange: 1,
        maxRange: 3,
        damage: { '0': 500 },
      },
      {
        typeId: 5,
        id: 'iron_spear',
        tribeType: TRIBE,
        jobType: IRON,
        goodType: IRON_GOOD,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 3800 },
      },
    ],
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'five_strikes',
        name: 'five_strikes',
        length: 59,
        events: [30, 35, 40, 45, 50].map((at) => ({ at, type: 25 })),
      },
      { id: 'one_strike', name: 'one_strike', length: 27, events: [{ at: 12, type: 25 }] },
    ],
  });
}

/** A world where seat {@link MACHINE} is a computer player and seat {@link HUMAN} a human one. */
function fresh(authoredForm?: 'human') {
  const sim = new Simulation({
    seed: 17,
    content: variantContent(),
    ...(authoredForm === undefined ? {} : { missions: { missions: [], authoredForm } }),
  });
  sim.enqueueSetup({ kind: 'setAiControl', player: MACHINE, enabled: true, mapAiEnabled: false });
  sim.step();
  return sim;
}

function spawn(sim: Simulation, owner: number, spec: Partial<SettlerSpec> = {}): Entity {
  const e = createSettler(
    sim.world,
    sim.content,
    sim.rng,
    { tribe: TRIBE, jobType: WOOD, owner, x: owner * 10, y: 0, missionId: 77, ...spec },
    sim.names,
  );
  if (e === null) throw new Error('unit did not spawn');
  return e;
}

function arms(sim: Simulation, e: Entity) {
  const s = sim.world.get(e, Settler);
  const held = attackerWeapon(
    ctxOf(sim),
    s.tribe,
    s.jobType,
    sim.world.tryGet(e, Weapon)?.weaponTypeId,
    s.humanForm,
  );
  if (held === null) throw new Error('unit has no weapon');
  return held;
}

/** The dragon: the native form's pool, reach, damage and five-strike swing. */
function expectDragon(sim: Simulation, e: Entity): void {
  expect(sim.world.get(e, Settler).humanForm).toBeUndefined();
  expect(sim.world.get(e, Health).max).toBe(20000);
  expect(arms(sim, e).maxRange).toBe(3);
  expect(arms(sim, e).weapon.damage['0']).toBe(500);
}

/** The spearman: the human form's pool and the borrowed ordinary spear. */
function expectSpearman(sim: Simulation, e: Entity): void {
  expect(sim.world.get(e, Settler).humanForm).toBe(true);
  expect(sim.world.get(e, Health).max).toBe(5000);
  expect(arms(sim, e).maxRange).toBe(2);
  expect(arms(sim, e).weapon.damage['0']).toBe(2400);
}

function passOf(sim: Simulation): MissionPass {
  return {
    world: sim.world,
    ctx: ctxOf(sim),
    script: { missions: [] },
    records: [],
    clock: sim.tick,
    report: () => {},
    reportFailed: () => {},
    checking: new Set(),
    halted: false,
  };
}

describe('unit forms', () => {
  it('spawns the native form for every seat and the human form only when asked, strike events included', () => {
    const sim = fresh();
    const dragons = [spawn(sim, HUMAN), spawn(sim, MACHINE)];
    const spearman = spawn(sim, HUMAN, { humanForm: true });
    for (const e of dragons) expectDragon(sim, e);
    expectSpearman(sim, spearman);
    const target = spawn(sim, HUMAN, { jobType: IRON });
    for (const e of [...dragons, spearman]) {
      const weapon = arms(sim, e);
      startAttack(
        sim.world,
        ctxOf(sim),
        sim.world.get(e, Settler),
        e,
        target,
        { damage: weapon.weapon.damage['0'] ?? 0, hitSoundType: undefined },
        weapon.weapon,
      );
      const dragon = e !== spearman;
      expect(sim.world.get(e, CurrentAtomic)).toMatchObject({
        duration: dragon ? 59 : 27,
        effect: { hitFrames: dragon ? [30, 35, 40, 45, 50] : [12] },
      });
    }
  });

  it('gives the human form to a trained unit, under a human and a computer player alike', () => {
    const sim = fresh();
    // Bare hands: a held weapon good would pull a profession order back to its own class.
    const units = [HUMAN, MACHINE].map((owner) => spawn(sim, owner, { equipment: { weapon: null } }));
    for (const e of units) sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: IRON });
    sim.step();
    for (const e of units) {
      expect(sim.world.get(e, Settler).jobType).toBe(IRON);
      expect(sim.world.get(e, Settler).humanForm).toBeUndefined(); // iron has one form, so no flag
      expect(sim.world.get(e, Health).max).toBe(5000);
    }
    for (const e of units) sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: WOOD });
    sim.step();
    for (const e of units) expectSpearman(sim, e);
  });

  it("keeps the form through mission handovers, so a script's dragons stay dragons in the player's hands", () => {
    const sim = fresh();
    spawnScriptedHumans(
      passOf(sim),
      {
        opcode: 'SetHuman',
        job: WOOD,
        tribe: TRIBE,
        player: MACHINE,
        point: { hx: 0, hy: 0 },
        humanId: 77,
        behaviour: 0,
      },
      1,
    );
    const dragon = [...sim.world.query(Settler)][0];
    if (dragon === undefined) throw new Error('mission unit missing');
    sim.world.mut(dragon, Health).hitpoints = 10000;
    handHumansToPlayer(passOf(sim), 77, HUMAN);
    expect(sim.world.get(dragon, Owner).player).toBe(HUMAN);
    expectDragon(sim, dragon);
    expect(sim.world.get(dragon, Health).hitpoints).toBe(10000);
    const spearman = spawn(sim, HUMAN, { humanForm: true, missionId: 78 });
    handPlayerToPlayer(passOf(sim), HUMAN, MACHINE);
    expect(sim.world.get(spearman, Owner).player).toBe(MACHINE);
    expectSpearman(sim, spearman);
    expectDragon(sim, dragon);
  });

  it('spawns a re-tribed spawn line in the human form and moves a converted soldier into it', () => {
    const sim = fresh();
    spawnScriptedHumans(
      passOf(sim),
      {
        opcode: 'SetHuman',
        job: WOOD,
        tribe: TRIBE,
        player: HUMAN,
        point: { hx: 0, hy: 0 },
        humanId: 77,
        behaviour: 0,
        humanForm: true,
      },
      1,
    );
    const scripted = [...sim.world.query(Settler)][0];
    if (scripted === undefined) throw new Error('mission unit missing');
    expectSpearman(sim, scripted);
    const converted = spawn(sim, HUMAN, { tribe: OTHER_TRIBE });
    sim.world.mut(converted, Health).hitpoints = 2500;
    changeUnitTribe(sim.world, sim.content, converted, TRIBE);
    expect(sim.world.get(converted, Settler).tribe).toBe(TRIBE);
    expectSpearman(sim, converted);
    expect(sim.world.get(converted, Health).hitpoints).toBe(2500);
  });

  it('resizes a wounded dragon when it exchanges weapons, without a free heal; retrained, it is a man', () => {
    const sim = fresh();
    const dragon = spawn(sim, MACHINE);
    sim.world.mut(dragon, Health).hitpoints = 10000;
    const equip = (goodType: number) => {
      const equipment = sim.world.mut(dragon, Equipment);
      equipment.weapon = { goodType, degreeOfUse: fx.fromInt(0) };
      takeUpWeaponGood(sim.world, ctxOf(sim), dragon, goodType);
    };
    equip(IRON_GOOD);
    expect(sim.world.get(dragon, Health)).toEqual({ hitpoints: 2500, max: 5000 });
    expect(arms(sim, dragon).weapon.damage['0']).toBe(3800);
    equip(WOOD_GOOD);
    expect(sim.world.get(dragon, Health)).toEqual({ hitpoints: 2500, max: 5000 });
    expectSpearman(sim, dragon);
    const humanIron = spawn(sim, HUMAN, { jobType: IRON });
    expect(sim.world.get(humanIron, Health).max).toBe(5000);
    expect(arms(sim, humanIron).weapon.damage['0']).toBe(3800);
  });

  it('refuses class-changing equipment before consuming stock when a mission locks the job', () => {
    const sim = fresh();
    const dragon = spawn(sim, HUMAN);
    const store = sim.world.create();
    sim.world.add(store, Stockpile, { amounts: new Map([[IRON_GOOD, 2]]) });
    const originalGear = structuredClone(sim.world.get(dragon, Equipment));
    sim.world.add(dragon, EquipOrder, {
      group: 'weapon',
      slot: 0,
      goodType: IRON_GOOD,
      stage: 'acquire',
      issuer: 'player',
      returnTo: null,
      queued: [],
    });
    // The mission can lock the class after the fetch starts but before the pickup lands.
    setMissionBehaviour(sim.world, dragon, MISSION_BEHAVIOUR.JOB_LOCKED, true);
    equipFromStore(sim.world, ctxOf(sim), dragon, store, IRON_GOOD, 'weapon', 0);
    expect(sim.world.get(store, Stockpile).amounts.get(IRON_GOOD)).toBe(2);
    expect(sim.world.get(dragon, Equipment)).toEqual(originalGear);
    expect(sim.world.get(dragon, EquipOrder).stage).toBe('return');
    unequipWornGood(sim.world, ctxOf(sim), dragon, 'weapon', 0, store);
    expect(sim.world.get(dragon, Equipment)).toEqual(originalGear);
    expect(sim.world.has(dragon, Carrying)).toBe(false);
    expect(sim.world.get(dragon, Settler).jobType).toBe(WOOD);
    expectDragon(sim, dragon);
    expect(sim.world.get(dragon, Health).hitpoints).toBe(20000);
  });

  it('keeps an equipped iron soldier human when a profession command requests the dragon class', () => {
    const sim = fresh();
    const soldier = spawn(sim, MACHINE);
    sim.world.mut(soldier, Equipment).weapon = { goodType: IRON_GOOD, degreeOfUse: fx.fromInt(0) };
    takeUpWeaponGood(sim.world, ctxOf(sim), soldier, IRON_GOOD);
    sim.world.mut(soldier, Health).hitpoints = 2500;

    sim.enqueueSetup({ kind: 'setJob', entity: soldier, jobType: WOOD });
    sim.step();

    expect(sim.world.get(soldier, Settler).jobType).toBe(IRON);
    expect(sim.world.get(soldier, Equipment).weapon?.goodType).toBe(IRON_GOOD);
    expect(sim.world.get(soldier, Health).max).toBe(5000);
    expect(sim.world.get(soldier, Health).hitpoints).toBe(2501); // one normal regeneration tick
    const weapon = arms(sim, soldier);
    expect(weapon.weapon.damage['0']).toBe(3800);
    expect(weapon.maxRange).toBe(2);
    startAttack(
      sim.world,
      ctxOf(sim),
      sim.world.get(soldier, Settler),
      soldier,
      spawn(sim, HUMAN),
      { damage: 3800, hitSoundType: undefined },
      weapon.weapon,
    );
    expect(sim.world.get(soldier, CurrentAtomic)).toMatchObject({
      duration: 27,
      effect: { hitFrames: [12] },
    });
  });

  it('spawns the human form on a map whose script says its authored units are men', () => {
    const sim = fresh('human');
    const placed = spawnSettler(sim.world, ctxOf(sim), {
      kind: 'spawnSettler',
      tribe: TRIBE,
      jobType: WOOD,
      owner: MACHINE,
      x: 10,
      y: 0,
    });
    if (placed === null) throw new Error('placement missing');
    expectSpearman(sim, placed);
    spawnScriptedHumans(
      passOf(sim),
      {
        opcode: 'SetHuman',
        job: WOOD,
        tribe: TRIBE,
        player: MACHINE,
        point: { hx: 0, hy: 0 },
        humanId: 77,
        behaviour: 0,
      },
      1,
    );
    const scripted = [...sim.world.query(Settler)].at(-1);
    if (scripted === undefined) throw new Error('mission unit missing');
    expectSpearman(sim, scripted);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      ...(sim.missions === undefined ? {} : { missions: sim.missions }),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    const later = spawnSettler(restored.world, ctxOf(restored), {
      kind: 'spawnSettler',
      tribe: TRIBE,
      jobType: WOOD,
      owner: HUMAN,
      x: 20,
      y: 0,
    });
    if (later === null) throw new Error('later spawn missing');
    expectSpearman(restored, later);
  });

  it('honors an explicit creature spawn on a map authored for human forms', () => {
    const sim = fresh('human');
    const dragon = spawnSettler(sim.world, ctxOf(sim), {
      kind: 'spawnSettler',
      tribe: TRIBE,
      jobType: WOOD,
      owner: HUMAN,
      humanForm: false,
      x: 0,
      y: 0,
    });
    if (dragon === null) throw new Error('creature spawn missing');
    expectDragon(sim, dragon);
  });

  it('retains each form in a save and across controller changes; a later spawn is still native', () => {
    const sim = fresh();
    const dragon = spawn(sim, MACHINE);
    const spearman = spawn(sim, HUMAN, { humanForm: true });
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
    expect(restored.hashState()).toBe(sim.hashState());
    restored.enqueueSetup({ kind: 'setAiControl', player: MACHINE, enabled: false });
    restored.enqueueSetup({ kind: 'setAiControl', player: HUMAN, enabled: true, mapAiEnabled: false });
    restored.step();
    expectDragon(restored, dragon);
    expectSpearman(restored, spearman);
    expectDragon(restored, spawn(restored, MACHINE));
    expect(restored.checkInvariants()).toEqual([]);
  });
});
