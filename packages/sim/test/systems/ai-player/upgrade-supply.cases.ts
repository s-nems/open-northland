import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Stockpile } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Simulation } from '../../../src/index.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  WELL_REACH_NODES,
} from '../../../src/systems/ai-player/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  aiSim,
  BREWERY_TYPE,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  MILL_TYPE,
  placeHq,
  SEAT,
  VIKING,
  WELL_TYPE,
} from './support.js';

/** The build order's material gates: an upgrade that would idle the only maker of its own bill goods, and
 *  the brewery's second well. */

const BRICK = 50;
const PILLAR = 51;
const POTTERY = 50;
const POTTERY_UPGRADED = 51;
const MASON_HUT = 52;
const MASON_HUT_UPGRADED = 53;
/** The upgraded tiers' bills, shaped like the real ones: each needs the other's good as well as its own. */
const POTTERY_BILL = { bricks: 2, pillars: 2 };
const MASON_BILL = { bricks: 2, pillars: 1 };

function workshop(typeId: number, id: string, output: number, upgradeTarget?: number) {
  return {
    typeId,
    id,
    kind: 'workplace' as const,
    recipes: [{ inputs: [], outputs: [{ goodType: output, amount: 1 }] }],
    stock: [{ goodType: output, capacity: 10 }],
    construction: [{ goodType: 1, amount: 1 }],
    ...(upgradeTarget === undefined ? {} : { upgradeTarget }),
  };
}

/** The AI content with a pottery and a mason hut that each make one good and upgrade into a tier
 *  billing both. */
function materialsContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: BRICK, id: 'brick' }, { typeId: PILLAR, id: 'pillar' }],
    buildings: [
      ...base.buildings,
      workshop(POTTERY, 'work_pottery_00', BRICK, POTTERY_UPGRADED),
      {
        ...workshop(POTTERY_UPGRADED, 'work_pottery_01', BRICK),
        construction: [
          { goodType: BRICK, amount: POTTERY_BILL.bricks },
          { goodType: PILLAR, amount: POTTERY_BILL.pillars },
        ],
      },
      workshop(MASON_HUT, 'work_mason_hut_00', PILLAR, MASON_HUT_UPGRADED),
      {
        ...workshop(MASON_HUT_UPGRADED, 'work_mason_hut_01', PILLAR),
        construction: [
          { goodType: BRICK, amount: MASON_BILL.bricks },
          { goodType: PILLAR, amount: MASON_BILL.pillars },
        ],
      },
    ],
  });
}

const UPGRADES = buildOrderModule([
  { kind: 'upgrade', building: 'work_pottery_01', count: 1 },
  { kind: 'upgrade', building: 'work_mason_hut_01', count: 1 },
]);

function workshopsSeat(): { sim: Simulation; content: ContentSet; next: () => Command | undefined } {
  const content = materialsContent();
  const sim = aiSim(1, content);
  placeHq(sim);
  for (const [buildingType, x] of [
    [POTTERY, 40],
    [MASON_HUT, 50],
  ] as const) {
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y: 16, tribe: VIKING, owner: SEAT });
  }
  sim.step();
  return { sim, content, next: () => [...UPGRADES.run(sim.world, { ...ctxOf(sim), content }, SEAT)][0] };
}

function store(sim: Simulation, goodType: number, amount: number): void {
  const hq = sim.world.mut(entityOfBuilding(sim, HQ_TYPE), Stockpile);
  hq.amounts.set(goodType, (hq.amounts.get(goodType) ?? 0) + amount);
}

describe('build order - material gates', () => {
  it('holds a pottery upgrade until the bricks it can no longer make are in store', () => {
    const { sim, next } = workshopsSeat();
    // The stone blocks come from the working mason hut, so only the bricks are waited for.
    expect(next()).toBeUndefined();
    store(sim, BRICK, POTTERY_BILL.bricks);
    expect(next()).toEqual({ kind: 'upgradeBuilding', building: entityOfBuilding(sim, POTTERY) });
  });

  it('holds the mason upgrade while the upgrading pottery still lacks the bricks in store', () => {
    const { sim, next } = workshopsSeat();
    store(sim, BRICK, POTTERY_BILL.bricks);
    const pottery = next();
    if (pottery === undefined) throw new Error('expected the pottery upgrade');
    sim.enqueueSetup(pottery);
    sim.step();

    // The pottery's site still lacks every good, so the stored bricks are spoken for, and the stone
    // blocks the hut would stop making must cover both bills.
    store(sim, BRICK, MASON_BILL.bricks);
    store(sim, PILLAR, POTTERY_BILL.pillars);
    expect(next()).toBeUndefined();
    store(sim, PILLAR, MASON_BILL.pillars);
    expect(next()).toEqual({ kind: 'upgradeBuilding', building: entityOfBuilding(sim, MASON_HUT) });
  });

  describe('the brewery well', () => {
    const BREWERY = { x: 44, y: 16 };
    const order: readonly BuildOrderEntry[] = [
      {
        kind: 'place',
        building: 'work_well_00',
        count: 2,
        near: [{ kind: 'building', id: 'work_brewery' }],
        unlessWithin: { building: 'work_brewery', radius: WELL_REACH_NODES },
      },
      // Acts only once the well entry counts as done, so a skip is told apart from a stall.
      { kind: 'place', building: 'work_mill_00', count: 1 },
    ];

    function brewerySeat(wellX: number, brewery = true): Command | undefined {
      const sim = aiSim();
      placeHq(sim);
      const placed: (readonly [number, number])[] = [[WELL_TYPE, wellX]];
      if (brewery) placed.push([BREWERY_TYPE, BREWERY.x]);
      for (const [buildingType, x] of placed) {
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType,
          x,
          y: BREWERY.y,
          tribe: VIKING,
          owner: SEAT,
        });
      }
      sim.step();
      return [...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0];
    }

    it('skips the second well while the first stands beside the brewery, or no brewery stands', () => {
      expect(brewerySeat(BREWERY.x + 4)).toMatchObject({ kind: 'placeBuilding', buildingType: MILL_TYPE });
      expect(brewerySeat(BREWERY.x + 4, false)).toMatchObject({
        kind: 'placeBuilding',
        buildingType: MILL_TYPE,
      });
    });

    it('raises a second well beside the brewery when the first stands farther off', () => {
      const well = brewerySeat(BREWERY.x - 3 * WELL_REACH_NODES);
      if (well?.kind !== 'placeBuilding') throw new Error('expected a well placement');
      expect(well.buildingType).toBe(WELL_TYPE);
      expect(Math.abs(well.x - BREWERY.x) + Math.abs(well.y - BREWERY.y)).toBeLessThan(WELL_REACH_NODES);
    });
  });
});
