import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../../../../src/index.js';
import { ownedBuildings } from '../../../../../src/systems/ai-shared/seat-roster.js';
import type {
  BuildOrder,
  BuildOrderEntry,
} from '../../../../../src/systems/computer-player/build-order/order/entries.js';
import {
  collectorGoodsWanted,
  entryStatuses,
  lineStatuses,
} from '../../../../../src/systems/computer-player/build-order/steps/status.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  makeAiSeat,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  VIKING,
} from '../../support.js';

function seat(ironStock = 0, ironOnMap = true): Simulation {
  const sim = aiSim();
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    initialGoods: [{ good: IRON, amount: ironStock }],
  });
  if (ironOnMap) placeResources(sim, [RESOURCE_SPOTS.iron]);
  makeAiSeat(sim, SEAT, { houseBuild: false });
  sim.step();
  return sim;
}

describe('build order progress', () => {
  it("counts a building rising to a placement step's tier, so no copy goes up beside the upgrade", () => {
    const entry: BuildOrderEntry = { kind: 'place', building: 'work_bakery_01', count: 1 };
    const sim = seat();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['unmet']);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: bakery, target: BAKERY_TOP_TYPE });
    sim.step();
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['satisfied']);
  });

  it('passes a collector over while its good lies stocked, hiring again under half of it', () => {
    const STOCKED = 10;
    const gatherer: BuildOrderEntry = { kind: 'collector', good: 'iron', stockedAt: STOCKED };
    const status = (stock: number) => {
      const sim = seat(stock);
      return entryStatuses(sim.world, ctxOf(sim), SEAT, [gatherer])[0];
    };
    expect(status(STOCKED)).toBe('skip');
    expect(status(STOCKED / 2)).toBe('skip');
    expect(status(STOCKED / 2 - 1)).toBe('unmet');
  });

  it('holds a gatherer until every building of an all-hold stands, dropping one the order never raises', () => {
    const waitsOn = (building: string): BuildOrderEntry => ({
      kind: 'collector',
      good: 'iron',
      holdUntil: {
        kind: 'all',
        holds: [
          { kind: 'built', building: 'work_bakery_00' },
          { kind: 'built', building },
        ],
      },
    });
    const wanted = (sim: Simulation, gatherer: BuildOrderEntry, brewery = false): boolean => {
      const order: BuildOrder = {
        lines: [
          { id: 'bread', steps: [{ kind: 'place', building: 'work_bakery_00', count: 1 }] },
          { id: 'brewery', steps: brewery ? [{ kind: 'place', building: 'work_brewery', count: 1 }] : [] },
          { id: 'weapons', steps: [gatherer] },
        ],
        priority: [],
      };
      const statuses = lineStatuses(sim.world, ctxOf(sim), SEAT, ownedBuildings(sim.world, SEAT), order);
      return collectorGoodsWanted(order, statuses, sim.tick).has('iron');
    };
    const sim = seat();
    // Nothing raises the second building, so only the bakery holds the gatherer back.
    const gatherer = waitsOn('no_such_building');
    expect(wanted(sim, gatherer)).toBe(false);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(wanted(sim, gatherer)).toBe(true);
    // A brewery no step raises drops out too; one the order may still raise holds.
    expect(wanted(sim, waitsOn('work_brewery'))).toBe(true);
    expect(wanted(sim, waitsOn('work_brewery'), true)).toBe(false);
  });
});
