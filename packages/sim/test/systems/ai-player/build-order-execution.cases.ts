import { describe, expect, it, vi } from 'vitest';
import {
  aiPlayerEntity,
  Building,
  BuildOrderFrontier,
  grantScriptUnlock,
  Owner,
  Settler,
  StalledPlacements,
  setMapPermission,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import { Simulation } from '../../../src/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import { LATE_GAME_FROM_TICKS, SITES_GROW_FROM_TICKS } from '../../../src/systems/ai-player/game-phase.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  REBUILD_DELAY_TICKS,
  STALLED_PLACEMENT_RETRY_DECISIONS,
  sitePace,
  WELL_REACH_NODES,
} from '../../../src/systems/ai-player/index.js';
import { standsAtPost } from '../../../src/systems/conflict/tower-post.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  BARRACKS_TYPE,
  BOWMAN,
  BREWERY_TYPE,
  COLLECTOR,
  completeSites,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  HOME_TOP_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  husbandryContent,
  IRON,
  JOINERY_TYPE,
  MILL_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STOCK_TYPE,
  TOWER_TYPE,
  VEHICLE_YARD_TYPE,
  VIKING,
  WELL_TYPE,
} from './support.js';

/** The build-order executor: entry order, the counts it repairs, the open-site cap and the rebuild delay. */

describe('build-order module (houseBuild)', () => {
  const module = buildOrderModule(DEFAULT_BUILD_ORDER);

  function nextPlacement(sim: Simulation): Command | undefined {
    return [...module.run(sim.world, ctxOf(sim), SEAT)][0];
  }

  function applyAndFinish(sim: Simulation, command: Command): void {
    sim.enqueueSetup(command);
    sim.step();
    completeSites(sim);
  }

  it('uses the roster tribe for expansion and base replacement in an authored mixed-tribe town', () => {
    const sim = aiSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: HQ_X,
      y: HQ_Y,
      tribe: 13,
      owner: SEAT,
    });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME_TYPE, x: 20, y: 8, tribe: 13, owner: SEAT });
    sim.step();
    expect(nextPlacement(sim)).toMatchObject({ kind: 'placeBuilding', tribe: VIKING });
    sim.enqueueSetup({ kind: 'demolish', building: entityOfBuilding(sim, HQ_TYPE) });
    sim.step();
    expect(nextPlacement(sim)).toMatchObject({
      kind: 'placeBuilding',
      buildingType: STOCK_TYPE,
      tribe: VIKING,
    });
  });

  it('executes the opening list in order near the HQ, two open sites at a time', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]); // a live iron node keeps the collector entry waiting
    sim.step();

    // Farm first - on a free node close to the HQ, as a construction site owned by the seat.
    const first = nextPlacement(sim);
    expect(first?.kind).toBe('placeBuilding');
    if (first?.kind !== 'placeBuilding') return;
    expect(first.buildingType).toBe(FARM_TYPE);
    expect(first.underConstruction).toBe(true);
    expect(first.owner).toBe(SEAT);
    const dist = Math.abs(first.x - HQ_X) + Math.abs(first.y - HQ_Y);
    expect(dist).toBeGreaterThan(0); // never on the HQ's own node
    expect(dist).toBeLessThanOrEqual(4); // the closest free ring, not a far scatter
    sim.enqueueSetup(first);
    sim.step();

    // A second site goes up beside the first; with two open the executor stalls until one finishes.
    const second = nextPlacement(sim);
    if (second?.kind !== 'placeBuilding') throw new Error('expected a second placement');
    expect(second.buildingType).toBe(HOME_TYPE);
    sim.enqueueSetup(second);
    sim.step();
    expect(nextPlacement(sim)).toBeUndefined();
    completeSites(sim);

    // Homes fill to their count of three; the entries absent from this content (pottery, mason)
    // are skipped, and the farm→mill→bakery pair→well chain follows.
    for (const expected of [HOME_TYPE, HOME_TYPE, MILL_TYPE, BAKERY_TYPE, BAKERY_TYPE, WELL_TYPE]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }

    // The home-upgrade entry walks each home to the top tier, one upgrade site at a time.
    for (let i = 0; i < 6; i++) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'upgradeBuilding') throw new Error(`expected upgrade ${i}, got ${next?.kind}`);
      applyAndFinish(sim, next);
    }
    const homes = [...sim.world.query(Building)]
      .map((e) => sim.world.get(e, Building).buildingType)
      .filter((t) => t === HOME_TYPE || t === HOME_TOP_TYPE);
    expect(homes).toEqual([HOME_TOP_TYPE, HOME_TOP_TYPE, HOME_TOP_TYPE]);

    // The hive/animal-farm/sewery entries are absent from this content (the animal farm's well skips with
    // no farm standing); the brewery and the level-2 joinery follow before the gated iron-collector entry.
    for (const expected of [BREWERY_TYPE, JOINERY_TYPE]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }

    // The gated iron-collector entry: the executor waits (the workforce module does the hiring); a
    // standing collector unblocks the tail.
    expect(nextPlacement(sim)).toBeUndefined();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: COLLECTOR, x: 12, y: 24, tribe: VIKING, owner: SEAT });
    sim.step();
    const settler = [...sim.world.query(Settler)].at(-1);
    if (settler === undefined) throw new Error('setup: collector missing');
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: settler, x: 14, y: 26 });
    sim.enqueueSetup({ kind: 'setGatherGood', entity: settler, goodType: IRON });
    sim.step();

    // Past the gate: the barracks, both bakery upgrades, then the late tail - the closing pair of level-2
    // bakeries and the second brewery follow, with a tower wherever one lands outside the tower circles,
    // and the third brewery closes the list. The home entries name `home_level_04`, a tier this
    // content set stops short of, so they skip here - the direct top-tier placement has its own test
    // below. The smithy and armory entries are absent from this fixture, so both skip.
    const barracks = nextPlacement(sim);
    if (barracks?.kind !== 'placeBuilding') throw new Error('expected the barracks placement');
    expect(barracks.buildingType).toBe(BARRACKS_TYPE);
    applyAndFinish(sim, barracks);
    for (let i = 0; i < 2; i++) {
      const upgrade = nextPlacement(sim);
      if (upgrade?.kind !== 'upgradeBuilding') throw new Error('expected a bakery upgrade');
      expect(sim.world.get(upgrade.building, Building).buildingType).toBe(BAKERY_TYPE);
      applyAndFinish(sim, upgrade);
    }
    // The joinery stands between the wood and the iron, out past the base's defence circle, so the opening
    // tower entry raises one tower over it; every other building sits inside the store and tower circles.
    for (const expected of [TOWER_TYPE, BAKERY_TOP_TYPE, BAKERY_TOP_TYPE, BREWERY_TYPE, BREWERY_TYPE]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }
    expect(nextPlacement(sim)).toBeUndefined();
  });

  it('keeps placing beside the vehicle yard a workshop crew opened, which holds no site slot', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the opening placement');
    sim.enqueueSetup(first);
    // A joiner's cart cycle opened a yard site of its own; the list did not place it.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: VEHICLE_YARD_TYPE,
      x: HQ_X + 6,
      y: HQ_Y + 6,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    expect([...sim.world.query(UnderConstruction)]).toHaveLength(2);

    // Two sites stand, yet only the farm counts: the second slot of the opening pace is still free.
    const second = nextPlacement(sim);
    expect(second).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    if (second?.kind !== 'placeBuilding') return;
    sim.enqueueSetup(second);
    sim.step();
    expect(nextPlacement(sim)).toBeUndefined();
  });

  it('re-places a destroyed building (the count repairs itself)', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const first = nextPlacement(sim);
    if (first?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    sim.enqueueSetup(first);
    sim.step();
    const farm = entityOfBuilding(sim, FARM_TYPE);
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: farm });
    sim.step();
    sim.enqueueSetup({ kind: 'demolish', building: farm });
    sim.step();
    const again = nextPlacement(sim);
    if (again?.kind !== 'placeBuilding') throw new Error('expected a repair placement');
    expect(again.buildingType).toBe(FARM_TYPE);
  });

  it('keeps within three entries of a site still going up', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const place = (building: string): Extract<BuildOrderEntry, { kind: 'place' }> => ({
      kind: 'place',
      building,
      count: 1,
    });
    // The bakery waits on iron the map lacks, so it skips and takes no place in the lookahead.
    const skipped: BuildOrderEntry = { ...place('work_bakery_00'), needsResources: ['iron'] };
    const chain = buildOrderModule([
      place('work_farm_00'),
      place('work_mill_00'),
      skipped,
      place('work_well_00'),
      place('work_brewery'),
      place('work_joinery_01'),
    ]);
    const next = (): Command | undefined => [...chain.run(sim.world, ctxOf(sim), SEAT)][0];
    const raise = (expected: number, finish: boolean): void => {
      const placed = next();
      if (placed?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(placed.buildingType).toBe(expected);
      sim.enqueueSetup(placed);
      sim.step();
      if (!finish) return;
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, expected) });
      sim.step();
    };

    // The farm stays a site throughout; the mill, the well and the brewery go up and finish beside it.
    raise(FARM_TYPE, false);
    raise(MILL_TYPE, true);
    raise(WELL_TYPE, true);
    raise(BREWERY_TYPE, true);
    // One site is open, but the joinery would run four entries past the unfinished farm.
    expect(next()).toBeUndefined();
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, FARM_TYPE) });
    sim.step();
    raise(JOINERY_TYPE, false);
  });

  it('raises a razed building again only after the rebuild delay, after every loss', () => {
    const sim = aiSim();
    placeHq(sim);
    makeAiSeat(sim, SEAT);
    sim.step();
    // The opening coverage entry sits between the two buildings: re-arming it must not lower the frontier.
    const chain = buildOrderModule([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'towerCoverage', building: 'tower_01' },
      { kind: 'place', building: 'work_mill_00', count: 1 },
    ]);
    const decide = (tick: number): Command[] => [...chain.run(sim.world, ctxOf(sim, tick), SEAT)];
    for (const expected of [FARM_TYPE, MILL_TYPE]) {
      const placed = decide(0)[0];
      if (placed?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(placed.buildingType).toBe(expected);
      applyAndFinish(sim, placed);
    }
    expect(decide(0)).toEqual([]); // the list is done: the frontier stands past its end

    /** Raze `type` at `tick`, and check it waits out the delay before its site is placed again. */
    const razeAndRebuild = (type: number, tick: number): void => {
      sim.enqueueSetup({ kind: 'demolish', building: entityOfBuilding(sim, type) });
      sim.step();
      expect(decide(tick)).toEqual([]);
      expect(decide(tick + REBUILD_DELAY_TICKS - 1)).toEqual([]);
      const again = decide(tick + REBUILD_DELAY_TICKS)[0];
      if (again?.kind !== 'placeBuilding') throw new Error(`expected type ${type} placed again`);
      expect(again.buildingType).toBe(type);
      applyAndFinish(sim, again);
      expect(decide(tick + REBUILD_DELAY_TICKS)).toEqual([]);
    };
    razeAndRebuild(MILL_TYPE, 100); // the last entry, at the frontier's edge
    razeAndRebuild(FARM_TYPE, 1000); // a second loss waits again

    // An outlying home re-arms the coverage entry below the mill; the tower goes up at once.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const tower = decide(2000)[0];
    if (tower?.kind !== 'placeBuilding') throw new Error('expected a covering tower');
    expect(tower.buildingType).toBe(TOWER_TYPE);
    applyAndFinish(sim, tower);
    razeAndRebuild(MILL_TYPE, 3000);
  });

  it('counts an upgrade in flight as met, and goes on with the list beside it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const chain = buildOrderModule([
      { kind: 'place', building: 'work_bakery_00', count: 1 },
      { kind: 'upgrade', building: 'work_bakery_01', count: 1 },
      { kind: 'place', building: 'work_farm_00', count: 1 },
    ]);
    const next = (): Command | undefined => [...chain.run(sim.world, ctxOf(sim), SEAT)][0];
    const bakery = next();
    if (bakery?.kind !== 'placeBuilding') throw new Error('expected the bakery placement');
    applyAndFinish(sim, bakery);
    const upgrade = next();
    if (upgrade?.kind !== 'upgradeBuilding') throw new Error('expected the bakery upgrade');
    sim.enqueueSetup(upgrade);
    sim.step();
    expect(next()).toMatchObject({ kind: 'placeBuilding', buildingType: FARM_TYPE });
  });

  it('opens a third site from the growth clock and a fourth from the late game', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    expect(sitePace(0)).toEqual({ fromTick: 0, sites: 2, lookahead: 3 });
    expect(sitePace(SITES_GROW_FROM_TICKS)).toEqual({
      fromTick: SITES_GROW_FROM_TICKS,
      sites: 3,
      lookahead: 4,
    });
    expect(sitePace(LATE_GAME_FROM_TICKS)).toEqual({
      fromTick: LATE_GAME_FROM_TICKS,
      sites: 4,
      lookahead: 5,
    });

    const openAt = (tick: number): Command | undefined =>
      [...module.run(sim.world, ctxOf(sim, tick), SEAT)][0];
    const sites = (): number => [...sim.world.query(UnderConstruction)].length;
    for (let open = 0; open < sitePace(LATE_GAME_FROM_TICKS).sites; open++) {
      expect(sites()).toBe(open);
      // Each step holds at its own cap while the next one opens another site.
      if (open >= sitePace(0).sites) expect(openAt(0)).toBeUndefined();
      if (open >= sitePace(SITES_GROW_FROM_TICKS).sites)
        expect(openAt(SITES_GROW_FROM_TICKS)).toBeUndefined();
      const tick =
        open < sitePace(0).sites
          ? 0
          : open < sitePace(SITES_GROW_FROM_TICKS).sites
            ? SITES_GROW_FROM_TICKS
            : LATE_GAME_FROM_TICKS;
      const next = openAt(tick);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected site ${open + 1} at tick ${tick}`);
      sim.enqueueSetup(next);
      sim.step();
    }
    expect(openAt(LATE_GAME_FROM_TICKS)).toBeUndefined();
  });

  it('runs a reached lane beside the list: one site of its own, the rest of the clock to the list', () => {
    const laned = buildOrderModule([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'towerCoverage', building: 'tower_01', lane: true },
      { kind: 'place', building: 'home_level_00', count: 4 },
    ]);
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const act = (): Command | undefined => {
      const commands = [...laned.run(sim.world, ctxOf(sim, LATE_GAME_FROM_TICKS), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    const placed = (): number[] =>
      [...sim.world.query(UnderConstruction)].map((e) => sim.world.get(e, Building).buildingType);
    // The farm holds the list until its site stands; then the lane is reached, satisfied while every
    // building sits in the HQ circle, and the list goes on to the homes.
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: FARM_TYPE });
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    // A home out at the edge re-arms the lane: the tower goes up first, out of the lane's own site.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: TOWER_TYPE });
    // The late clock keeps four sites: the lane holds one, so the list still opens a third of its own
    // beside the farm and the home, then stops at the clock's four.
    expect(placed().sort((a, b) => a - b)).toEqual([FARM_TYPE, HOME_TYPE, TOWER_TYPE].sort((a, b) => a - b));
    expect(act()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
    expect(act()).toBeUndefined();
    expect(placed()).toHaveLength(sitePace(LATE_GAME_FROM_TICKS).sites);
  });

  it('never holds the list on a lane with no room for its building', () => {
    // A store lane whose one target, a gatherer's flag, lies far past any spot the seat may build on: the
    // lane finds nothing, and the list goes on regardless.
    const STORE_RADIUS = 19;
    const laned = buildOrderModule([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'storeCoverage', building: 'stock_02', radius: STORE_RADIUS, lane: true },
      { kind: 'place', building: 'home_level_00', count: 2 },
    ]);
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(240, 32) });
    placeHq(sim);
    const FAR_FLAG = { x: HQ_X + 190, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: COLLECTOR,
      x: FAR_FLAG.x + 2,
      y: FAR_FLAG.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const gatherer = [...sim.world.query(Settler)].find(
      (e) => sim.world.get(e, Settler).jobType === COLLECTOR,
    );
    if (gatherer === undefined) throw new Error('setup: a gatherer');
    sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: FAR_FLAG.x, y: FAR_FLAG.y });
    sim.step();
    const next = (): Command | undefined => [...laned.run(sim.world, ctxOf(sim), SEAT)][0];
    const farm = next();
    if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm');
    applyAndFinish(sim, farm);
    expect(next()).toMatchObject({ kind: 'placeBuilding', buildingType: HOME_TYPE });
  });

  it('looks one entry further past the oldest open site from each pace step', () => {
    const paced = buildOrderModule([
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'place', building: 'home_level_00', count: 1 },
      { kind: 'place', building: 'work_well_00', count: 1 },
      { kind: 'place', building: 'work_mill_00', count: 1 },
      { kind: 'place', building: 'work_bakery_00', count: 1 },
      { kind: 'place', building: 'work_brewery', count: 1 },
    ]);
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const act = (tick: number): Command | undefined => {
      const commands = [...paced.run(sim.world, ctxOf(sim, tick), SEAT)];
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
      return commands[0];
    };
    const finish = (buildingType: number): void => {
      sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, buildingType) });
      sim.step();
    };
    // The farm's site stays open; each entry behind it finishes at once, so the site cap never binds.
    expect(act(0)?.kind).toBe('placeBuilding');
    for (const built of [HOME_TYPE, WELL_TYPE, MILL_TYPE]) {
      expect(act(0)?.kind).toBe('placeBuilding');
      finish(built);
    }
    // The bakery lies four entries past the farm: beyond the opening's lookahead, inside the next step's.
    expect(act(0)).toBeUndefined();
    expect(act(SITES_GROW_FROM_TICKS)?.kind).toBe('placeBuilding');
    finish(BAKERY_TYPE);
    expect(act(SITES_GROW_FROM_TICKS)).toBeUndefined();
    expect(act(LATE_GAME_FROM_TICKS)?.kind).toBe('placeBuilding');
  });

  it('upgrades two buildings side by side, each in-flight upgrade meeting its share of the entry', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const bakeries = buildOrderModule([
      { kind: 'place', building: 'work_bakery_00', count: 2 },
      { kind: 'place', building: 'work_farm_00', count: 1 },
      { kind: 'place', building: 'work_mill_00', count: 1 },
      { kind: 'place', building: 'work_well_00', count: 1 },
      { kind: 'upgrade', building: 'work_bakery_01', count: 2 },
    ]);
    const next = (): Command | undefined => [...bakeries.run(sim.world, ctxOf(sim), SEAT)][0];
    for (let i = 0; i < 5; i++) {
      const placed = next();
      if (placed?.kind !== 'placeBuilding') throw new Error('expected a placement');
      applyAndFinish(sim, placed);
    }
    const first = next();
    if (first?.kind !== 'upgradeBuilding') throw new Error('expected the first upgrade');
    sim.enqueueSetup(first);
    sim.step();
    const second = next();
    if (second?.kind !== 'upgradeBuilding') throw new Error('expected the second upgrade beside the first');
    expect(second.building).not.toBe(first.building);
    sim.enqueueSetup(second);
    sim.step();
    expect(next()).toBeUndefined();
  });

  it('skips a place entry while the map holds none of the good it works up', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const gated = buildOrderModule([
      { kind: 'place', building: 'work_bakery_00', count: 1, needsResources: ['iron'] },
      { kind: 'place', building: 'work_farm_00', count: 1 },
    ]);
    const passedOver = [...gated.run(sim.world, ctxOf(sim), SEAT)][0];
    if (passedOver?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(passedOver.buildingType).toBe(FARM_TYPE);

    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const placed = [...gated.run(sim.world, ctxOf(sim), SEAT)][0];
    if (placed?.kind !== 'placeBuilding') throw new Error('expected the bakery placement');
    expect(placed.buildingType).toBe(BAKERY_TYPE);
  });

  it('holds a collector entry until its whole count of gatherers stands', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    const order = buildOrderModule([
      { kind: 'collector', good: 'iron', count: 2 },
      { kind: 'place', building: 'work_farm_00', count: 1 },
    ]);
    const flagIronGatherer = (): void => {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: COLLECTOR,
        x: 12,
        y: 24,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      const settler = [...sim.world.query(Settler)].at(-1);
      if (settler === undefined) throw new Error('setup: collector missing');
      sim.enqueueSetup({ kind: 'setWorkFlag', entity: settler, x: 14, y: 26 });
      sim.enqueueSetup({ kind: 'setGatherGood', entity: settler, goodType: IRON });
      sim.step();
    };
    flagIronGatherer();
    expect([...order.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]); // one of two: still waiting
    flagIronGatherer();
    const placed = [...order.run(sim.world, ctxOf(sim), SEAT)][0];
    if (placed?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(placed.buildingType).toBe(FARM_TYPE);
  });

  it('stalls when nothing can upgrade toward the entry tier yet', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const upgradeOnly = buildOrderModule([{ kind: 'upgrade', building: 'home_level_02', count: 1 }]);
    expect([...upgradeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('places a further home straight at the top tier instead of growing it', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    // The tail's housing rule: the opening homes walk the upgrade chain, but every home after them
    // is placed at the top tier outright - its own construction bill.
    const topHomes = buildOrderModule([{ kind: 'place', building: 'home_level_02', count: 1 }]);
    const first = [...topHomes.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the top-tier home placement');
    expect(first.buildingType).toBe(HOME_TOP_TYPE);
  });

  it('counts an upgraded building for its place entry instead of building a duplicate', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    const placeOnly = buildOrderModule([{ kind: 'place', building: 'work_bakery_00', count: 1 }]);
    const first = [...placeOnly.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the bakery placement');
    applyAndFinish(sim, first);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    applyAndFinish(sim, { kind: 'upgradeBuilding', building: bakery });
    // The building now stands at the upper tier - the level-0 place entry stays satisfied.
    expect(sim.world.get(bakery, Building).buildingType).toBe(BAKERY_TOP_TYPE);
    expect([...placeOnly.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });
});

it('does not issue an upgrade blocked by map permissions and resumes once a script allows it', () => {
  const sim = aiSim();
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HOME_TYPE,
    tribe: VIKING,
    owner: SEAT,
    x: HQ_X + 8,
    y: HQ_Y,
    force: true,
  });
  sim.step();
  const target = sim.content.buildings.find((b) => b.typeId === HOME_TOP_TYPE);
  const next = sim.content.buildings.find((b) => b.typeId === HOME_TYPE)?.upgradeTarget;
  if (target === undefined || next === undefined) throw new Error('Missing fixture upgrade chain');
  const module = buildOrderModule([{ kind: 'upgrade', building: target.id, count: 1 }]);
  setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'house', typeId: next, allowed: false });
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  // An Enable grant leaves the ban in place; only an Allow lifts it.
  grantScriptUnlock(sim.world, 'enabled', SEAT, VIKING, 'house', next);
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  grantScriptUnlock(sim.world, 'allowed', SEAT, VIKING, 'house', next);
  expect([...module.run(sim.world, ctxOf(sim), SEAT)]).toMatchObject([{ kind: 'upgradeBuilding' }]);
});

/** The enemy seat in the bakery well cases. */
const FOE = 3;

describe('build order - the bakery wells', () => {
  const NEAR_BAKERY = { x: 34, y: 16 };
  const FAR_BAKERY = { x: 6, y: 16 };
  const order: readonly BuildOrderEntry[] = [
    {
      kind: 'place',
      building: 'work_well_00',
      count: 5,
      near: [{ kind: 'building', id: 'work_bakery_00' }],
      unlessWithin: { building: 'work_bakery_00', radius: WELL_REACH_NODES },
    },
    { kind: 'place', building: 'work_mill_00', count: 1 },
  ];

  /** Two bakeries, the far one at the upgraded tier, and a well beside the near one plus one per `wells`. */
  function bakerySeat(wells: readonly { x: number; y: number }[]): Command | undefined {
    const sim = aiSim();
    placeHq(sim);
    const sites = [
      { buildingType: BAKERY_TYPE, ...NEAR_BAKERY },
      { buildingType: BAKERY_TOP_TYPE, ...FAR_BAKERY },
      { buildingType: WELL_TYPE, x: NEAR_BAKERY.x + 4, y: NEAR_BAKERY.y },
      ...wells.map((at) => ({ buildingType: WELL_TYPE, ...at })),
    ];
    for (const site of sites)
      sim.enqueueSetup({ kind: 'placeBuilding', ...site, tribe: VIKING, owner: SEAT });
    sim.step();
    return [...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0];
  }

  it('raises a well beside the bakery that has none in reach, an upgraded one included', () => {
    const well = bakerySeat([]);
    if (well?.kind !== 'placeBuilding') throw new Error('expected a well placement');
    expect(well.buildingType).toBe(WELL_TYPE);
    expect(Math.abs(well.x - FAR_BAKERY.x) + Math.abs(well.y - FAR_BAKERY.y)).toBeLessThan(WELL_REACH_NODES);
  });

  /** The far bakery under fire: manned foe towers north and south of it put every node in a well's reach of
   *  it under fire (the reach disc is wider in rows than in columns, so one post's Manhattan reach cannot
   *  cover it), and the seat's well entry can only be passed over. */
  function wellUnderFireSeat(): Simulation {
    const sim = aiSim();
    placeHq(sim);
    for (const site of [
      { buildingType: BAKERY_TYPE, ...NEAR_BAKERY },
      { buildingType: BAKERY_TOP_TYPE, ...FAR_BAKERY },
      { buildingType: WELL_TYPE, x: NEAR_BAKERY.x + 4, y: NEAR_BAKERY.y },
    ]) {
      sim.enqueueSetup({ kind: 'placeBuilding', ...site, tribe: VIKING, owner: SEAT });
    }
    const posts = [
      { x: FAR_BAKERY.x, y: FAR_BAKERY.y - 4 },
      { x: FAR_BAKERY.x, y: FAR_BAKERY.y + 4 },
    ];
    for (const at of posts) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: TOWER_TYPE, ...at, tribe: VIKING, owner: FOE });
    }
    sim.step();
    const towers = [...sim.world.query(Building)].filter((e) => sim.world.get(e, Owner).player === FOE);
    expect(towers).toHaveLength(posts.length);
    for (const at of posts) {
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: BOWMAN,
        x: at.x + 4,
        y: at.y,
        tribe: VIKING,
        owner: FOE,
      });
    }
    sim.step();
    const archers = [...sim.world.query(Settler, Owner)].filter(
      (e) => sim.world.get(e, Owner).player === FOE,
    );
    expect(archers).toHaveLength(posts.length);
    for (const [i, archer] of archers.entries()) {
      const tower = towers[i];
      if (tower === undefined) throw new Error('setup: fewer towers than archers');
      sim.enqueueSetup({ kind: 'assignWorker', entity: archer, building: tower, jobPriority: [BOWMAN] });
    }
    for (let i = 0; i < 200; i++) sim.step();
    for (const archer of archers) expect(standsAtPost(sim.world, archer)).not.toBeNull();
    return sim;
  }

  it('passes the well over, rather than stalling the list, when no spot in reach of the bakery is legal', () => {
    const sim = wellUnderFireSeat();
    expect([...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0]).toMatchObject({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
    });
  });

  it('keeps placing past a passed-over well decision after decision, its frontier untouched and nothing holding the list', () => {
    // A seat with an AI carrier keeps a frontier: the passed-over well must not move it, or the well, unmet
    // below it next decision, would read as a razed building and hold the list for the rebuild delay.
    const sim = wellUnderFireSeat();
    makeAiSeat(sim, SEAT);
    const homesToo = buildOrderModule([...order, { kind: 'place', building: 'home_level_00', count: 3 }]);
    const placed: number[] = [];
    for (let decision = 0; decision < 5; decision++) {
      const tick = SEAT + decision * AI_DECISION_INTERVAL_TICKS;
      const command = [...homesToo.run(sim.world, ctxOf(sim, tick), SEAT)][0];
      if (command === undefined) break;
      if (command.kind !== 'placeBuilding') throw new Error('expected a placement');
      placed.push(command.buildingType);
      sim.enqueueSetup(command);
      sim.step();
      completeSites(sim);
    }
    expect(placed).toEqual([MILL_TYPE, HOME_TYPE, HOME_TYPE, HOME_TYPE]);
    const carrier = aiPlayerEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI carrier');
    expect(sim.world.tryGet(carrier, BuildOrderFrontier)).toEqual({ entry: 3, rebuildTick: null });
    // The well's failed search waits out its retry like any other; it holds nothing.
    const stalled = sim.world.tryGet(carrier, StalledPlacements);
    expect(stalled?.holding).toBeNull();
    expect([...(stalled?.retryTicks.keys() ?? [])]).toEqual([0]);
  });

  it('opens the lanes behind a passed-over well', () => {
    const sim = wellUnderFireSeat();
    // A home out at the east edge, far from the fire in the west, re-arms the tower lane after the well.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const laned = buildOrderModule([
      order[0] ?? { kind: 'collector', good: 'wood' },
      { kind: 'towerCoverage', building: 'tower_01', lane: true },
      { kind: 'place', building: 'work_mill_00', count: 1 },
    ]);
    expect([...laned.run(sim.world, ctxOf(sim, LATE_GAME_FROM_TICKS), SEAT)][0]).toMatchObject({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
    });
  });

  it('skips the well once every bakery has one in reach', () => {
    expect(bakerySeat([{ x: FAR_BAKERY.x + 4, y: FAR_BAKERY.y }])).toMatchObject({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
    });
  });
});

describe('build order - the animal farm well', () => {
  const FARM = { x: 44, y: 16 };
  const order: readonly BuildOrderEntry[] = [
    {
      kind: 'place',
      building: 'work_well_00',
      count: 3,
      near: [{ kind: 'building', id: 'work_animal_farm' }],
      unlessWithin: { building: 'work_animal_farm', radius: WELL_REACH_NODES },
    },
    // Acts only once the well entry counts as done, so a skip is told apart from a stall.
    { kind: 'place', building: 'work_mill_00', count: 1 },
  ];

  function animalFarmSeat(wellX: number): Command | undefined {
    const content = husbandryContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    for (const [buildingType, x] of [
      [WELL_TYPE, wellX],
      [ANIMAL_FARM_TYPE, FARM.x],
    ] as const) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y: FARM.y, tribe: VIKING, owner: SEAT });
    }
    sim.step();
    return [...buildOrderModule(order).run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
  }

  it('skips the well while one already stands beside the animal farm', () => {
    expect(animalFarmSeat(FARM.x + 4)).toMatchObject({ kind: 'placeBuilding', buildingType: MILL_TYPE });
  });

  it('raises a well beside the animal farm when the first stands farther off', () => {
    const well = animalFarmSeat(FARM.x - 3 * WELL_REACH_NODES);
    if (well?.kind !== 'placeBuilding') throw new Error('expected a well placement');
    expect(well.buildingType).toBe(WELL_TYPE);
    expect(Math.abs(well.x - FARM.x) + Math.abs(well.y - FARM.y)).toBeLessThan(WELL_REACH_NODES);
  });
});

describe('build order - a coverage entry with no spot', () => {
  const WATER = 1;
  const POCKET_RADIUS = 10;
  const ISLAND = { x: HQ_X + 31, y: HQ_Y };

  /** Grass in a pocket round the HQ and on one far node, water everywhere else: nothing within a tower's
   *  reach of the far node is buildable, so no tower can ever cover a home standing on it. */
  function islandSim(): Simulation {
    const width = 64;
    const height = 32;
    const typeIds = new Array<number>(width * height).fill(WATER);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= POCKET_RADIUS) typeIds[y * width + x] = 0;
      }
    }
    typeIds[ISLAND.y * width + ISLAND.x] = 0;
    const sim = new Simulation({
      seed: 1,
      content: aiContent(),
      map: { resolution: 'half-cell', width, height, typeIds },
    });
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      ...ISLAND,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
    sim.step();
    return sim;
  }

  it('searches a lane with no room only every retry interval', () => {
    const sim = islandSim();
    makeAiSeat(sim, SEAT);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped sim');
    const groundTests = vi.spyOn(terrain, 'isBuildable');
    const lane = buildOrderModule([{ kind: 'towerCoverage', building: 'tower_01', lane: true }]);
    const searchedAt: number[] = [];
    for (let decision = 0; decision <= 2 * STALLED_PLACEMENT_RETRY_DECISIONS; decision++) {
      const before = groundTests.mock.calls.length;
      const tick = LATE_GAME_FROM_TICKS + SEAT + decision * AI_DECISION_INTERVAL_TICKS;
      expect([...lane.run(sim.world, ctxOf(sim, tick), SEAT)]).toEqual([]);
      if (groundTests.mock.calls.length > before) searchedAt.push(decision);
    }
    expect(searchedAt).toEqual([0, STALLED_PLACEMENT_RETRY_DECISIONS, 2 * STALLED_PLACEMENT_RETRY_DECISIONS]);
  });

  it('passes a tower entry over, like a store entry, when no target it has can be covered', () => {
    const sim = islandSim();
    expect(sim.world.get(entityOfBuilding(sim, HOME_TYPE), Building).buildingType).toBe(HOME_TYPE);
    const towersFirst = buildOrderModule([
      { kind: 'towerCoverage', building: 'tower_01' },
      { kind: 'place', building: 'work_mill_00', count: 1 },
    ]);
    expect([...towersFirst.run(sim.world, ctxOf(sim), SEAT)][0]).toMatchObject({
      kind: 'placeBuilding',
      buildingType: MILL_TYPE,
    });
  });
});
