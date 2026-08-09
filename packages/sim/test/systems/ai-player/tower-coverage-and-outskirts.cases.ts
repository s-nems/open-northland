import { describe, expect, it } from 'vitest';
import { withinNodeRadius } from '../../../src/nav/node-circle.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  buildOrderModule,
  TOWER_DEFENCE_RADIUS_NODES,
} from '../../../src/systems/ai-player/index.js';
import {
  aiSim,
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

describe('build-order tower coverage and outskirts', () => {
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
    // The spot actually covers the target (world-metric circle) and stays inside the HQ disc.
    expect(withinNodeRadius(order.x, order.y, FAR.x, FAR.y, TOWER_DEFENCE_RADIUS_NODES)).toBe(true);
    expect(Math.abs(order.x - HQ_X) + Math.abs(order.y - HQ_Y)).toBeLessThanOrEqual(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );

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

  it('pushes an outskirts placement past the frontier building and spreads successive warehouses', () => {
    const sim = aiSim();
    placeHq(sim);
    const FRONTIER = { x: HQ_X + 14, y: HQ_Y };
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: FRONTIER.x,
      y: FRONTIER.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const stocks = buildOrderModule([
      { kind: 'place', building: 'stock_02', count: 2, near: [{ kind: 'outskirts' }] },
    ]);
    const first = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the first warehouse placement');
    expect(first.buildingType).toBe(STOCK_TOP_TYPE);
    // The spot lands on the far side of the frontier building - farther from the settlement
    // centroid than the frontier itself.
    const centroid = { x: Math.floor((HQ_X + FRONTIER.x) / 2), y: HQ_Y };
    const frontierDist = Math.abs(FRONTIER.x - centroid.x) + Math.abs(FRONTIER.y - centroid.y);
    const spotDist = Math.abs(first.x - centroid.x) + Math.abs(first.y - centroid.y);
    expect(spotDist).toBeGreaterThan(frontierDist);
    sim.enqueueSetup(first);
    sim.step();
    completeSites(sim);

    // The second warehouse never anchors on the first (its own kind is excluded from the frontier
    // pick) - the pair spreads instead of stacking.
    const second = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (second?.kind !== 'placeBuilding') throw new Error('expected the second warehouse placement');
    expect(second.x === first.x && second.y === first.y).toBe(false);
  });

  it('sends apart warehouses to opposite wings of the settlement', () => {
    const sim = aiSim();
    placeHq(sim);
    for (const dx of [14, -14]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HOME_TYPE,
        x: HQ_X + dx,
        y: HQ_Y,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    sim.step();
    const stocks = buildOrderModule([
      { kind: 'place', building: 'stock_02', count: 2, near: [{ kind: 'outskirts' }], apart: true },
    ]);
    const first = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (first?.kind !== 'placeBuilding') throw new Error('expected the first warehouse placement');
    sim.enqueueSetup(first);
    sim.step();
    completeSites(sim);

    // The second warehouse anchors past the frontier of the wing the first one did NOT take, rather
    // than on a spacing ring around it: the two straddle the HQ.
    const second = [...stocks.run(sim.world, ctxOf(sim), SEAT)][0];
    if (second?.kind !== 'placeBuilding') throw new Error('expected the second warehouse placement');
    expect(Math.sign(first.x - HQ_X)).toBe(-Math.sign(second.x - HQ_X));
  });
});
