import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { setStockAmount } from '../../../../src/components/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { suppliedUpgrade } from '../../../../src/systems/computer-player/build-order/upgrade-supply.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  placeHq,
  SEAT,
  VIKING,
} from '../support.js';

/** The fixture bakery's own good, the only maker of which is the candidate. */
const BREAD = 3;
const BILL_UNITS = 2;
const RECIPE_TICKS = 180;

describe('suppliedUpgrade', () => {
  it('lets a step ahead of the sites start on a bill the stock holds, whatever the sites still lack', () => {
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) => {
        if (b.typeId === BAKERY_TYPE)
          return {
            ...b,
            recipes: [{ inputs: [], outputs: [{ goodType: BREAD, amount: 1 }], ticks: RECIPE_TICKS }],
          };
        if (b.typeId === BAKERY_TOP_TYPE)
          return { ...b, construction: [{ goodType: BREAD, amount: BILL_UNITS }] };
        if (b.typeId === HOME_TYPE) return { ...b, construction: [{ goodType: BREAD, amount: BILL_UNITS }] };
        return b;
      }),
    });
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 10,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    completeSites(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X - 10,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), BREAD, BILL_UNITS);
    const ctx = { ...ctxOf(sim), content };
    const owned = ownedBuildings(sim.world, SEAT);
    const bakery = entityOfBuilding(sim, BAKERY_TYPE);
    const supplied = (ahead: boolean) =>
      suppliedUpgrade(sim.world, ctx, SEAT, owned, bakery, [BAKERY_TOP_TYPE], ahead);
    expect(supplied(false)).toBeUndefined();
    expect(supplied(true)).toBe(BAKERY_TOP_TYPE);
  });
});
