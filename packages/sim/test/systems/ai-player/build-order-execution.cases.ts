import { describe, expect, it } from 'vitest';
import { Building, grantScriptUnlock, Settler, setMapPermission } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Simulation } from '../../../src/index.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  REBUILD_DELAY_TICKS,
} from '../../../src/systems/ai-player/index.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  BARRACKS_TYPE,
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
  IRON,
  JOINERY_TYPE,
  MILL_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STOCK_TOP_TYPE,
  STOCK_TYPE,
  TOWER_TYPE,
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

    // The hive/animal-farm/sewery entries are absent from this content; the brewery and the
    // level-2 joinery follow before the gated iron-collector entry.
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

    // Past the gate: the barracks, both bakery upgrades, then the late tail - the second brewery, the two
    // outskirts warehouses, the closing pair of level-2 bakeries and the third warehouse follow, with a
    // tower wherever one lands outside the tower circles, the store coverage rests, and the denser tower
    // ring and the third brewery close the list. The home entries name `home_level_04`, a tier this
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
    let towers = 0;
    for (const expected of [
      BREWERY_TYPE,
      STOCK_TOP_TYPE,
      STOCK_TOP_TYPE,
      BAKERY_TOP_TYPE,
      BAKERY_TOP_TYPE,
      STOCK_TOP_TYPE,
    ]) {
      let next = nextPlacement(sim);
      // The tower coverage entry re-arms whenever a later building lands outside every tower circle.
      for (; next?.kind === 'placeBuilding' && next.buildingType === TOWER_TYPE; next = nextPlacement(sim)) {
        applyAndFinish(sim, next);
        towers++;
      }
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }
    let next = nextPlacement(sim);
    for (; next?.kind === 'placeBuilding' && next.buildingType === TOWER_TYPE; next = nextPlacement(sim)) {
      applyAndFinish(sim, next);
      towers++;
    }
    expect(towers).toBeGreaterThan(0);
    // The third brewery closes the list.
    if (next?.kind !== 'placeBuilding') throw new Error('expected the third brewery');
    expect(next.buildingType).toBe(BREWERY_TYPE);
    applyAndFinish(sim, next);
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
