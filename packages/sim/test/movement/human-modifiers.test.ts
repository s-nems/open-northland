import { ArmorType, JobType, TribeType, WeaponType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Armor,
  Equipment,
  Obstructed,
  PathFollow,
  Position,
  WalkFacing,
  Weapon,
} from '../../src/components/index.js';
import { exportSaveGame, fx, restoreSimulation, Simulation } from '../../src/index.js';
import { updateObstruction } from '../../src/systems/movement/collision/separation/obstruction.js';
import { nextWalkDirection } from '../../src/systems/movement/turning.js';
import { walkStepModifiersOf } from '../../src/systems/movement/walk-cost.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';
import { followerAt, grassMap, pos, ticksToArrive, waypointAt } from './movement-system/support.js';

describe('human walk modifiers', () => {
  const content = {
    ...testContent(),
    jobs: [
      JobType.parse({ typeId: 101, id: 'baby_male' }),
      JobType.parse({ typeId: 102, id: 'child_female' }),
      JobType.parse({ typeId: 103, id: 'soldier_spear_wooden' }),
      JobType.parse({ typeId: 104, id: 'hero_bjarni' }),
    ],
    tribes: [
      TribeType.parse({ typeId: 201, id: 'restricted', walkStepReduction: { ticks: 2, jobType: 103 } }),
      TribeType.parse({ typeId: 202, id: 'unrestricted', walkStepReduction: { ticks: 2 } }),
    ],
    weapons: [
      WeaponType.parse({ typeId: 1, id: 'light', tribeType: 201, jobType: 103, goodType: 501, weight: 1 }),
      WeaponType.parse({ typeId: 2, id: 'heavy', tribeType: 201, goodType: 501, weight: 4 }),
      WeaponType.parse({ typeId: 2, id: 'other_tribe', tribeType: 202, goodType: 502, weight: 8 }),
    ],
    armor: [ArmorType.parse({ typeId: 1, id: 'chain', goodType: 503, weight: 3 })],
  };

  it('reads age classes by content identity and tribe/job restrictions without fixed numeric ids', () => {
    const sim = new Simulation({ seed: 1, content });
    const modifiers = (tribe: number, jobType: number) => {
      const e = settlerAt(sim, { tribe, jobType });
      return walkStepModifiersOf(sim.world, e, content);
    };
    expect(modifiers(201, 101)).toMatchObject({ age: 'baby', tribeReduction: 0 });
    expect(modifiers(202, 102)).toMatchObject({ age: 'child', tribeReduction: 2 });
    expect(modifiers(201, 103)).toMatchObject({ age: 'adult', tribeReduction: 2, equipmentWeight: 1 });
    expect(modifiers(201, 104)).toMatchObject({ age: 'adult', tribeReduction: 0 });
  });

  it('resolves combined worn weight, tribe-scoped weapons, class fallbacks and hero exemption', () => {
    const sim = new Simulation({ seed: 1, content });
    const e = settlerAt(sim, { tribe: 201, jobType: 103 });
    const weight = () => walkStepModifiersOf(sim.world, e, content).equipmentWeight;
    sim.world.add(e, Weapon, { weaponTypeId: 2 });
    sim.world.add(e, Armor, { armorClass: 1 });
    expect(weight()).toBe(7);
    sim.world.add(e, Equipment, {
      weapon: { goodType: 501, degreeOfUse: fx.fromInt(1) },
      armor: { goodType: 503, degreeOfUse: fx.fromInt(1) },
      boots: null,
      tool: null,
      misc: [null, null, null, null],
    });
    expect(weight()).toBe(7); // explicit weapon class wins; permanent armor still counts at full use
    sim.world.remove(e, Weapon);
    expect(weight()).toBe(4);
    sim.world.mut(e, Equipment).weapon = { goodType: 999, degreeOfUse: fx.fromInt(0) };
    expect(weight()).toBe(3); // unresolved worn good does not resurrect a class default
    const other = settlerAt(sim, { tribe: 202, jobType: 103 });
    sim.world.add(other, Weapon, { weaponTypeId: 2 });
    expect(walkStepModifiersOf(sim.world, other, content).equipmentWeight).toBe(8);
    const hero = settlerAt(sim, { tribe: 201, jobType: 104 });
    sim.world.add(hero, Weapon, { weaponTypeId: 2 });
    sim.world.add(hero, Armor, { armorClass: 1 });
    expect(walkStepModifiersOf(sim.world, hero, content).equipmentWeight).toBe(0);
  });
});

describe('human turning', () => {
  it('keeps a very slow heavy walk out of obstruction but still detects a real blockage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 2) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ]);
    const post = sim.world.create();
    sim.world.mut(e, PathFollow).legCost = 200;
    for (let i = 0; i < 12; i++) {
      sim.world.mut(e, Position).x = fx.fromFloat(i / 400);
      updateObstruction(sim.world, e, true, false, [post], [], new Set());
    }
    expect(sim.world.has(e, PathFollow)).toBe(true);
    expect(sim.world.get(e, Obstructed).reroutes).toBe(0);
    sim.world.mut(e, WalkFacing).target = 3;
    for (let i = 0; i < 5; i++) updateObstruction(sim.world, e, true, false, [post], [], new Set());
    expect(sim.world.has(e, PathFollow)).toBe(true); // holding for a turn is not an obstruction
    sim.world.mut(e, WalkFacing).direction = 3;
    for (let i = 0; i < 4; i++) updateObstruction(sim.world, e, true, false, [post], [], new Set());
    expect(sim.world.has(e, PathFollow)).toBe(false);
    expect(sim.world.get(e, Obstructed).reroutes).toBe(1);
  });
  it.each([false, true])(
    'does not turn diagonally after a nudge (single-stop recovery: %s)',
    (singleStop) => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 2) });
      const e = followerAt(sim, 0, 0, [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
      ]);
      sim.world.mut(e, Position).y = fx.fromFloat(0.001);
      if (singleStop) {
        const pf = sim.world.mut(e, PathFollow);
        pf.waypoints.shift();
        pf.index = 0;
      }
      sim.step();
      expect(sim.world.get(e, WalkFacing)).toEqual({ direction: 0, target: 0 });
    },
  );
  it('uses eight sectors, shortest turns and the original opposite-heading ties', () => {
    expect(nextWalkDirection(0, 3)).toBe(1); // E → W via south
    expect(nextWalkDirection(3, 0)).toBe(2); // W → E via south
    expect(nextWalkDirection(6, 7)).toBe(5); // N → S via east
    expect(nextWalkDirection(7, 6)).toBe(1); // S → N via east
    expect(nextWalkDirection(0, 5)).toBe(5); // wrap around, shortest way
    expect(nextWalkDirection(5, 0)).toBe(0);
    expect(nextWalkDirection(1, 4)).toBe(7); // includes straight south
    expect(nextWalkDirection(4, 1)).toBe(3);
  });

  it('faces the new heading before advancing, holds intermediate turn ticks and retains facing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 2) });
    const e = followerAt(sim, 0, 0, [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
    ]);
    sim.world.remove(e, WalkFacing); // original initial orientation is SW, not the pace fixture's E
    sim.step();
    expect(pos(sim, e).x).toBe(0);
    expect(sim.world.get(e, WalkFacing)).toEqual({ direction: 7, target: 0 });
    sim.step();
    expect(sim.world.get(e, WalkFacing).direction).toBe(1);
    expect(sim.world.get(e, PathFollow).legTicks).toBe(0);
    sim.step();
    expect(sim.world.get(e, WalkFacing).direction).toBe(0);
    expect(pos(sim, e).x).toBe(0.0625);
    sim.step();
    expect(sim.world.get(e, WalkFacing).direction).toBe(0);
    expect(pos(sim, e).x).toBe(0.125);
    expect(ticksToArrive(sim, e)).toBe(6); // 8 move ticks + 2 held turn ticks total
    expect(sim.world.get(e, WalkFacing)).toEqual({ direction: 0, target: 0 });
    sim.world.add(e, PathFollow, {
      waypoints: [waypointAt(sim, 0.5, 0), waypointAt(sim, 0, 0)],
      index: 1,
      legTicks: 0,
      legCost: 0,
    });
    expect(ticksToArrive(sim, e)).toBe(11); // four-sector reversal adds three ticks
  });

  it('restores an in-progress turn and reaches the same final state', () => {
    const content = testContent();
    const map = grassMap(4, 2);
    const sim = new Simulation({ seed: 1, content, map });
    const e = followerAt(sim, 1, 0, [
      { x: 1, y: 0 },
      { x: 0.5, y: 0 },
    ]);
    sim.run(2);
    expect(sim.world.get(e, WalkFacing)).toEqual({ direction: 7, target: 3 });
    const restored = restoreSimulation(exportSaveGame(sim, { mapId: 'turn-test' }), { content, map });
    sim.run(9);
    restored.run(9);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(restored.world.has(e, PathFollow)).toBe(false);
  });
});
