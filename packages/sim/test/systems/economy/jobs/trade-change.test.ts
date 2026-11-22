import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Equipment,
  EquipOrder,
  MISSION_BEHAVIOUR,
  Settler,
  Stockpile,
  setMissionBehaviour,
  Weapon,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { attackerWeapon, startAttack } from '../../../../src/systems/conflict/weapons.js';
import { applyTradeChange } from '../../../../src/systems/economy/jobs/trade-change.js';
import { equipFromStore } from '../../../../src/systems/settlers/atomics/effects/goods/equip.js';
import { takeUpWeaponGood } from '../../../../src/systems/settlers/atomics/effects/goods/weapon-class.js';
import { createSettler } from '../../../../src/systems/spawn/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';

const WOOD = 32;
const IRON = 33;
/** The fixture's woodcutter, a civilian trade. */
const WOODCUTTER = 1;
const WOOD_GOOD = 901;
const IRON_GOOD = 902;
const TRIBE = 3;
const PLAYER = 0;
const STRIKE_ATOMIC = 81;
const STRIKE_EVENT = 25;

/** Two spear classes of one tribe, told apart by their weapon good, reach and swing. */
function spearContent() {
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
        id: 'spear_test',
        atomicBindings: [
          { jobType: WOOD, atomicId: STRIKE_ATOMIC, animation: 'five_strikes' },
          { jobType: IRON, atomicId: STRIKE_ATOMIC, animation: 'one_strike' },
        ],
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: 4,
        id: 'wooden_spear',
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
        events: [30, 35, 40, 45, 50].map((at) => ({ at, type: STRIKE_EVENT })),
      },
      { id: 'one_strike', name: 'one_strike', length: 27, events: [{ at: 12, type: STRIKE_EVENT }] },
    ],
  });
}

function spawn(sim: Simulation, jobType: number): Entity {
  const e = createSettler(
    sim.world,
    sim.content,
    sim.rng,
    { tribe: TRIBE, jobType, owner: PLAYER, x: 0, y: 0, missionId: 77 },
    sim.names,
  );
  if (e === null) throw new Error('unit did not spawn');
  return e;
}

function arms(sim: Simulation, e: Entity) {
  const s = sim.world.get(e, Settler);
  const held = attackerWeapon(ctxOf(sim), s.tribe, s.jobType, sim.world.tryGet(e, Weapon)?.weaponTypeId);
  if (held === null) throw new Error('unit has no weapon');
  return held;
}

describe('trade change - the equipped weapon names the soldier class', () => {
  it('lets a mission-locked soldier change class by his weapon but never leave the band', () => {
    const sim = new Simulation({ seed: 17, content: spearContent() });
    const spearman = spawn(sim, WOOD);
    const store = sim.world.create();
    sim.world.add(store, Stockpile, { amounts: new Map([[IRON_GOOD, 2]]) });
    sim.world.add(spearman, EquipOrder, {
      group: 'weapon',
      slot: 0,
      goodType: IRON_GOOD,
      stage: 'acquire',
      issuer: 'player',
      returnTo: null,
      queued: [],
    });
    setMissionBehaviour(sim.world, spearman, MISSION_BEHAVIOUR.JOB_LOCKED, true);
    equipFromStore(sim.world, ctxOf(sim), spearman, store, IRON_GOOD, 'weapon', 0);
    expect(sim.world.get(store, Stockpile).amounts.get(IRON_GOOD)).toBe(1);
    expect(sim.world.get(spearman, Settler).jobType).toBe(IRON);
    expect(arms(sim, spearman).weapon.damage['0']).toBe(3800);

    applyTradeChange(sim.world, ctxOf(sim), spearman, WOODCUTTER);
    expect(sim.world.get(spearman, Settler).jobType).toBe(IRON);
    expect(sim.world.get(spearman, Equipment).weapon?.goodType).toBe(IRON_GOOD);
  });

  it('keeps an equipped iron soldier in his class when a profession command requests another', () => {
    const sim = new Simulation({ seed: 17, content: spearContent() });
    const soldier = spawn(sim, WOOD);
    sim.world.mut(soldier, Equipment).weapon = { goodType: IRON_GOOD, degreeOfUse: fx.fromInt(0) };
    takeUpWeaponGood(sim.world, ctxOf(sim), soldier, IRON_GOOD);

    sim.enqueueSetup({ kind: 'setJob', entity: soldier, jobType: WOOD });
    sim.step();

    expect(sim.world.get(soldier, Settler).jobType).toBe(IRON);
    expect(sim.world.get(soldier, Equipment).weapon?.goodType).toBe(IRON_GOOD);
    const weapon = arms(sim, soldier);
    expect(weapon.weapon.damage['0']).toBe(3800);
    expect(weapon.maxRange).toBe(2);
    startAttack(
      sim.world,
      ctxOf(sim),
      sim.world.get(soldier, Settler),
      soldier,
      spawn(sim, WOOD),
      { damage: 3800, hitSoundType: undefined },
      weapon.weapon,
    );
    expect(sim.world.get(soldier, CurrentAtomic)).toMatchObject({
      duration: 27,
      effect: { hitFrames: [12] },
    });
  });
});
