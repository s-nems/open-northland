import { describe, expect, it } from 'vitest';
import { Settler } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { withinNodeRadius } from '../../../src/nav/node-circle.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  buildOrderModule,
  TOWER_DEFENCE_RADIUS_NODES,
} from '../../../src/systems/ai-player/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BAKERY_TYPE,
  COLLECTOR,
  completeSites,
  ctxOf,
  HOME_TYPE,
  HQ_X,
  HQ_Y,
  placeHq,
  SEAT,
  STOCK_TOP_TYPE,
  TOWER_TYPE,
  VIKING,
  WALL_TYPE,
} from './support.js';

describe('build-order tower and store coverage', () => {
  const coverage = buildOrderModule([{ kind: 'towerCoverage', building: 'tower_01' }]);

  it('rests while every building sits in the HQ circle, then covers an outlying one', () => {
    const sim = aiSim();
    placeHq(sim);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);

    // A home 31 columns east leaves the 29-node circle: the next decision places a covering tower.
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement');
    expect(order.buildingType).toBe(TOWER_TYPE);
    expect(order.underConstruction).toBe(true);
    // The spot actually covers the target (world-metric circle) and stays within building reach.
    expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, TOWER_DEFENCE_RADIUS_NODES)).toBe(true);
    const nearest = Math.min(
      Math.abs(order.x - HQ_X) + Math.abs(order.y - HQ_Y),
      Math.abs(order.x - FAR.x) + Math.abs(order.y - FAR.y),
    );
    expect(nearest).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES);

    // The tower SITE already counts as coverage; a finished tower keeps the entry satisfied - and
    // the entry is perpetual: another far building re-arms it.
    sim.enqueueSetup(order);
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    completeSites(sim);
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X - 31,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect([...coverage.run(sim.world, ctxOf(sim), SEAT)]).toHaveLength(1);
  });

  it('never counts the defence wall (shared kind, different id) as a covering tower', () => {
    const sim = aiSim();
    placeHq(sim);
    const FAR = { x: HQ_X + 31, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FAR.x,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WALL_TYPE,
      x: FAR.x - 2,
      y: FAR.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    // The wall shares kind 'tower' but is not in the tower id allowlist - the home stays uncovered.
    const order = [...coverage.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'placeBuilding') throw new Error('expected a tower placement despite the wall');
    expect(order.buildingType).toBe(TOWER_TYPE);
  });

  describe('store coverage', () => {
    /** A store circle small enough for the fixture map to hold ground outside it. */
    const radius = 19;
    const stores = buildOrderModule([{ kind: 'storeCoverage', building: 'stock_02', radius }]);
    const place = (sim: Simulation, buildingType: number, x: number, y: number): void =>
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y, tribe: VIKING, owner: SEAT });
    const next = (sim: Simulation) => [...stores.run(sim.world, ctxOf(sim), SEAT)][0];
    const flagAt = (sim: Simulation, at: { x: number; y: number }): void => {
      const before = new Set(sim.world.query(Settler));
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: COLLECTOR,
        x: at.x + 2,
        y: at.y,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      const gatherer = [...sim.world.query(Settler)].find((e) => !before.has(e));
      if (gatherer === undefined) throw new Error('setup: no gatherer');
      sim.enqueueSetup({ kind: 'setWorkFlag', entity: gatherer, x: at.x, y: at.y });
      sim.step();
    };

    it('covers an outlying workshop with a warehouse clear of every store, and no home or tower', () => {
      const sim = aiSim();
      placeHq(sim);
      // A home and a tower out at the edge need no warehouse beside them.
      place(sim, HOME_TYPE, HQ_X + 31, HQ_Y);
      place(sim, TOWER_TYPE, HQ_X - 31, HQ_Y);
      sim.step();
      expect(next(sim)).toBeUndefined();

      const FAR = { x: HQ_X + 29, y: HQ_Y };
      place(sim, BAKERY_TYPE, FAR.x, FAR.y);
      sim.step();
      const order = next(sim);
      if (order?.kind !== 'placeBuilding') throw new Error('expected a warehouse placement');
      expect(order.buildingType).toBe(STOCK_TOP_TYPE);
      expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, radius)).toBe(true);
      // Not beside the HQ, itself a store: the new circle starts where the HQ's ends.
      expect(withinNodeRadius(HQ_X, HQ_Y, order.x, order.y, radius)).toBe(false);

      sim.enqueueSetup(order);
      sim.step();
      expect(next(sim)).toBeUndefined();
    });

    it("covers a gatherer's work flag, where the mined goods pile up", () => {
      const sim = aiSim();
      placeHq(sim);
      const FLAG = { x: HQ_X - 28, y: HQ_Y + 6 };
      flagAt(sim, FLAG);
      const order = next(sim);
      if (order?.kind !== 'placeBuilding') throw new Error('expected a warehouse placement at the flag');
      expect(withinNodeRadius(order.x, order.y, FLAG.x, FLAG.y, radius)).toBe(true);
      sim.enqueueSetup(order);
      sim.step();
      expect(next(sim)).toBeUndefined();
    });

    it('passes a flag beyond the build reach over and covers the next target', () => {
      // A long map: the first gatherer's flag lies far past any spot the seat may build on.
      const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(240, 32) });
      placeHq(sim);
      const FAR = { x: HQ_X + 190, y: HQ_Y };
      const NEAR = { x: HQ_X + 28, y: HQ_Y };
      flagAt(sim, FAR);
      flagAt(sim, NEAR);
      const order = next(sim);
      if (order?.kind !== 'placeBuilding') throw new Error('expected a warehouse placement at the near flag');
      expect(withinNodeRadius(order.x, order.y, NEAR.x, NEAR.y, radius)).toBe(true);
      sim.enqueueSetup(order);
      sim.step();
      // The far flag stays uncovered, and the entry rests rather than stalling on it.
      expect(next(sim)).toBeUndefined();
    });
  });
});
