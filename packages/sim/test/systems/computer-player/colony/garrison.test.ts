import { beforeAll, describe, expect, it } from 'vitest';
import { Building, Health } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import { nodeManhattan } from '../../../../src/nav/halfcell.js';
import { colonyBuildingsOn, everySettlerOf } from '../../../../src/systems/ai-shared/home-roster.js';
import { takeCensus } from '../../../../src/systems/ai-shared/military/census.js';
import { planSettlementDefence } from '../../../../src/systems/ai-shared/military/settlement-defence.js';
import { garrisonRoom } from '../../../../src/systems/computer-player/colony/garrison.js';
import { colonyTowerCount } from '../../../../src/systems/computer-player/colony/towers.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { nodeOfEntity } from '../../../../src/systems/computer-player/military/operations/raid-target.js';
import { ARMY_FLOOR_MIN } from '../../../../src/systems/computer-player/workforce/garrison.js';
import { towerPostFor } from '../../../../src/systems/conflict/tower-post.js';
import {
  BOWMAN,
  colonyIslands,
  colonyState,
  colonyWorld,
  garrisonContent,
  mooredShip,
  SMALL_SHIP,
  SPEARMAN,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT, STOCK_TYPE, TOWER_TYPE, VIKING } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const LANDING_DUE_TICKS = minutesToTicks(16);
const GARRISON_DUE_TICKS = minutesToTicks(40);
const RAID_DUE_TICKS = minutesToTicks(6);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const SECOND_SHIP_AT = { x: 90, y: 100 };
/** Home's spearmen: past the army floor, so a sixth of them may sail. */
const ARMY = 18;
const ARMY_ROW = 9;
const ARMY_AT = { x: 10, y: 90 };
const ARMY_STEP = 2;
const ENEMY = 5;
const RAIDERS = 2;
const RAID_NEAR = 6;
const GARRISON_LEAST = 3;
const TOWERS_LEAST = 2;
const RAIDERS_FOR_THIRD = 3;
const MANY_RAIDERS = 20;
const TOWERS_MOST = 3;
const TOWER_DUE_TICKS = minutesToTicks(30);
/** Near enough that the tower's bows cover the spot. */
const TOWER_NEAR_NODES = 12;
/** A raider falls to a few blows. */
const RAIDER_HITPOINTS = 2000;

function spawnArmy(sim: Simulation, jobType: number): void {
  for (let i = 0; i < ARMY; i++)
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType,
      x: ARMY_AT.x + ARMY_STEP * (i % ARMY_ROW),
      y: ARMY_AT.y + ARMY_STEP * Math.floor(i / ARMY_ROW),
      tribe: VIKING,
      owner: SEAT,
    });
}

/** The colony's garrison of `jobType` standing on its land, once its first men landed. */
function garrisonedWorld(jobType = SPEARMAN): Simulation {
  const sim = colonyWorld(7, garrisonContent());
  spawnArmy(sim, jobType);
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, LANDING_DUE_TICKS, () => (colonyState(sim)?.line ?? null) !== null))
    throw new Error('setup: no line');
  if (!stepUntil(sim, GARRISON_DUE_TICKS, () => ashore(sim).length >= GARRISON_LEAST))
    throw new Error('setup: no garrison ashore');
  return sim;
}

/** The garrison men standing on the colony's land. */
function ashore(sim: Simulation): Entity[] {
  const colony = colonyState(sim);
  const terrain = ctxOf(sim).terrain;
  if (colony === undefined || terrain === undefined) return [];
  return colony.garrison.filter((e) => {
    const at = sim.world.isAlive(e) ? nodeOfEntity(sim.world, e) : null;
    return at !== null && terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy)) === colony.land;
  });
}

describe('the garrison gate', () => {
  it('lets a sixth of the army sail and keeps the army floor at home', () => {
    expect(garrisonRoom(ARMY_FLOOR_MIN, 0)).toBe(0);
    expect(garrisonRoom(ARMY, 0)).toBe(GARRISON_LEAST);
    expect(garrisonRoom(ARMY - GARRISON_LEAST, GARRISON_LEAST)).toBe(0);
  });
});

describe('a garrisoned colony', () => {
  let sim: Simulation;
  let men: Entity[];
  beforeAll(() => {
    sim = garrisonedWorld();
    men = ashore(sim);
  });

  it('holds men taken from the home army, who leave its census', () => {
    expect(men.length).toBe(GARRISON_LEAST);
    const ready = takeCensus(sim.world, ctxOf(sim), SEAT).ready;
    expect(men.some((e) => ready.includes(e))).toBe(false);
    expect(ready.length).toBe(ARMY - GARRISON_LEAST);
  });

  it('comes back from a save exactly as it would have gone on', () => {
    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: garrisonContent(), map: colonyIslands() });
    expect(colonyState(copy)?.garrison).toEqual(colonyState(sim)?.garrison);
    for (let t = 0; t < AFTER_SAVE_TICKS; t++) {
      sim.step();
      copy.step();
    }
    expect(copy.hashState()).toBe(sim.hashState());
  });

  it('beats off a small raid on its own, without the home army', () => {
    const site = colonyState(sim)?.site;
    if (site === undefined) throw new Error('no site');
    for (let i = 0; i < RAIDERS; i++)
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: SPEARMAN,
        x: site.hx + RAID_NEAR,
        y: site.hy + i,
        tribe: VIKING,
        owner: ENEMY,
      });
    sim.step();
    const raiders = everySettlerOf(sim.world, ENEMY);
    expect(raiders.length).toBe(RAIDERS);
    for (const e of raiders) sim.world.mut(e, Health).hitpoints = RAIDER_HITPOINTS;
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    if (terrain === undefined) throw new Error('no terrain');
    expect(planSettlementDefence(sim.world, ctx, terrain, SEAT, true).raid).toBeNull();
    expect(stepUntil(sim, RAID_DUE_TICKS, () => raiders.every((e) => !sim.world.isAlive(e)))).toBe(true);
    expect(colonyState(sim)?.phase).toBe('running');
    expect(colonyState(sim)?.threat?.men).toBe(RAIDERS);
  });
});

describe('the towers a colony wants', () => {
  it('raise two once a garrison sails, and one more per three raiders seen, up to three', () => {
    expect(colonyTowerCount(false, RAIDERS)).toBe(0);
    expect(colonyTowerCount(true, 0)).toBe(TOWERS_LEAST);
    expect(colonyTowerCount(true, RAIDERS_FOR_THIRD)).toBe(TOWERS_MOST);
    expect(colonyTowerCount(true, MANY_RAIDERS)).toBe(TOWERS_MOST);
  });
});

describe('a garrisoned colony of archers', () => {
  it('raises two towers, the first by its store and its shore, and its archers man them', () => {
    const sim = garrisonedWorld(BOWMAN);
    const ctx = () => ctxOf(sim);
    const towers = (): Entity[] =>
      colonyBuildingsOn(sim.world, ctx(), SEAT, colonyState(sim)?.land ?? -1).filter(
        (e) => sim.world.get(e, Building).buildingType === TOWER_TYPE,
      );
    expect(stepUntil(sim, TOWER_DUE_TICKS, () => towers().length === TOWERS_LEAST)).toBe(true);
    const at = nodeOfEntity(sim.world, towers()[0] as Entity);
    const store = colonyBuildingsOn(sim.world, ctx(), SEAT, colonyState(sim)?.land ?? -1).find(
      (e) => sim.world.get(e, Building).buildingType === STOCK_TYPE,
    );
    const from = store === undefined ? null : nodeOfEntity(sim.world, store);
    const shore = colonyState(sim)?.shore;
    if (at === null || from === null || shore == null) throw new Error('no tower, store or shore');
    expect(nodeManhattan(at, shore)).toBeLessThanOrEqual(TOWER_NEAR_NODES);
    expect(nodeManhattan(at, from)).toBeLessThanOrEqual(TOWER_NEAR_NODES);
    const posted = () =>
      ashore(sim).filter((e) => {
        const post = towerPostFor(sim.world, ctx(), e, BOWMAN);
        return post !== null && towers().includes(post);
      }).length;
    expect(stepUntil(sim, TOWER_DUE_TICKS, () => posted() === GARRISON_LEAST)).toBe(true);
  });
});
