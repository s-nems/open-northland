import { describe, expect, it } from 'vitest';
import { buildSandboxBuildings } from '../src/game/sandbox/building-set.js';
import { sandboxContent } from '../src/game/sandbox/content/index.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_JOINERY_01,
  BUILDING_POTTERY_01,
  GOOD_CROCKERY,
  GOOD_FURNITURE,
  GOOD_HOLY_OIL,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_WOOD,
} from '../src/game/sandbox/ids/index.js';

describe('household-goods fallback content', () => {
  it('carries generic household-use metadata for crockery, furniture and holy oil', () => {
    const byId = new Map(sandboxContent().goods.map((good) => [good.id, good]));

    expect(byId.get('crockery')?.homeQuality).toEqual({
      effect: 'cooking',
      deliveryValue: 100,
      capacity: 500,
      useCost: 5,
      fetchBelow: 100,
      minimumHomeLevel: 0,
    });
    expect(byId.get('furniture')?.homeQuality).toEqual({
      effect: 'rest',
      deliveryValue: 100,
      capacity: 500,
      useCost: 5,
      fetchBelow: 100,
      minimumHomeLevel: 0,
    });
    expect(byId.get('holy_oil')?.homeQuality).toEqual({
      effect: 'piety',
      deliveryValue: 1000,
      capacity: 5000,
      useCost: 3,
      fetchBelow: 3000,
      minimumHomeLevel: 2,
    });
  });

  it('wires each source recipe and output slot into the fallback workshops', () => {
    const buildings = buildSandboxBuildings({});

    expect(buildings.get(BUILDING_POTTERY_01)?.recipes).toContainEqual({
      inputs: [
        { goodType: GOOD_MUD, amount: 1 },
        { goodType: GOOD_WOOD, amount: 2 },
      ],
      outputs: [{ goodType: GOOD_CROCKERY, amount: 1 }],
      ticks: 180,
    });
    expect(buildings.get(BUILDING_JOINERY_01)?.recipes).toContainEqual({
      inputs: [{ goodType: GOOD_WOOD, amount: 2 }],
      outputs: [{ goodType: GOOD_FURNITURE, amount: 1 }],
      ticks: 180,
    });
    expect(buildings.get(BUILDING_DRUID_HUT)?.recipes).toContainEqual({
      inputs: [{ goodType: GOOD_MUSHROOM, amount: 1 }],
      outputs: [{ goodType: GOOD_HOLY_OIL, amount: 1 }],
      ticks: 180,
    });
  });
});
