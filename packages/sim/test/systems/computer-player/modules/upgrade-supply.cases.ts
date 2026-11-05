import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Stockpile } from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { Simulation } from '../../../../src/index.js';
import { goodsMadeBy } from '../../../../src/systems/computer-player/build-order/supply/bill-sources.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  entryStatuses,
  WELL_REACH_NODES,
} from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  aiSim,
  BREWERY_TYPE,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  MILL_TYPE,
  oneLine,
  placeHq,
  SEAT,
  VIKING,
  WELL_TYPE,
} from '../support.js';

/** The build order's material gates: an upgrade that would idle the only maker of its own bill goods or
 *  of its output, and the brewery's second well. */

const BRICK = 50;
const PILLAR = 51;
const POTTERY = 50;
const POTTERY_UPGRADED = 51;
const MASON_HUT = 52;
const MASON_HUT_UPGRADED = 53;
const POTTERY_TOP = 54;
/** The upgraded tiers' bills, shaped like the real ones: each needs the other's good as well as its own. */
const POTTERY_BILL = { bricks: 2, pillars: 2 };
const MASON_BILL = { bricks: 2, pillars: 1 };
const POTTERY_TOP_BRICKS = 3;

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
 *  billing both; the pottery has a third tier billing bricks alone. */
function materialsContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: BRICK, id: 'brick' }, { typeId: PILLAR, id: 'pillar' }],
    buildings: [
      ...base.buildings,
      workshop(POTTERY, 'work_pottery_00', BRICK, POTTERY_UPGRADED),
      {
        ...workshop(POTTERY_UPGRADED, 'work_pottery_01', BRICK, POTTERY_TOP),
        construction: [
          { goodType: BRICK, amount: POTTERY_BILL.bricks },
          { goodType: PILLAR, amount: POTTERY_BILL.pillars },
        ],
      },
      {
        ...workshop(POTTERY_TOP, 'work_pottery_03', BRICK),
        construction: [{ goodType: BRICK, amount: POTTERY_TOP_BRICKS }],
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

const UPGRADES = buildOrderModule(
  oneLine([
    { kind: 'upgrade', building: 'work_pottery_01', count: 1 },
    { kind: 'upgrade', building: 'work_mason_hut_01', count: 1 },
  ]),
);

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
    expect(next()).toEqual({
      kind: 'upgradeBuilding',
      building: entityOfBuilding(sim, POTTERY),
      target: POTTERY_UPGRADED,
    });
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
    expect(next()).toEqual({
      kind: 'upgradeBuilding',
      building: entityOfBuilding(sim, MASON_HUT),
      target: MASON_HUT_UPGRADED,
    });
  });

  it('counts the bricks a site already holds as spoken for, not as stock the pottery can spend', () => {
    const { sim, next } = workshopsSeat();
    const hut = entityOfBuilding(sim, MASON_HUT);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: hut });
    sim.step();
    // The hut's site already holds its bricks and still waits on a pillar the stock covers.
    sim.world.mut(hut, Stockpile).amounts.set(BRICK, MASON_BILL.bricks);
    store(sim, PILLAR, MASON_BILL.pillars + POTTERY_BILL.pillars);
    // Seat stock reads the site's two bricks as well, yet only these are free for the pottery's bill.
    store(sim, BRICK, POTTERY_BILL.bricks - 1);
    expect(next()).toBeUndefined();
    store(sim, BRICK, 1);
    expect(next()).toEqual({
      kind: 'upgradeBuilding',
      building: entityOfBuilding(sim, POTTERY),
      target: POTTERY_UPGRADED,
    });
  });

  it("keeps the pottery's own pile beyond its bill aside, as the upgrade stashes it", () => {
    const { sim, next } = workshopsSeat();
    const hut = entityOfBuilding(sim, MASON_HUT);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: hut });
    sim.step();
    // The hut's site holds its pillar and lacks only its bricks; the pottery's pillars come from store.
    sim.world.mut(hut, Stockpile).amounts.set(PILLAR, MASON_BILL.pillars);
    store(sim, PILLAR, POTTERY_BILL.pillars);
    // The pottery's own pile covers its bill and the hut's lack in sum, yet the part past its bill would
    // sit in the stash until the upgrade finishes, out of the hut's reach.
    const pile = POTTERY_BILL.bricks + MASON_BILL.bricks;
    sim.world.mut(entityOfBuilding(sim, POTTERY), Stockpile).amounts.set(BRICK, pile);
    expect(next()).toBeUndefined();
    store(sim, BRICK, MASON_BILL.bricks);
    expect(next()).toMatchObject({ kind: 'upgradeBuilding', target: POTTERY_UPGRADED });
  });

  describe('an upgrade starved of its own product', () => {
    /** The pottery upgrading with its pillars in hand, the bricks it went for gone from store. */
    function starvedPottery() {
      const seat = workshopsSeat();
      const { sim, next } = seat;
      store(sim, BRICK, POTTERY_BILL.bricks);
      const upgrade = next();
      if (upgrade === undefined) throw new Error('expected the pottery upgrade');
      sim.enqueueSetup(upgrade);
      sim.step();
      const pottery = entityOfBuilding(sim, POTTERY);
      sim.world.mut(pottery, Stockpile).amounts.set(PILLAR, POTTERY_BILL.pillars);
      // Another site took the stored bricks.
      sim.world.mut(entityOfBuilding(sim, HQ_TYPE), Stockpile).amounts.delete(BRICK);
      return { ...seat, pottery };
    }

    it('calls the upgrade off once the bricks it lacks are nowhere left', () => {
      const { sim, next, pottery } = starvedPottery();
      expect(next()).toEqual({ kind: 'cancelUpgrade', building: pottery });
      store(sim, BRICK, POTTERY_BILL.bricks);
      expect(next()?.kind).not.toBe('cancelUpgrade');
    });

    it('lets the upgrade wait while another pottery still makes bricks', () => {
      const { sim, next } = starvedPottery();
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: POTTERY,
        x: 30,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
      sim.step();
      expect(next()?.kind).not.toBe('cancelUpgrade');
    });

    it('counts the pottery as a source of bricks only once its own bill has them', () => {
      const { sim, content, pottery } = starvedPottery();
      const made = () => goodsMadeBy(sim.world, { ...ctxOf(sim), content }, [pottery]);
      expect(made().has(BRICK)).toBe(false);
      sim.world.mut(pottery, Stockpile).amounts.set(BRICK, POTTERY_BILL.bricks);
      expect(made().has(BRICK)).toBe(true);
    });
  });

  it('jumps the pottery past a tier the next entry raises too, once the merged bill is in store', () => {
    const { sim, content } = workshopsSeat();
    const order: readonly BuildOrderEntry[] = [
      { kind: 'upgrade', building: 'work_pottery_01', count: 1 },
      { kind: 'upgrade', building: 'work_pottery_03', count: 1 },
    ];
    const toTop = buildOrderModule(oneLine(order));
    const next = () => [...toTop.run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
    // The jump bills both tiers' bricks summed; one short of that covers only the next tier, so the order
    // falls back to it.
    store(sim, BRICK, POTTERY_BILL.bricks + POTTERY_TOP_BRICKS - 1);
    expect(next()).toMatchObject({ kind: 'upgradeBuilding', target: POTTERY_UPGRADED });
    store(sim, BRICK, 1);
    const jump = next();
    expect(jump).toEqual({
      kind: 'upgradeBuilding',
      building: entityOfBuilding(sim, POTTERY),
      target: POTTERY_TOP,
    });
    if (jump === undefined) return;
    sim.enqueueSetup(jump);
    sim.step();
    // The one site meets both entries, so no second upgrade is ordered meanwhile.
    expect(entryStatuses(sim.world, { ...ctxOf(sim), content }, SEAT, order)).toEqual([
      'satisfied',
      'satisfied',
    ]);
    expect(next()).toBeUndefined();
  });

  it('keeps one maker of a good working while another upgrades', () => {
    const content = materialsContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    for (const x of [40, 50]) {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: POTTERY,
        x,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
    }
    sim.step();
    store(sim, BRICK, 2 * POTTERY_BILL.bricks);
    store(sim, PILLAR, 2 * POTTERY_BILL.pillars);
    const both = buildOrderModule(oneLine([{ kind: 'upgrade', building: 'work_pottery_01', count: 2 }]));
    const next = () => [...both.run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
    const first = next();
    if (first?.kind !== 'upgradeBuilding') throw new Error('expected the first pottery upgrade');
    sim.enqueueSetup(first);
    sim.step();
    expect(next()).toBeUndefined();
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
      return [...buildOrderModule(oneLine(order)).run(sim.world, ctxOf(sim), SEAT)][0];
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
