import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiControl,
  addPerson,
  Building,
  COMPUTER_MODULE_IDS,
  computerModuleEnables,
  Equipment,
  endPeace,
  JobAssignment,
  Owner,
  PickupClaim,
  Position,
  Stockpile,
  setDiplomacyStance,
  setNeedsEnabled,
  setPeaceTime,
  setSettlerJob,
  stampOwner,
  Weapon,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { TOWER_RANGE_BONUS_NODES } from '../../../src/systems/conflict/tower-post.js';
import { pileUnderEnemyTowers } from '../../../src/systems/conflict/tower-reach.js';
import { bindHaulFlag } from '../../../src/systems/economy/work-flag.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { inputReach } from '../../../src/systems/readviews/store-reach.js';
import { stepOut, takePost } from '../../../src/systems/settlers/indoors.js';
import { reachableStock } from '../../../src/systems/settlers/planner/recruit-arming.js';
import { collectTargets } from '../../../src/systems/settlers/targets/index.js';
import { settlementGround } from '../../../src/systems/trade/settlement-ground.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { idleReplanTick } from '../../fixtures/idle-replan.js';
import { grassCellMap, waterColumnMap } from '../../fixtures/terrain.js';

/**
 * A settler's own pickups pass over a loose good a bowman standing on an enemy tower shoots at; a human
 * player's equip order and a porter on a human player's flag still take it. The fixture tower posts two
 * bow classes: the base soldier's bow reaches {@link TOWER_REACH} nodes from the tower, the long one
 * farther.
 */

const VIKING = 1;
const HUMAN = 0;
const ENEMY = 1;
const SOLDIER_JOB = 31;
/** A second bow class the fixture tower also posts, holding the longer bow. */
const LONG_SOLDIER_JOB = 41;
const CARRIER_JOB = 36;
const TRADER_JOB = 25;
const HEADQUARTERS_TYPE = 1;
/** A wood-to-plank workshop with a carrier slot. */
const TWIN_MILL_TYPE = 8;
const TOWER_TYPE = 92;
/** A tower three nodes wide along its row, so its walls stand apart from its anchor. */
const WIDE_TOWER_TYPE = 93;
/** The node of {@link WIDE_TOWER_TYPE}'s east wall, counted from its anchor along the row. */
const WIDE_TOWER_EAST_NODE = 2;
const WOOD = 1;
const SHOES = 8;
const ARROW_MUNITION = 1;
const TOWER_BOW = 20;
const TOWER_BOW_RANGE = 5;
const TOWER_REACH = TOWER_BOW_RANGE + TOWER_RANGE_BONUS_NODES;
const LONG_BOW = 22;
const LONG_BOW_RANGE = 8;
const MAP_WIDTH = 16;
const MAP_ROWS = 3;
/** The water column that parts the map's east from its west. */
const RIVER_COLUMN = 8;
/** Wide enough for a pile past a confined workshop's 40-node goods search. */
const WIDE_MAP_WIDTH = 40;
/** A cell well past the 40-node goods search from the twin mill's door at cell 3. */
const PAST_GOODS_SEARCH = 30;
/** Nodes a cell spans along a row. */
const NODES_PER_CELL = 2;
/** A stride beat for the assistant plus the walk to the pile and back on the small map. */
const ERRAND_TICKS = 600;
/** Long enough that the peace holds through the test. */
const PEACE_TICKS = 1000;
/** Ample for an ordered man to set out, well before he walks into the bowman's reach. */
const SET_OUT_TICKS = 60;

function towerContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: LONG_SOLDIER_JOB, id: 'soldier_long', ignoresHomeHouse: true }],
    buildings: [
      ...base.buildings,
      {
        typeId: TOWER_TYPE,
        id: 'tower',
        kind: 'tower',
        workers: [
          { jobType: SOLDIER_JOB, count: 1 },
          { jobType: LONG_SOLDIER_JOB, count: 1 },
        ],
        stock: [],
        footprint: { blocked: [{ dx: 0, dy: 0 }], door: { dx: 0, dy: 1 } },
      },
      {
        typeId: WIDE_TOWER_TYPE,
        id: 'wide_tower',
        kind: 'tower',
        workers: [{ jobType: SOLDIER_JOB, count: 1 }],
        stock: [],
        footprint: {
          blocked: [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: WIDE_TOWER_EAST_NODE, dy: 0 },
          ],
          door: { dx: 0, dy: 1 },
        },
      },
    ],
    weapons: [
      ...base.weapons,
      {
        typeId: TOWER_BOW,
        id: 'test_tower_bow',
        tribeType: VIKING,
        jobType: SOLDIER_JOB,
        munitionType: ARROW_MUNITION,
        speed: 8,
        minRange: 2,
        maxRange: TOWER_BOW_RANGE,
        damage: { '0': 400 },
      },
      {
        typeId: LONG_BOW,
        id: 'test_long_bow',
        tribeType: VIKING,
        jobType: LONG_SOLDIER_JOB,
        munitionType: ARROW_MUNITION,
        speed: 8,
        minRange: 2,
        maxRange: LONG_BOW_RANGE,
        damage: { '0': 400 },
      },
    ],
  });
}

function freshSim(map = grassCellMap(MAP_WIDTH, MAP_ROWS)): Simulation {
  const sim = new Simulation({ seed: 1, content: towerContent(), map });
  setNeedsEnabled(sim.world, false);
  return sim;
}

function placed(sim: Simulation, x: number, y: number, owner?: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  if (owner !== undefined) sim.world.add(e, Owner, { player: owner });
  return e;
}

/** An empty tower: nobody stands on its post. */
function towerAt(sim: Simulation, x: number, y: number, owner = ENEMY, buildingType = TOWER_TYPE): Entity {
  const e = placed(sim, x, y, owner);
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

/** A bowman of the tower's owner posted to it, standing below it until {@link takePost} puts him on it. */
function bowmanFor(sim: Simulation, tower: Entity): Entity {
  const { x, y } = sim.world.get(tower, Position);
  const e = sim.world.create();
  sim.world.add(e, Position, { x, y: fx.add(y, ONE) });
  sim.world.add(e, Owner, { player: sim.world.get(tower, Owner).player });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: SOLDIER_JOB,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, JobAssignment, { workplace: tower });
  return e;
}

/** A tower with a bowman standing on its post. */
function mannedTowerAt(sim: Simulation, x: number, y: number): { tower: Entity; bowman: Entity } {
  const tower = towerAt(sim, x, y);
  const bowman = bowmanFor(sim, tower);
  takePost(sim.world, bowman, tower);
  return { tower, bowman };
}

function pileAt(sim: Simulation, x: number, y: number, goodType: number): Entity {
  const e = placed(sim, x, y);
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, 1]]) });
  return e;
}

/** A pile `nodes` map points east of the origin along the first row. */
function pileAlongRow(sim: Simulation, nodes: number, goodType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.div(fx.fromInt(nodes), fx.fromInt(NODES_PER_CELL)), y: fx.fromInt(0) });
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

/** The human's empty twin mill and a carrier working it, one cell west of its door. */
function twinMillAt(sim: Simulation, x: number): { mill: Entity; carrier: Entity } {
  const mill = placed(sim, x, 0, HUMAN);
  sim.world.add(mill, Building, { buildingType: TWIN_MILL_TYPE, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(mill, Stockpile, { amounts: new Map([[WOOD, 0]]) });
  const carrier = settlerAt(sim, x - 1, 0, CARRIER_JOB);
  sim.world.add(carrier, JobAssignment, { workplace: mill });
  return { mill, carrier };
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

function runUntil(sim: Simulation, ticks: number, done: () => boolean): void {
  for (let i = 0; i < ticks && !done(); i++) sim.step();
}

/** Give `player`'s seat a computer controller that runs none of its modules; returns its carrier. */
function seatComputer(sim: Simulation, player: number): Entity {
  const seat = sim.world.create();
  sim.world.add(seat, AiControl, {
    player,
    modules: computerModuleEnables(Object.fromEntries(COMPUTER_MODULE_IDS.map((id) => [id, false]))),
    computerEnabled: false,
    mapAiEnabled: false,
    difficulty: 'hard',
  });
  return seat;
}

describe('the ground under an enemy tower', () => {
  it('is in the shot of a bowman standing on the tower as far as his bow reaches', () => {
    const sim = freshSim();
    mannedTowerAt(sim, 0, 0);
    const atReach = pileAlongRow(sim, TOWER_REACH, WOOD);
    const past = pileAlongRow(sim, TOWER_REACH + 1, WOOD);

    expect(underFire(sim, atReach)).toBe(true);
    expect(underFire(sim, past)).toBe(false);
  });

  it("counts a bowman's reach from the tower's nearest wall, as his shot does", () => {
    const sim = freshSim();
    const tower = towerAt(sim, 0, 0, ENEMY, WIDE_TOWER_TYPE);
    takePost(sim.world, bowmanFor(sim, tower), tower);
    const atReach = pileAlongRow(sim, WIDE_TOWER_EAST_NODE + TOWER_REACH, WOOD);
    const past = pileAlongRow(sim, WIDE_TOWER_EAST_NODE + TOWER_REACH + 1, WOOD);

    expect(pileUnderEnemyTowers(sim.world, ctxOf(sim), HUMAN, atReach)).toBe(true);
    expect(pileUnderEnemyTowers(sim.world, ctxOf(sim), HUMAN, past)).toBe(false);
  });

  it('is covered only while a bowman whose owner fights the fetcher stands on the post', () => {
    const sim = freshSim();
    const tower = towerAt(sim, 0, 0);
    const pile = pileAt(sim, 1, 0, WOOD);
    const bowman = bowmanFor(sim, tower);
    expect(underFire(sim, pile)).toBe(false);

    takePost(sim.world, bowman, tower);
    expect(underFire(sim, pile)).toBe(true);
    expect(pileUnderEnemyTowers(sim.world, { content: sim.content }, ENEMY, pile)).toBe(false);

    // A bowman shoots at whom his own player fights, whatever the fetcher's stance toward his.
    setDiplomacyStance(sim.world, ENEMY, HUMAN, 'friend');
    expect(underFire(sim, pile)).toBe(false);
    setDiplomacyStance(sim.world, ENEMY, HUMAN, 'enemy');
    setDiplomacyStance(sim.world, HUMAN, ENEMY, 'friend');
    expect(underFire(sim, pile)).toBe(true);
    setDiplomacyStance(sim.world, HUMAN, ENEMY, 'enemy');

    setPeaceTime(sim.world, sim.tick, sim.tick + PEACE_TICKS, [HUMAN, ENEMY]);
    expect(underFire(sim, pile)).toBe(false);
    endPeace(sim.world);
    expect(underFire(sim, pile)).toBe(true);

    stepOut(sim.world, bowman);
    expect(underFire(sim, pile)).toBe(false);
  });

  it('follows the bow the posted bowman takes up', () => {
    const sim = freshSim();
    const { bowman } = mannedTowerAt(sim, 0, 0);
    const pile = pileAlongRow(sim, TOWER_REACH + NODES_PER_CELL, WOOD);
    expect(underFire(sim, pile)).toBe(false);

    sim.world.add(bowman, Weapon, { weaponTypeId: LONG_BOW });

    expect(underFire(sim, pile)).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("follows the bowman's own player when his tower changes hands under him", () => {
    const sim = freshSim();
    const { tower } = mannedTowerAt(sim, 0, 0);
    const pile = pileAt(sim, 1, 0, WOOD);

    stampOwner(sim.world, tower, HUMAN);

    expect(underFire(sim, pile)).toBe(true);
  });

  it("follows a posted bowman's promotion to a class with a longer bow", () => {
    const sim = freshSim();
    const { bowman } = mannedTowerAt(sim, 0, 0);
    const pile = pileAlongRow(sim, TOWER_REACH + NODES_PER_CELL, WOOD);
    expect(underFire(sim, pile)).toBe(false);

    setSettlerJob(sim.world, bowman, LONG_SOLDIER_JOB);

    expect(underFire(sim, pile)).toBe(true);
  });

  it("is no signpost matter in a workshop's diagnosis of its input", () => {
    const sim = freshSim();
    const { mill, carrier } = twinMillAt(sim, 13);
    pileAt(sim, 11, 0, WOOD);
    const { bowman } = mannedTowerAt(sim, 15, 0);
    const verdict = () => inputReach(sim.world, ctxOf(sim), carrier, mill, WOOD, []);
    expect(verdict()).toBe('undecided');

    stepOut(sim.world, bowman);

    expect(verdict()).toBe('inReach');
  });

  it("stays out of signpost reach in a workshop's diagnosis when water parts it from the fetch", () => {
    const sim = freshSim(waterColumnMap(MAP_WIDTH, MAP_ROWS, RIVER_COLUMN));
    const { mill, carrier } = twinMillAt(sim, 3);
    pileAt(sim, 12, 0, WOOD);
    mannedTowerAt(sim, 14, 0);

    expect(inputReach(sim.world, ctxOf(sim), carrier, mill, WOOD, [])).toBe('outOfReach');
  });

  it("stays out of signpost reach in a workshop's diagnosis when it lies past the goods search too", () => {
    const sim = freshSim(grassCellMap(WIDE_MAP_WIDTH, MAP_ROWS));
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const { mill, carrier } = twinMillAt(sim, 3);
    pileAt(sim, PAST_GOODS_SEARCH, 0, WOOD);
    mannedTowerAt(sim, PAST_GOODS_SEARCH + 3, 0);

    expect(inputReach(sim.world, ctxOf(sim), carrier, mill, WOOD, [])).toBe('outOfReach');
  });

  it("is left out of a trader's settlement ground until the bowman walks off", () => {
    const sim = freshSim();
    const anchor = placed(sim, 1, 1, HUMAN);
    sim.world.add(anchor, Building, { buildingType: HEADQUARTERS_TYPE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(anchor, Stockpile, { amounts: new Map() });
    const trader = settlerAt(sim, 1, 1, TRADER_JOB);
    const pile = pileAt(sim, 4, 0, WOOD);
    const { bowman } = mannedTowerAt(sim, 8, 0);
    const ground = () => {
      const ctx = ctxOf(sim);
      const { terrain } = ctx;
      if (terrain === undefined) throw new Error('mapped sim expected');
      const targets = collectTargets(sim.world, ctx, terrain);
      return settlementGround(sim.world, ctx, terrain, trader, anchor, WOOD, (good) =>
        targets.bands.holding(good),
      ).piles;
    };
    expect(ground()).toEqual([]);

    stepOut(sim.world, bowman);

    expect(ground()).toEqual([pile]);
  });
});

describe('a porter beside an enemy tower', () => {
  it('passes over the near pile under the bowman for the far one outside his shot', () => {
    const sim = freshSim();
    const porter = porterAt(sim, 12, 0);
    pileAt(sim, 11, 0, WOOD);
    const outside = pileAt(sim, 4, 0, WOOD);
    mannedTowerAt(sim, 15, 0);

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, porter)).toBe(outside);
  });

  it('takes the pile once the bowman walks off his post', () => {
    const sim = freshSim();
    const porter = porterAt(sim, 12, 0);
    const pile = pileAt(sim, 11, 0, WOOD);
    // Made after the porter, so the porter re-plans first and sees only the bowman's step, not his release.
    const { bowman } = mannedTowerAt(sim, 15, 0);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, PickupClaim)).toBe(false);

    const stand = sim.world.mut(bowman, Position);
    stand.y = fx.add(stand.y, ONE);
    plannerSystem(sim.world, { ...ctxOf(sim), tick: idleReplanTick(sim.world, porter, sim.tick) });

    expect(claimOf(sim, porter)).toBe(pile);
  });

  it("collects under the bowman's fire inside a flag its human player planted", () => {
    const sim = freshSim();
    const porter = porterAt(sim, 12, 0);
    const pile = pileAt(sim, 11, 0, WOOD);
    pileAt(sim, 4, 0, WOOD);
    mannedTowerAt(sim, 15, 0);
    bindHaulFlag(sim.world, ctxOf(sim), porter, sim.world.get(pile, Position));

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, porter)).toBe(pile);
  });

  it('wakes from its empty scan once its computer seat is handed to a human', () => {
    const sim = freshSim();
    const seat = seatComputer(sim, HUMAN);
    const porter = porterAt(sim, 12, 0);
    const pile = pileAt(sim, 11, 0, WOOD);
    mannedTowerAt(sim, 15, 0);
    bindHaulFlag(sim.world, ctxOf(sim), porter, sim.world.get(pile, Position));
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(porter, PickupClaim)).toBe(false);

    sim.world.destroy(seat);

    // A dormant porter whose scan would now find the pile is a stale dormancy.
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it("fetches a workshop's input under the bowman's fire inside a flag its human player planted", () => {
    const sim = freshSim();
    const { carrier } = twinMillAt(sim, 13);
    const pile = pileAt(sim, 11, 0, WOOD);
    mannedTowerAt(sim, 15, 0);
    bindHaulFlag(sim.world, ctxOf(sim), carrier, sim.world.get(pile, Position));

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, carrier)).toBe(pile);
  });

  it('passes over it inside a flag a computer seat planted', () => {
    const sim = freshSim();
    seatComputer(sim, HUMAN);
    const porter = porterAt(sim, 12, 0);
    const pile = pileAt(sim, 11, 0, WOOD);
    const outside = pileAt(sim, 4, 0, WOOD);
    mannedTowerAt(sim, 15, 0);
    bindHaulFlag(sim.world, ctxOf(sim), porter, sim.world.get(pile, Position));

    plannerSystem(sim.world, ctxOf(sim));

    expect(claimOf(sim, porter)).toBe(outside);
  });
});

describe('shoes under an enemy tower', () => {
  function wornBoots(sim: Simulation, e: Entity): number | undefined {
    return sim.world.tryGet(e, Equipment)?.boots?.goodType;
  }

  it("are left by the assistant's grant and set out for on the player's own order", () => {
    const sim = freshSim();
    mannedTowerAt(sim, 15, 0);
    const shoes = pileAt(sim, 12, 0, SHOES);
    const man = settlerAt(sim, 4, 0, CARRIER_JOB);
    sim.enqueueSetup({ kind: 'setAssistantGrant', player: HUMAN, goodType: SHOES, enabled: true });
    run(sim, ERRAND_TICKS);
    expect(wornBoots(sim, man)).toBeUndefined();
    expect(sim.world.has(man, PickupClaim)).toBe(false);

    sim.enqueueSetup({ kind: 'equipGood', entity: man, group: 'boots', slot: 0, goodType: SHOES });
    runUntil(sim, SET_OUT_TICKS, () => sim.world.has(man, PickupClaim));

    expect(claimOf(sim, man)).toBe(shoes);
  });

  it("are passed over by a computer seat's own equip order", () => {
    const sim = freshSim();
    seatComputer(sim, HUMAN);
    mannedTowerAt(sim, 15, 0);
    pileAt(sim, 12, 0, SHOES);
    const man = settlerAt(sim, 4, 0, CARRIER_JOB);

    sim.enqueueSetup({ kind: 'equipGood', entity: man, group: 'boots', slot: 0, goodType: SHOES });
    run(sim, ERRAND_TICKS);

    expect(wornBoots(sim, man)).toBeUndefined();
  });

  it('are left out of the stock the arming and dressing errands count', () => {
    const sim = freshSim();
    mannedTowerAt(sim, 15, 0);
    pileAt(sim, 12, 0, SHOES);
    pileAt(sim, 2, 0, SHOES);
    const { terrain } = sim;
    if (terrain === undefined) throw new Error('mapped sim expected');

    expect(reachableStock(sim.world, ctxOf(sim), terrain, HUMAN, null).units(SHOES)).toBe(1);
  });
});
