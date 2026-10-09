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
  seedScenarioPlayers,
  setMissionBehaviour,
  Weapon,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { exportSaveGame, fx, restoreSimulation, Simulation } from '../../src/index.js';
import { attackerWeapon, startAttack } from '../../src/systems/conflict/weapons.js';
import type { MissionPass } from '../../src/systems/missions/pass.js';
import { handHumansToPlayer, handPlayerToPlayer } from '../../src/systems/missions/results/ownership.js';
import { spawnScriptedHumans } from '../../src/systems/missions/results/spawn.js';
import { walkStepModifiersOf } from '../../src/systems/movement/walk-cost.js';
import { equipFromStore, unequipWornGood } from '../../src/systems/settlers/atomics/effects/goods/equip.js';
import { takeUpWeaponGood } from '../../src/systems/settlers/atomics/effects/goods/weapon-class.js';
import { createSettler } from '../../src/systems/spawn/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

const WOOD = 32;
const IRON = 33;
const WOOD_GOOD = 901;
const IRON_GOOD = 902;
const TRIBE = 3;
const SCENARIO = 2;

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
        walkStepReduction: { jobType: WOOD, ticks: 2 },
        atomicBindings: [
          { jobType: WOOD, atomicId: 81, animation: 'five_strikes' },
          { jobType: IRON, atomicId: 81, animation: 'one_strike' },
        ],
        unitVariants: [
          {
            jobType: WOOD,
            scenario: false,
            hitpoints: 5000,
            weapon: { tribeType: 1, typeId: 4 },
            animationJobType: IRON,
            graphicsJobType: IRON,
            walkStepReduction: 0,
          },
          { jobType: WOOD, scenario: true, hitpoints: 20000 },
        ],
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: 4,
        id: 'ordinary_spear',
        tribeType: 1,
        jobType: WOOD,
        goodType: WOOD_GOOD,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 2400 },
      },
      {
        typeId: 4,
        id: 'scenario_spear',
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

function fresh() {
  const sim = new Simulation({ seed: 17, content: variantContent() });
  seedScenarioPlayers(sim.world, [SCENARIO]);
  return sim;
}

function spawn(sim: Simulation, owner: number, jobType = WOOD): Entity {
  const e = createSettler(
    sim.world,
    sim.content,
    sim.rng,
    { tribe: TRIBE, jobType, owner, x: owner * 10, y: 0, missionId: 77 },
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
    s.scenario,
  );
  if (held === null) throw new Error('unit has no weapon');
  return held;
}

function passOf(sim: Simulation): MissionPass {
  return {
    world: sim.world,
    ctx: ctxOf(sim),
    script: { missions: [] },
    records: [],
    tick: sim.tick,
    report: () => {},
    reportFailed: () => {},
    checking: new Set(),
    halted: false,
  };
}

describe('unit variants by map slot', () => {
  it('keeps a human, replacement AI and scenario AI distinct in one world, including strike events', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: 1, enabled: true, scripted: false });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: SCENARIO, enabled: true, scripted: false });
    sim.step();
    const units = [spawn(sim, 0), spawn(sim, 1), spawn(sim, SCENARIO)];
    const target = units[0];
    if (target === undefined) throw new Error('target missing');
    for (const [i, e] of units.entries()) {
      const scenario = i === SCENARIO;
      expect(sim.world.get(e, Health).max).toBe(scenario ? 20000 : 5000);
      const weapon = arms(sim, e);
      expect(weapon.maxRange).toBe(scenario ? 3 : 2);
      expect(weapon.weapon.damage['0']).toBe(scenario ? 500 : 2400);
      expect(walkStepModifiersOf(sim.world, e, sim.content, sim.tick).tribeReduction).toBe(scenario ? 2 : 0);
      startAttack(
        sim.world,
        ctxOf(sim),
        sim.world.get(e, Settler),
        e,
        target,
        { damage: weapon.weapon.damage['0'] ?? 0, hitSoundType: undefined },
        weapon.weapon,
      );
      expect(sim.world.get(e, CurrentAtomic)).toMatchObject({
        duration: scenario ? 59 : 27,
        effect: { hitFrames: scenario ? [30, 35, 40, 45, 50] : [12] },
      });
    }
  });

  it('resizes a wounded scenario unit when it exchanges weapons, without a free heal', () => {
    const sim = fresh();
    const dragon = spawn(sim, SCENARIO);
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
    expect(sim.world.get(dragon, Health)).toEqual({ hitpoints: 10000, max: 20000 });
    expect(arms(sim, dragon).maxRange).toBe(3);
    const humanIron = spawn(sim, 0, IRON);
    expect(sim.world.get(humanIron, Health).max).toBe(5000);
    expect(arms(sim, humanIron).weapon.damage['0']).toBe(3800);
  });

  it('refuses class-changing equipment before consuming stock when a mission locks the job', () => {
    const sim = fresh();
    const dragon = spawn(sim, SCENARIO);
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
    expect(sim.world.get(dragon, Health)).toEqual({ hitpoints: 20000, max: 20000 });
    expect(arms(sim, dragon).weapon.damage['0']).toBe(500);
  });

  it('keeps an equipped iron soldier human when a profession command requests the dragon class', () => {
    const sim = fresh();
    const soldier = spawn(sim, SCENARIO);
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
      spawn(sim, 0),
      { damage: 3800, hitSoundType: undefined },
      weapon.weapon,
    );
    expect(sim.world.get(soldier, CurrentAtomic)).toMatchObject({
      duration: 27,
      effect: { hitFrames: [12] },
    });
  });

  it('uses the same variants for mission spawns and individual or whole-player handovers', () => {
    const sim = fresh();
    spawnScriptedHumans(
      passOf(sim),
      {
        opcode: 'SetHuman',
        job: WOOD,
        tribe: TRIBE,
        player: SCENARIO,
        point: { hx: 0, hy: 0 },
        humanId: 77,
        behaviour: 0,
      },
      1,
    );
    const e = [...sim.world.query(Settler)][0];
    if (e === undefined) throw new Error('mission unit missing');
    sim.world.mut(e, Health).hitpoints = 10000;
    handHumansToPlayer(passOf(sim), 77, 0);
    expect(sim.world.get(e, Owner).player).toBe(0);
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: 2500, max: 5000 });
    expect(arms(sim, e).maxRange).toBe(2);
    handPlayerToPlayer(passOf(sim), 0, SCENARIO);
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: 10000, max: 20000 });
    expect(arms(sim, e).maxRange).toBe(3);
  });

  it('retains the map classification in a save and across AI controller changes', () => {
    const sim = fresh();
    const dragon = spawn(sim, SCENARIO);
    const human = spawn(sim, 0);
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
    expect(restored.hashState()).toBe(sim.hashState());
    restored.enqueueSetup({ kind: 'setPlayerAi', player: SCENARIO, enabled: false });
    restored.enqueueSetup({ kind: 'setPlayerAi', player: 0, enabled: true, scripted: false });
    restored.step();
    expect(restored.world.get(dragon, Health).max).toBe(20000);
    expect(restored.world.get(human, Health).max).toBe(5000);
    const later = spawn(restored, SCENARIO);
    expect(restored.world.get(later, Health).max).toBe(20000);
    expect(restored.checkInvariants()).toEqual([]);
  });
});
