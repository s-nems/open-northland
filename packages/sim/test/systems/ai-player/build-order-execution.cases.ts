import { describe, expect, it } from 'vitest';
import { Building, Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Simulation } from '../../../src/index.js';
import { buildOrderModule, DEFAULT_BUILD_ORDER } from '../../../src/systems/ai-player/index.js';
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
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STOCK_TOP_TYPE,
  STOCK_TYPE,
  VIKING,
  WELL_TYPE,
} from './support.js';

/** The build-order executor: entry order, the counts it repairs, and the one-open-site stall. */

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

  it('executes the opening list in order near the HQ, one open site at a time', () => {
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

    // One open site - the executor stalls until it finishes.
    expect(nextPlacement(sim)).toBeUndefined();
    completeSites(sim);

    // Homes fill to their count of three; the entries absent from this content (pottery, mason)
    // are skipped, and the farm→mill→bakery/well chain follows.
    for (const expected of [HOME_TYPE, HOME_TYPE, HOME_TYPE, MILL_TYPE, BAKERY_TYPE, WELL_TYPE]) {
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

    // Past the gate: the barracks, the bakery upgrade, then the late tail - the tower coverage entry
    // rests (everything sits inside the HQ circle on this map), the second bakery arrives directly at
    // its level-2 tier, the second brewery, the two outskirts warehouses, and the closing pair of
    // level-2 bakeries end the list. The five-home entry names `home_level_04`, a tier this content
    // set stops short of, so it skips here - the direct top-tier placement has its own test below.
    // The smithy and armory entries are absent from this fixture, so both skip.
    const barracks = nextPlacement(sim);
    if (barracks?.kind !== 'placeBuilding') throw new Error('expected the barracks placement');
    expect(barracks.buildingType).toBe(BARRACKS_TYPE);
    applyAndFinish(sim, barracks);
    const upgrade = nextPlacement(sim);
    if (upgrade?.kind !== 'upgradeBuilding') throw new Error('expected the bakery upgrade');
    expect(sim.world.get(upgrade.building, Building).buildingType).toBe(BAKERY_TYPE);
    applyAndFinish(sim, upgrade);
    for (const expected of [
      BAKERY_TOP_TYPE,
      BREWERY_TYPE,
      STOCK_TOP_TYPE,
      STOCK_TOP_TYPE,
      BAKERY_TOP_TYPE,
      BAKERY_TOP_TYPE,
    ]) {
      const next = nextPlacement(sim);
      if (next?.kind !== 'placeBuilding') throw new Error(`expected a placement of type ${expected}`);
      expect(next.buildingType).toBe(expected);
      applyAndFinish(sim, next);
    }
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
