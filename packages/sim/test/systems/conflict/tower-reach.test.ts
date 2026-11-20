import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiControl,
  addPerson,
  Building,
  COMPUTER_MODULE_IDS,
  computerModuleEnables,
  Equipment,
  JobAssignment,
  Owner,
  PickupClaim,
  Position,
  Stockpile,
  setDiplomacyStance,
  setNeedsEnabled,
  setPeaceTime,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { TOWER_RANGE_BONUS_NODES } from '../../../src/systems/conflict/tower-post.js';
import { pileUnderEnemyTowers, towerShotReach } from '../../../src/systems/conflict/tower-reach.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { reachableStock } from '../../../src/systems/settlers/planner/recruit-arming.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { idleReplanTick } from '../../fixtures/idle-replan.js';
import { grassCellMap } from '../../fixtures/terrain.js';

/**
 * A settler's own pickups pass over a loose good lying within a finished enemy tower's shot, manned or
 * not; a human player's equip order still fetches it. The fixture tower posts the base soldier class,
 * whose bow reaches {@link TOWER_REACH} nodes from the tower: on a row, five cells.
 */

const VIKING = 1;
const HUMAN = 0;
const ENEMY = 1;
const SOLDIER_JOB = 31;
const CARRIER_JOB = 36;
const HEADQUARTERS_TYPE = 1;
const TOWER_TYPE = 92;
const WOOD = 1;
const SHOES = 8;
const ARROW_MUNITION = 1;
const TOWER_BOW_RANGE = 5;
const TOWER_REACH = TOWER_BOW_RANGE + TOWER_RANGE_BONUS_NODES;
/** A stride beat for the assistant plus the walk to the pile and back on the small map. */
const ERRAND_TICKS = 600;
/** Long enough that the peace holds through the test. */
const PEACE_TICKS = 1000;

function towerContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: TOWER_TYPE,
        id: 'tower',
        kind: 'tower',
        workers: [{ jobType: SOLDIER_JOB, count: 1 }],
        stock: [],
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 0, dy: 1 } },
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: 20,
        id: 'test_tower_bow',
        tribeType: VIKING,
        jobType: SOLDIER_JOB,
        munitionType: ARROW_MUNITION,
        speed: 8,
        minRange: 2,
        maxRange: TOWER_BOW_RANGE,
        damage: { '0': 400 },
      },
    ],
  });
}

function freshSim(width = 16): Simulation {
  const sim = new Simulation({ seed: 1, content: towerContent(), map: grassCellMap(width, 3) });
  setNeedsEnabled(sim.world, false);
  return sim;
}

function placed(sim: Simulation, x: number, y: number, owner?: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  if (owner !== undefined) sim.world.add(e, Owner, { player: owner });
  return e;
}

/** An unmanned tower: nobody stands on its post. */
function towerAt(sim: Simulation, x: number, y: number, owner = ENEMY): Entity {
  const e = placed(sim, x, y, owner);
  sim.world.add(e, Building, { buildingType: TOWER_TYPE, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

function pileAt(sim: Simulation, x: number, y: number, goodType: number): Entity {
  const e = placed(sim, x, y);
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, 1]]) });
  return e;
}

function settlerAt(sim: Simulation, x: number, y: number, jobType: number): Entity {
  const e = placed(sim, x, y, HUMAN);
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  return e;
}

/** The human's headquarters and a porter posted to it, beside it on the row. */
function porterAt(sim: Simulation, x: number, y: number): Entity {
  const hq = placed(sim, x + 1, y, HUMAN);
  sim.world.add(hq, Building, { buildingType: HEADQUARTERS_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(hq, Stockpile, { amounts: new Map([[WOOD, 0]]) });
  const porter = settlerAt(sim, x, y, CARRIER_JOB);
  sim.world.add(porter, JobAssignment, { workplace: hq });
  return porter;
}

function claimOf(sim: Simulation, e: Entity): Entity | undefined {
  return sim.world.tryGet(e, PickupClaim)?.source;
}

function underFire(sim: Simulation, pile: Entity): boolean {
  return pileUnderEnemyTowers(sim.world, { content: sim.content }, HUMAN, pile);
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

describe('the ground under an enemy tower', () => {
  it("reaches as far as the tower's post bow shoots, manned or not", () => {
    const sim = freshSim();
    towerAt(sim, 0, 0);
    const atReach = pileAt(sim, TOWER_REACH / 2, 0, WOOD);
    const past = pileAt(sim, TOWER_REACH / 2 + 1, 0, WOOD);

    expect(towerShotReach(sim.content, TOWER_TYPE, VIKING)).toBe(TOWER_REACH);
    expect(underFire(sim, atReach)).toBe(true);
    expect(underFire(sim, past)).toBe(false);
  });

  it('is covered only by a finished tower of a player the fetcher fights', () => {
    const sim = freshSim();
    const tower = towerAt(sim, 0, 0);
    const pile = pileAt(sim, 1, 0, WOOD);
    sim.world.add(tower, UnderConstruction, { labor: fx.fromInt(0) });
    expect(underFire(sim, pile)).toBe(false);

    sim.world.remove(tower, UnderConstruction);
    expect(underFire(sim, pile)).toBe(true);
    expect(pileUnderEnemyTowers(sim.world, { content: sim.content }, ENEMY, pile)).toBe(false);

    setDiplomacyStance(sim.world, HUMAN, ENEMY, 'friend');
    setDiplomacyStance(sim.world, ENEMY, HUMAN, 'friend');
    expect(underFire(sim, pile)).toBe(false);

    setDiplomacyStance(sim.world, HUMAN, ENEMY, 'enemy');
    setDiplomacyStance(sim.world, ENEMY, HUMAN, 'enemy');
    setPeaceTime(sim.world, sim.tick, sim.tick + PEACE_TICKS, [HUMAN, ENEMY]);
    expect(underFire(sim, pile)).toBe(false);
  });
});

describe('a porter beside an enemy tower', () => {
  it('passes over the near pile under the tower for the far one outside it', () => {
    const sim = freshSim();
    towerAt(sim, 15, 0);
    const porter = porterAt(sim, 12, 0);
    pileAt(sim, 11, 0, WOOD);
    const outside = pileAt(sim, 4, 0, WOOD);

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, porter)).toBe(outside);
  });

  it("takes the pile once the tower's owner turns friendly", () => {
    const sim = freshSim();
    towerAt(sim, 15, 0);
    const porter = porterAt(sim, 12, 0);
    const pile = pileAt(sim, 11, 0, WOOD);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, PickupClaim)).toBe(false);

    setDiplomacyStance(sim.world, HUMAN, ENEMY, 'friend');
    setDiplomacyStance(sim.world, ENEMY, HUMAN, 'friend');
    plannerSystem(sim.world, { ...ctxOf(sim), tick: idleReplanTick(sim.world, porter, sim.tick) });

    expect(claimOf(sim, porter)).toBe(pile);
  });
});

describe('shoes under an enemy tower', () => {
  function wornBoots(sim: Simulation, e: Entity): number | undefined {
    return sim.world.tryGet(e, Equipment)?.boots?.goodType;
  }

  it("are left by the assistant's grant and fetched on the player's own order", () => {
    const sim = freshSim();
    towerAt(sim, 15, 0);
    pileAt(sim, 12, 0, SHOES);
    const man = settlerAt(sim, 4, 0, CARRIER_JOB);
    sim.enqueueSetup({ kind: 'setAssistantGrant', player: HUMAN, goodType: SHOES, enabled: true });
    run(sim, ERRAND_TICKS);
    expect(wornBoots(sim, man)).toBeUndefined();

    sim.enqueueSetup({ kind: 'equipGood', entity: man, group: 'boots', slot: 0, goodType: SHOES });
    run(sim, ERRAND_TICKS);

    expect(wornBoots(sim, man)).toBe(SHOES);
  });

  it("are passed over by a computer seat's own equip order", () => {
    const sim = freshSim();
    sim.world.add(sim.world.create(), AiControl, {
      player: HUMAN,
      modules: computerModuleEnables(Object.fromEntries(COMPUTER_MODULE_IDS.map((id) => [id, false]))),
      computerEnabled: false,
      mapAiEnabled: false,
      difficulty: 'hard',
    });
    towerAt(sim, 15, 0);
    pileAt(sim, 12, 0, SHOES);
    const man = settlerAt(sim, 4, 0, CARRIER_JOB);

    sim.enqueueSetup({ kind: 'equipGood', entity: man, group: 'boots', slot: 0, goodType: SHOES });
    run(sim, ERRAND_TICKS);

    expect(wornBoots(sim, man)).toBeUndefined();
  });

  it('are left out of the stock the arming and dressing errands count', () => {
    const sim = freshSim();
    towerAt(sim, 15, 0);
    pileAt(sim, 12, 0, SHOES);
    pileAt(sim, 2, 0, SHOES);
    const { terrain } = sim;
    if (terrain === undefined) throw new Error('mapped sim expected');

    expect(reachableStock(sim.world, ctxOf(sim), terrain, HUMAN, null).units(SHOES)).toBe(1);
  });
});
