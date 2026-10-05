import type { MapAiSeat } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AI_MODULE_IDS,
  type AiModuleId,
  AiProgram,
  aiProgramEntity,
  Building,
  Health,
  JobAssignment,
  Marriage,
  Owner,
  Settler,
  Stockpile,
  setSignpostNavigation,
  WALK_RANGE_NODES,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import { PersonalNames } from '../../src/core/personal-names.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, Rng, Simulation } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { AI_HANDLER_ROUND_TICKS } from '../../src/systems/ai-player/cadence.js';
import {
  militaryModule,
  SCRIPTED_DEFENCE_REACH_POINTS,
  SCRIPTED_PEACE_ARCHERS_PER_CLASS,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
} from '../../src/systems/ai-player/index.js';
import { seatRaiders } from '../../src/systems/ai-player/military/defence/threat.js';
import { familyOrders } from '../../src/systems/ai-program/families.js';
import {
  REBUILD_NEAR_POINTS,
  REBUILD_RADIUS_POINTS,
  REBUILD_SITE_LIMIT,
  rebuildList,
  rebuildOrders,
} from '../../src/systems/ai-program/rebuild.js';
import {
  holdTownGoods,
  TOWN_REPAIR_BUILDERS,
  townStaffingOrders,
} from '../../src/systems/ai-program/town.js';
import { markShortPool } from '../../src/systems/economy/repair.js';
import type { SystemContext } from '../../src/systems/index.js';
import { AI_STOCK_REFILL_LEVEL } from '../../src/systems/trade/partner-stock.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The scripted handler's town for a seat the map gave no strategic AI: its towers, the posts and homes it
 * fills, the stores it holds, the families it raises and the buildings it puts back.
 */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const HOME_TYPE = 2;
const HOME_TOP_TYPE = 4;
const BAKERY_TYPE = 8;
const TOWER_TYPE = 15;
const WOMAN = 5;
const CIVILIST = 6;
const BUILDER = 7;
const BAKER = 20;
const CARRIER = 24;
const SPEARMAN = 32;
const BOWMAN = 40;
const WOOD = 1;
const FOOD_SIMPLE = 3;
/** The baking test's slots: the wood its recipe burns and the food it makes. */
const INPUT_SLOT = 10;
const OUTPUT_SLOT = 20;
/** The tower's bow slots in the fixture. */
const TOWER_BOW_SLOTS = 4;

const HQ = { x: 24, y: 20 };
const TOWER_A = { x: 24, y: 60 };
const TOWER_B = { x: 64, y: 60 };
const HOME = { x: 40, y: 30 };
const BAKERY = { x: 40, y: 44 };

function townSim(
  script: Partial<MapAiSeat> = {},
  running: readonly AiModuleId[] = [],
  content = aiContent(),
): Simulation {
  const row: MapAiSeat = {
    player: SEAT,
    disabled: false,
    strategicOff: [...AI_MODULE_IDS],
    conditions: [],
    tasks: [],
    ...script,
  };
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 96), aiScript: [row] });
  const off = Object.fromEntries(AI_MODULE_IDS.map((id) => [id, running.includes(id)]));
  sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true, modules: off });
  return sim;
}

/** The fixture with a bakery that turns wood into food, so the workshop hold has a recipe to read. */
function bakingContent(): ReturnType<typeof aiContent> {
  const content = aiContent();
  return {
    ...content,
    buildings: content.buildings.map((b) =>
      b.typeId === BAKERY_TYPE
        ? {
            ...b,
            recipes: [
              {
                inputs: [{ goodType: WOOD, amount: 1 }],
                outputs: [{ goodType: FOOD_SIMPLE, amount: 1 }],
                ticks: 180,
              },
            ],
            stock: [
              { goodType: WOOD, capacity: INPUT_SLOT, initial: 0 },
              { goodType: FOOD_SIMPLE, capacity: OUTPUT_SLOT, initial: 0 },
            ],
          }
        : b,
    ),
  };
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: new Rng(1),
    names: new PersonalNames(1, []),
    tick: sim.tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return sim.terrain;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner = SEAT): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error(`setup: building ${buildingType} was refused`);
  return placed;
}

function spawn(
  sim: Simulation,
  count: number,
  at: { x: number; y: number },
  jobType: number,
  owner = SEAT,
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType,
      x: at.x + 2 * (i % 8),
      y: at.y + 2 * Math.floor(i / 8),
      tribe: VIKING,
      owner,
    });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

function apply(sim: Simulation, commands: readonly Command[]): void {
  for (const command of commands) sim.enqueueSetup(command);
  sim.step();
}

function crewOf(sim: Simulation, tower: Entity): number {
  return [...sim.world.query(Settler, JobAssignment)].filter(
    (e) => sim.world.get(e, JobAssignment).workplace === tower,
  ).length;
}

function towerOrders(sim: Simulation): Command[] {
  const decide = militaryModule.whileDisabled;
  if (decide === undefined) throw new Error('the military module has no disabled half');
  return [...decide(sim.world, ctxOf(sim), SEAT)];
}

function staffing(sim: Simulation): Command[] {
  const ctx = ctxOf(sim);
  const raiders = seatRaiders(sim.world, ctx, terrainOf(sim), SEAT);
  return townStaffingOrders(sim.world, ctx, terrainOf(sim), SEAT, raiders, { staff: true, house: true });
}

describe('ai program town - the towers', () => {
  it('spreads a short garrison over every tower instead of filling the first', () => {
    const sim = townSim();
    const towers = [place(sim, TOWER_TYPE, TOWER_A), place(sim, TOWER_TYPE, TOWER_B)];
    spawn(sim, 2, { x: TOWER_A.x + 6, y: TOWER_A.y }, BOWMAN);
    apply(sim, towerOrders(sim));
    expect(towers.map((t) => crewOf(sim, t))).toEqual([1, 1]);
  });

  it('keeps one archer per class in peace and leaves the rest free', () => {
    const sim = townSim();
    const tower = place(sim, TOWER_TYPE, TOWER_A);
    spawn(sim, 6, { x: TOWER_A.x + 6, y: TOWER_A.y }, BOWMAN);
    apply(sim, towerOrders(sim));
    expect(crewOf(sim, tower)).toBe(SCRIPTED_PEACE_ARCHERS_PER_CLASS);
    expect(towerOrders(sim).filter((c) => c.kind === 'assignWorker')).toEqual([]);
  });

  it('fills every slot while a raider is near and sends the extra men out once he is gone', () => {
    const sim = townSim();
    const tower = place(sim, TOWER_TYPE, TOWER_A);
    // West of the tower, out of the raider's sight, so none of them is already fighting him.
    spawn(sim, 6, { x: TOWER_A.x - 20, y: TOWER_A.y }, BOWMAN);
    const [raider] = spawn(
      sim,
      1,
      { x: TOWER_A.x + threatWatchNodes(ctxOf(sim), VIKING), y: TOWER_A.y },
      SPEARMAN,
      FOE,
    );
    if (raider === undefined) throw new Error('setup: the raider spawn was refused');
    apply(sim, towerOrders(sim));
    expect(crewOf(sim, tower)).toBe(TOWER_BOW_SLOTS);

    sim.world.destroy(raider);
    for (let released = TOWER_BOW_SLOTS; released > SCRIPTED_PEACE_ARCHERS_PER_CLASS; released--) {
      const orders = towerOrders(sim);
      expect(orders.filter((c) => c.kind === 'unassignWorker')).toHaveLength(1);
      apply(sim, orders);
    }
    expect(crewOf(sim, tower)).toBe(SCRIPTED_PEACE_ARCHERS_PER_CLASS);
    expect(towerOrders(sim).filter((c) => c.kind === 'unassignWorker')).toEqual([]);
  });
  it('takes the extra posts a raider opens only from archers near the tower', () => {
    const sim = townSim();
    const tower = place(sim, TOWER_TYPE, TOWER_A);
    spawn(sim, 1, { x: TOWER_A.x - 6, y: TOWER_A.y }, BOWMAN);
    // A band far west of the tower: it may give the tower its peace archer, never the raid's extras.
    spawn(sim, 4, { x: TOWER_A.x - 2 * SCRIPTED_DEFENCE_REACH_POINTS, y: TOWER_A.y - 20 }, BOWMAN);
    spawn(sim, 1, { x: TOWER_A.x + threatWatchNodes(ctxOf(sim), VIKING), y: TOWER_A.y }, SPEARMAN, FOE);
    apply(sim, towerOrders(sim));
    expect(crewOf(sim, tower)).toBe(SCRIPTED_PEACE_ARCHERS_PER_CLASS);
  });

  it('spreads the strategic garrison round the towers, three to a tower at most', () => {
    const sim = townSim({}, ['military']);
    const towers = [place(sim, TOWER_TYPE, TOWER_A), place(sim, TOWER_TYPE, TOWER_B)];
    spawn(sim, 4, { x: TOWER_A.x + 6, y: TOWER_A.y }, BOWMAN);
    apply(sim, [...militaryModule.run(sim.world, ctxOf(sim), SEAT)]);
    expect(towers.map((t) => crewOf(sim, t))).toEqual([2, 2]);
    spawn(sim, 4, { x: TOWER_A.x + 6, y: TOWER_A.y + 4 }, BOWMAN);
    apply(sim, [...militaryModule.run(sim.world, ctxOf(sim), SEAT)]);
    expect(towers.map((t) => crewOf(sim, t))).toEqual([TOWER_GARRISON_ARCHERS, TOWER_GARRISON_ARCHERS]);
  });
});

describe('ai program town - posts, homes and stores', () => {
  it('puts one man on each trade a standing workshop employs nobody in', () => {
    const sim = townSim();
    const bakery = place(sim, BAKERY_TYPE, BAKERY);
    spawn(sim, 3, { x: BAKERY.x + 6, y: BAKERY.y }, CIVILIST);
    const posts = staffing(sim).flatMap((c) => (c.kind === 'assignWorker' ? [c] : []));
    expect(posts.map((c) => [c.building, c.jobPriority])).toEqual([
      [bakery, [BAKER]],
      [bakery, [CARRIER]],
    ]);
    apply(sim, posts);
    expect(staffing(sim).filter((c) => c.kind === 'assignWorker')).toEqual([]);
  });

  it('posts a man already in the trade before a nearer one it would retrain', () => {
    const sim = townSim();
    const bakery = place(sim, BAKERY_TYPE, BAKERY);
    const [civilian] = spawn(sim, 1, { x: BAKERY.x + 4, y: BAKERY.y }, CIVILIST);
    const [baker] = spawn(sim, 1, { x: BAKERY.x + 20, y: BAKERY.y }, BAKER);
    const posts = staffing(sim).flatMap((c) => (c.kind === 'assignWorker' ? [c] : []));
    expect(posts.map((c) => [c.entity, c.jobPriority])).toEqual([
      [baker, [BAKER]],
      [civilian, [CARRIER]],
    ]);
    expect(posts.every((c) => c.building === bakery)).toBe(true);
  });

  it('leaves the women out of the posts', () => {
    const sim = townSim();
    place(sim, BAKERY_TYPE, BAKERY);
    spawn(sim, 2, { x: BAKERY.x + 6, y: BAKERY.y }, WOMAN);
    expect(staffing(sim).filter((c) => c.kind === 'assignWorker')).toEqual([]);
  });

  it('leaves a workshop with an enemy fighter beside it unstaffed', () => {
    const sim = townSim();
    place(sim, BAKERY_TYPE, BAKERY);
    spawn(sim, 2, { x: BAKERY.x + 6, y: BAKERY.y }, CIVILIST);
    spawn(sim, 1, { x: BAKERY.x - 8, y: BAKERY.y }, SPEARMAN, FOE);
    expect(staffing(sim).filter((c) => c.kind === 'assignWorker')).toEqual([]);
  });

  it('turns spare men builders for a site, the builders finding it themselves', () => {
    const sim = townSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HOME.x,
      y: HOME.y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    spawn(sim, 2, { x: HOME.x + 6, y: HOME.y }, CIVILIST);
    const builders = staffing(sim).flatMap((c) => (c.kind === 'setJob' ? [c.jobType] : []));
    expect(builders).toEqual([BUILDER, BUILDER]);
  });

  it('keeps a craftsman at his trade when a site wants builders, drawing a plain man instead', () => {
    const sim = townSim();
    const bakery = place(sim, BAKERY_TYPE, BAKERY);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HOME.x,
      y: HOME.y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    const [baker] = spawn(sim, 1, { x: HOME.x + 4, y: HOME.y }, BAKER);
    const [civilian] = spawn(sim, 1, { x: HOME.x + 30, y: HOME.y }, CIVILIST);
    const orders = staffing(sim);
    expect(orders).toContainEqual({
      kind: 'assignWorker',
      entity: baker,
      building: bakery,
      jobPriority: [BAKER],
    });
    expect(orders).toContainEqual({ kind: 'setJob', entity: civilian, jobType: BUILDER });
  });

  it('moves a homeless woman into a home with room', () => {
    const sim = townSim();
    const home = place(sim, HOME_TYPE, HOME);
    const [woman] = spawn(sim, 1, { x: HOME.x + 6, y: HOME.y }, WOMAN);
    expect(staffing(sim).filter((c) => c.kind === 'assignHouse')).toEqual([
      { kind: 'assignHouse', entity: woman, house: home },
    ]);
  });

  it('passes over a man his signposts keep from the post for one they let reach it', () => {
    const sim = townSim();
    setSignpostNavigation(sim.world, true);
    const bakery = place(sim, BAKERY_TYPE, BAKERY);
    const [civilian] = spawn(sim, 1, { x: BAKERY.x + 4, y: BAKERY.y }, CIVILIST);
    spawn(sim, 1, { x: BAKERY.x + WALK_RANGE_NODES + 10, y: BAKERY.y }, BAKER);
    const posts = staffing(sim).flatMap((c) => (c.kind === 'assignWorker' ? [c] : []));
    expect(posts).toEqual([
      { kind: 'assignWorker', entity: civilian, building: bakery, jobPriority: [BAKER] },
    ]);
  });

  it('sends two builders to mend a damaged house', () => {
    const sim = townSim();
    const hq = place(sim, HQ_TYPE, HQ);
    const health = sim.world.mut(hq, Health);
    health.hitpoints = Math.trunc(health.max / 2);
    markShortPool(sim.world, hq);
    spawn(sim, 4, { x: HQ.x + 6, y: HQ.y + 8 }, CIVILIST);
    const builders = staffing(sim).filter((c) => c.kind === 'setJob');
    expect(builders).toHaveLength(TOWN_REPAIR_BUILDERS);
  });

  it('holds every good of a standing store at the set count, down as well as up', () => {
    const sim = townSim();
    const hq = place(sim, HQ_TYPE, HQ);
    sim.world.mut(hq, Stockpile).amounts.set(FOOD_SIMPLE, 40);
    holdTownGoods(sim.world, ctxOf(sim), SEAT);
    expect([...sim.world.get(hq, Stockpile).amounts.values()].every((n) => n === AI_STOCK_REFILL_LEVEL)).toBe(
      true,
    );
  });
  it('fills a workshop’s inputs and takes its products down to half a slot', () => {
    const sim = townSim({}, [], bakingContent());
    const bakery = place(sim, BAKERY_TYPE, BAKERY);
    const stock = sim.world.mut(bakery, Stockpile).amounts;
    stock.set(WOOD, 0);
    stock.set(FOOD_SIMPLE, OUTPUT_SLOT);
    holdTownGoods(sim.world, ctxOf(sim), SEAT);
    const held = sim.world.get(bakery, Stockpile).amounts;
    expect([held.get(WOOD), held.get(FOOD_SIMPLE)]).toEqual([INPUT_SLOT, OUTPUT_SLOT / 2]);
  });
});

describe('ai program town - families', () => {
  function couple(sim: Simulation, at = HOME): { wife: Entity; home: Entity } {
    const home = place(sim, HOME_TYPE, at);
    const [wife] = spawn(sim, 1, { x: at.x + 6, y: at.y }, WOMAN);
    spawn(sim, 1, { x: at.x + 8, y: at.y }, CIVILIST);
    if (wife === undefined) throw new Error('setup: the spawn was refused');
    apply(sim, familyOrders(sim.world, ctxOf(sim), SEAT, undefined));
    sim.run(600); // the wedding walk
    if (!sim.world.has(wife, Marriage)) throw new Error('setup: the couple never married');
    apply(sim, [{ kind: 'assignHouse', entity: wife, house: home }]);
    return { wife, home };
  }

  it('marries a single woman and has a child at a home with food in the larder', () => {
    const sim = townSim();
    const { wife, home } = couple(sim);
    sim.world.mut(home, Stockpile).amounts.set(FOOD_SIMPLE, 3);
    const orders = familyOrders(sim.world, ctxOf(sim), SEAT, undefined);
    expect(orders).toEqual([{ kind: 'makeChild', entity: wife, child: 'male' }]);
  });

  it('orders a daughter while the women number under a third of the civilian men', () => {
    const sim = townSim();
    const { wife, home } = couple(sim);
    spawn(sim, 5, { x: HOME.x, y: HOME.y + 20 }, CIVILIST);
    sim.world.mut(home, Stockpile).amounts.set(FOOD_SIMPLE, 3);
    const orders = familyOrders(sim.world, ctxOf(sim), SEAT, undefined);
    expect(orders).toContainEqual({ kind: 'makeChild', entity: wife, child: 'female' });
  });

  it('orders one daughter a pass', () => {
    const sim = townSim();
    const first = couple(sim);
    const second = couple(sim, { x: HOME.x + 16, y: HOME.y });
    spawn(sim, 8, { x: HOME.x, y: HOME.y + 20 }, CIVILIST);
    for (const { home } of [first, second]) sim.world.mut(home, Stockpile).amounts.set(FOOD_SIMPLE, 3);
    const children = familyOrders(sim.world, ctxOf(sim), SEAT, undefined).filter(
      (c) => c.kind === 'makeChild',
    );
    expect(children).toEqual([{ kind: 'makeChild', entity: first.wife, child: 'female' }]);
  });

  it('has no child with an empty larder or at the unit limit', () => {
    const sim = townSim();
    const { home } = couple(sim);
    expect(familyOrders(sim.world, ctxOf(sim), SEAT, undefined)).toEqual([]);
    sim.world.mut(home, Stockpile).amounts.set(FOOD_SIMPLE, 3);
    const atLimit: MapAiSeat = {
      player: SEAT,
      disabled: false,
      strategicOff: [],
      conditions: [],
      tasks: [],
      unitLimit: 1,
    };
    expect(familyOrders(sim.world, ctxOf(sim), SEAT, atLimit)).toEqual([]);
  });
});

describe('ai program town - rebuilding', () => {
  it('raises a lost building again where it stood, beside others of its line', () => {
    const sim = townSim();
    const homes = [place(sim, HOME_TYPE, HOME), place(sim, HOME_TOP_TYPE, { x: HOME.x + 8, y: HOME.y })];
    spawn(sim, 1, { x: HOME.x, y: HOME.y + 8 }, CIVILIST);
    const houses = rebuildList(sim.world, ctxOf(sim), SEAT);
    const ctx = ctxOf(sim);
    expect(rebuildOrders(sim.world, ctx, terrainOf(sim), SEAT, houses, [])).toEqual([]);

    const lost = homes[1];
    if (lost === undefined) throw new Error('setup: the home was refused');
    sim.world.destroy(lost);
    const [site] = rebuildOrders(sim.world, ctxOf(sim), terrainOf(sim), SEAT, houses, []);
    if (site?.kind !== 'placeBuilding') throw new Error('nothing was raised again');
    expect(site).toMatchObject({ buildingType: HOME_TOP_TYPE, owner: SEAT, underConstruction: true });
    expect(Math.abs(site.x - (HOME.x + 8)) + Math.abs(site.y - HOME.y)).toBeLessThanOrEqual(
      REBUILD_RADIUS_POINTS,
    );
  });

  /** A remembered home razed with the seat's people `crew` beside it, ready for a rebuild order. */
  function razedHome(sim: Simulation, crewJob = CIVILIST): ReturnType<typeof rebuildList> {
    const home = place(sim, HOME_TYPE, HOME);
    spawn(sim, 1, { x: HOME.x, y: HOME.y + 8 }, crewJob);
    const houses = rebuildList(sim.world, ctxOf(sim), SEAT);
    sim.world.destroy(home);
    return houses;
  }

  function rebuilds(sim: Simulation, houses: ReturnType<typeof rebuildList>): Command[] {
    const ctx = ctxOf(sim);
    const raiders = seatRaiders(sim.world, ctx, terrainOf(sim), SEAT);
    return rebuildOrders(sim.world, ctx, terrainOf(sim), SEAT, houses, raiders);
  }

  it('raises nothing while the seat has its unfinished sites already', () => {
    const sim = townSim();
    const houses = razedHome(sim);
    for (let i = 0; i < REBUILD_SITE_LIMIT; i++) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x: HOME.x + 40 + 12 * i,
        y: HOME.y + 30,
        tribe: VIKING,
        owner: SEAT,
        underConstruction: true,
      });
    }
    sim.step();
    expect(rebuilds(sim, houses)).toEqual([]);
  });

  it('raises nothing with an enemy fighter near the old spot', () => {
    const sim = townSim();
    const houses = razedHome(sim);
    spawn(sim, 1, { x: HOME.x + REBUILD_NEAR_POINTS / 2, y: HOME.y }, SPEARMAN, FOE);
    expect(rebuilds(sim, houses)).toEqual([]);
  });

  it('needs a civilian near the old spot, a soldier there building nothing', () => {
    const sim = townSim();
    expect(rebuilds(sim, razedHome(sim, SPEARMAN))).toEqual([]);
  });

  it('remembers the seat’s buildings on its first turn and staffs its town on the handler’s round', () => {
    const sim = townSim();
    place(sim, BAKERY_TYPE, BAKERY);
    const hq = place(sim, HQ_TYPE, HQ);
    spawn(sim, 2, { x: BAKERY.x + 6, y: BAKERY.y }, CIVILIST);
    sim.run(AI_HANDLER_ROUND_TICKS + 1);
    const carrier = aiProgramEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('the seat runs no program');
    expect(sim.world.get(carrier, AiProgram).houses.map((h) => h.buildingType)).toEqual([
      BAKERY_TYPE,
      HQ_TYPE,
    ]);
    expect(sim.world.get(hq, Stockpile).amounts.get(FOOD_SIMPLE)).toBe(AI_STOCK_REFILL_LEVEL);
    const posted = [...sim.world.query(Settler, JobAssignment)].filter(
      (e) => sim.world.get(e, Owner).player === SEAT,
    );
    expect(posted).toHaveLength(2);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('leaves the stores and posts to the strategic economy while it runs', () => {
    const sim = townSim({}, ['collectResources']);
    const hq = place(sim, HQ_TYPE, HQ);
    sim.run(AI_HANDLER_ROUND_TICKS + 1);
    expect(sim.world.get(hq, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBe(0);
  });
});
