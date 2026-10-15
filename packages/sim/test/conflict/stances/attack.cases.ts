import { describe, expect, it } from 'vitest';
import {
  Building,
  Engagement,
  Health,
  JobAssignment,
  LostWay,
  MoveGoal,
  Owner,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Weapon,
} from '../../../src/components/index.js';
import { fx, ONE } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { hexDistanceBetween, nodeOfPosition, Simulation } from '../../../src/index.js';
import { ATTACK_RETURN_SLACK_NODES } from '../../../src/systems/conflict/chase.js';
import { combatSystem, NEED_DRIVE_THRESHOLD } from '../../../src/systems/index.js';
import { attackUnit, moveUnit, setJob, setStance } from '../../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { spawnSettler } from '../../../src/systems/spawn/index.js';
import { landRider } from '../../../src/systems/vehicles/crew.js';
import { testContent } from '../../fixtures/content.js';
import { setNeeds } from '../../fixtures/settler.js';
import { waterColumnMap } from '../../fixtures/terrain.js';
import { cell, combatant, ctxOf, grassMap, P0, P1, VIKING, WOODCUTTER } from './support.js';

const SOLDIER = 31; // soldier_unarmed
const HERO = 45; // hero_saber_hatschi, the fixture's other fighter class
const HOUSE = 1; // any fixture building type, standing as an attack target
const TEST_AXE = 7; // the fixture's viking weapon, worn so the soldier is armed

/** An armed ATTACK soldier standing on visual cell (x, 0). */
function soldierAt(sim: Simulation, x: number): Entity {
  const e = combatant(sim, x, 0, P0, MILITARY_MODE.ATTACK, { jobType: SOLDIER });
  sim.world.add(e, Weapon, { weaponTypeId: TEST_AXE });
  return e;
}

/** The soldier's anchor, which every case here expects to be set. */
function anchorOf(sim: Simulation, e: Entity): number | null {
  return sim.world.get(e, Stance).anchorCell;
}

describe('ATTACK - a fighter walks back to its own place once the fight is over', () => {
  it('anchors a spawned soldier where it stands, and leaves a civilian without an anchor', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const ctx = ctxOf(sim);
    spawnSettler(sim.world, ctx, {
      kind: 'spawnSettler',
      jobType: SOLDIER,
      x: 2,
      y: 0,
      tribe: VIKING,
      owner: P0,
    });
    spawnSettler(sim.world, ctx, {
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 6,
      y: 0,
      tribe: VIKING,
      owner: P0,
    });
    const [soldier, civilian] = [...sim.world.query(Settler)] as Entity[];
    if (soldier === undefined || civilian === undefined) throw new Error('spawn failed');
    expect(sim.world.get(soldier, Stance).mode).toBe(MILITARY_MODE.DEFEND);
    expect(anchorOf(sim, soldier)).toBe(sim.terrain?.nodeAtClamped(2, 0)); // the spawn's own node
    expect(anchorOf(sim, civilian)).toBeNull();
  });

  it('moves the anchor to where a move order sends the soldier once the walk completes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const soldier = soldierAt(sim, 2);
    const before = anchorOf(sim, soldier);
    moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: soldier, x: 30, y: 0 });
    expect(anchorOf(sim, soldier)).toBe(before);
    sim.run(600);
    expect(anchorOf(sim, soldier)).toBe(cell(sim, 15, 0));
  });

  it('moves the anchor to where the target of an attack order stood', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const soldier = soldierAt(sim, 2);
    const enemy = combatant(sim, 12, 0, P1, MILITARY_MODE.IGNORE);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: enemy });
    expect(anchorOf(sim, soldier)).toBe(cell(sim, 12, 0));
  });

  it('walks a soldier that breaks off far from its anchor back to it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const soldier = soldierAt(sim, 30);
    const anchor = cell(sim, 10, 0); // 40 map points west of the soldier
    sim.world.mut(soldier, Stance).anchorCell = anchor;
    sim.world.add(soldier, Engagement, { repathAt: 0 }); // its enemy is gone: nothing left to strike

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(soldier, Engagement)).toBe(false);
    expect(sim.world.get(soldier, MoveGoal).cell).toBe(anchor);
  });

  it('leaves a soldier that breaks off within the slack of its anchor where it stands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const soldier = soldierAt(sim, 30);
    const slackCells = ATTACK_RETURN_SLACK_NODES / 2; // a row step is two map points
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 30 - slackCells, 0);
    sim.world.add(soldier, Engagement, { repathAt: 0 });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(soldier, Engagement)).toBe(false);
    expect(sim.world.has(soldier, MoveGoal)).toBe(false);
  });

  it('keeps a fighter’s anchor when the player switches it to ATTACK', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const soldier = soldierAt(sim, 12);
    sim.world.mut(soldier, Stance).mode = MILITARY_MODE.DEFEND;
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 2, 0);
    setStance(sim.world, ctxOf(sim), { kind: 'setStance', entity: soldier, mode: MILITARY_MODE.ATTACK });
    expect(anchorOf(sim, soldier)).toBe(cell(sim, 2, 0));
  });

  it('keeps the anchor across a change of fighter class, and anchors a new fighter where it stands', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const ctx = ctxOf(sim);
    const soldier = soldierAt(sim, 12);
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 2, 0);
    setJob(sim.world, ctx, { kind: 'setJob', entity: soldier, jobType: HERO });
    expect(anchorOf(sim, soldier)).toBe(cell(sim, 2, 0)); // armed at a store far from its post, it keeps it

    const recruit = combatant(sim, 6, 0, P0, MILITARY_MODE.FLEE);
    setJob(sim.world, ctx, { kind: 'setJob', entity: recruit, jobType: SOLDIER });
    expect(anchorOf(sim, recruit)).toBe(cell(sim, 6, 0));
  });

  it('anchors a soldier where a vehicle sets it down', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const soldier = soldierAt(sim, 2);
    landRider(sim.world, ctxOf(sim), soldier, { hx: 30, hy: 0 });
    expect(anchorOf(sim, soldier)).toBe(cell(sim, 15, 0));
  });

  it('leaves the anchor alone on an attack order against a building', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const soldier = soldierAt(sim, 2);
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 2, 0);
    const house = sim.world.create();
    sim.world.add(house, Position, { x: fx.fromInt(12), y: fx.fromInt(0) });
    sim.world.add(house, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(house, Health, { hitpoints: 1000, max: 1000 });
    sim.world.add(house, Owner, { player: P1 });
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: soldier, target: house });
    expect(anchorOf(sim, soldier)).toBe(cell(sim, 2, 0));
  });

  it('chases a fleeing civilian down and then walks home without getting lost', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(60, 1) });
    const soldier = soldierAt(sim, 5);
    const home = cell(sim, 5, 0);
    sim.world.mut(soldier, Stance).anchorCell = home;
    combatant(sim, 11, 0, P1, MILITARY_MODE.FLEE, { hitpoints: 200 });
    const distanceHome = (): number => {
      const p = sim.world.get(soldier, Position);
      const at = nodeOfPosition(p.x, p.y);
      return hexDistanceBetween(at.hx, at.hy, 10, 0); // cell (5, 0) is node (10, 0)
    };

    let farthest = 0;
    for (let tick = 0; tick < 3000; tick++) {
      sim.step();
      farthest = Math.max(farthest, distanceHome());
    }
    expect(farthest).toBeGreaterThan(ATTACK_RETURN_SLACK_NODES); // the chase took it well off its post
    expect(distanceHome()).toBeLessThanOrEqual(ATTACK_RETURN_SLACK_NODES);
    expect(sim.world.has(soldier, LostWay)).toBe(false);
  });

  it('moves a DEFEND guard’s post to where the unit it is ordered onto stood', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const guard = soldierAt(sim, 2);
    sim.world.mut(guard, Stance).mode = MILITARY_MODE.DEFEND;
    sim.world.mut(guard, Stance).anchorCell = cell(sim, 2, 0);
    const enemy = combatant(sim, 12, 0, P1, MILITARY_MODE.IGNORE);
    attackUnit(sim.world, ctxOf(sim), { kind: 'attackUnit', entity: guard, target: enemy });
    expect(anchorOf(sim, guard)).toBe(cell(sim, 12, 0));
  });

  it('does not walk home across water, nor get lost trying', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: waterColumnMap(40, 1, 20) });
    const soldier = soldierAt(sim, 30);
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 10, 0); // on the far bank
    sim.world.add(soldier, Engagement, { repathAt: 0 });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(soldier, MoveGoal)).toBe(false);
    expect(sim.world.has(soldier, LostWay)).toBe(false);
  });

  it('keeps marching on an attack-move instead of turning home', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const soldier = soldierAt(sim, 30);
    const anchor = cell(sim, 10, 0);
    sim.world.mut(soldier, Stance).anchorCell = anchor;
    sim.world.add(soldier, PlayerOrder, {
      attackMove: { goal: cell(sim, 38, 0), resume: false, blockedUntil: 0 },
    });
    sim.world.add(soldier, Engagement, { repathAt: 0 });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(soldier, PlayerOrder)).toBe(true);
    expect(sim.world.tryGet(soldier, MoveGoal)?.cell).not.toBe(anchor);
  });

  it('leaves a soldier posted to a workplace to that post, down from his tower or not', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const soldier = soldierAt(sim, 30);
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 10, 0);
    sim.world.add(soldier, JobAssignment, { workplace: sim.world.create() });
    sim.world.add(soldier, Engagement, { repathAt: 0 });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(soldier, MoveGoal)).toBe(false);
  });

  it('answers a pressing need before walking home', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const soldier = soldierAt(sim, 30);
    sim.world.mut(soldier, Stance).anchorCell = cell(sim, 10, 0);
    setNeeds(sim, soldier, { hunger: fx.add(NEED_DRIVE_THRESHOLD, fx.div(ONE, fx.fromInt(100))) });
    sim.world.add(soldier, Engagement, { repathAt: 0 });

    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(soldier, Engagement)).toBe(false);
    expect(sim.world.has(soldier, MoveGoal)).toBe(false);
  });
});
