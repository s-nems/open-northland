import { describe, expect, it } from 'vitest';
import {
  Building,
  GroundDrop,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
  setStockAmount,
  UnderConstruction,
  Upgrading,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../../src/index.js';
import { positionOfNode } from '../../../../src/nav/halfcell.js';
import type { NodeId } from '../../../../src/nav/terrain/index.js';
import { buildingBlockedCells } from '../../../../src/systems/footprint/index.js';
import type { InteractionCellIndex } from '../../../../src/systems/settlers/targets/cell-index.js';
import {
  collectTargets,
  interactionCell,
  nearestStoreHolding,
  QUALIFIES,
  storeYieldsGood,
} from '../../../../src/systems/settlers/targets/index.js';
import { collectSupplyTally } from '../../../../src/systems/stores/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassCellMap as grassMap } from '../../../fixtures/terrain.js';
import { constructionContent, HOUSE, STONE } from '../../economy/construction/system/support.js';

// The question-keyed band memo: one filtered index shared by every asker of the same question this
// tick, dropped whenever a tracked stock write or membership change could flip an answer.

const WOOD = 1;
const PLANK = 2;
const HEADQUARTERS = 1; // passive store: no recipe, so its wood is strippable
const SAWMILL = 2; // recipe wood -> plank: its wood is the reserve it runs on, its planks are output
const VIKING = 1;

function hqAt(sim: Simulation, x: number, y: number, wood: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, wood]]) });
  return e;
}

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const near = hqAt(sim, 2, 1, 5);
  const far = hqAt(sim, 13, 1, 5);
  const empty = hqAt(sim, 1, 2, 0);
  const targets = collectTargets(sim.world, ctxOf(sim), terrain);
  const supply = collectSupplyTally(sim.world);
  const here = terrain.nodeAtClamped(6, 2);
  return { sim, targets, supply, here, near, far, empty };
}

describe('TargetBands', () => {
  it('shares one filtered index per question and picks the unshared winner', () => {
    const { sim, targets, supply, here, near } = fixture();
    expect(targets.bands.holding(WOOD)).toBe(targets.bands.holding(WOOD));
    expect(nearestStoreHolding(targets.bands, sim.world, here, here, WOOD, undefined, supply)).toBe(near);
  });

  it('re-syncs the band on a tracked stock write instead of serving the stale winner', () => {
    const { sim, targets, supply, here, near, far } = fixture();
    expect(nearestStoreHolding(targets.bands, sim.world, here, here, WOOD, undefined, supply)).toBe(near);
    setStockAmount(sim.world, near, WOOD, 0);
    expect(nearestStoreHolding(targets.bands, sim.world, here, here, WOOD, undefined, supply)).toBe(far);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('re-syncs the band on a membership change that flips an answer', () => {
    const { sim, targets, supply, here, near, far } = fixture();
    expect(nearestStoreHolding(targets.bands, sim.world, here, here, WOOD, undefined, supply)).toBe(near);
    // A store that becomes a construction site mid-tick is a sink, never a source to strip.
    sim.world.add(near, UnderConstruction, { labor: fx.fromInt(0) });
    expect(nearestStoreHolding(targets.bands, sim.world, here, here, WOOD, undefined, supply)).toBe(far);
  });

  it('keeps the entity-id tie-break when a lower-id store comes to hold the good later', () => {
    const { sim, supply, empty } = fixture();
    const twin = hqAt(sim, 1, 2, 5); // shares `empty`'s door, one id higher
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const bandsNow = () => collectTargets(sim.world, ctxOf(sim), terrain).bands;
    const door = interactionCell(sim.world, ctxOf(sim), terrain, empty);
    expect(nearestStoreHolding(bandsNow(), sim.world, door, door, WOOD, undefined, supply)).toBe(twin);

    setStockAmount(sim.world, empty, WOOD, 5); // held now, but entered the holder ledger after `twin`
    expect(nearestStoreHolding(bandsNow(), sim.world, door, door, WOOD, undefined, supply)).toBe(empty);
  });
});

/** Whether `e` is in `band`, asked through the only query a band answers: a search accepting `e` alone. */
function bandHas(band: InteractionCellIndex, e: Entity, here: NodeId): boolean {
  return band.nearest(here, here, (c) => (c === e ? QUALIFIES : null)) !== null;
}

/** Assert the holding band of each good admits exactly the `stores` {@link storeYieldsGood} accepts,
 *  and return the members of `goods[0]`'s band. */
function holdingMatchesYield(sim: Simulation, stores: readonly Entity[], goods: readonly number[]): Entity[] {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const ctx = ctxOf(sim);
  const bands = collectTargets(sim.world, ctx, terrain).bands;
  const here = terrain.nodeAtClamped(0, 0);
  const walls = buildingBlockedCells(sim.world, ctx, terrain);
  for (const good of goods) {
    for (const store of stores) {
      expect(bandHas(bands.holding(good), store, here), `store ${store} good ${good}`).toBe(
        storeYieldsGood(sim.world, ctx, terrain, walls, store, good),
      );
    }
  }
  return stores.filter((e) => bandHas(bands.holding(goods[0] ?? WOOD), e, here));
}

describe('TargetBands.holding - the band a producer fetches a missing input from', () => {
  it('admits what storeYieldsGood strips: no site, an upgrade kept inventory, no workshop reserve', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const plain = hqAt(sim, 2, 1, 5);
    const site = hqAt(sim, 5, 1, 5);
    sim.world.mut(site, Building).built = fx.fromInt(0);
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    const upgrade = hqAt(sim, 8, 1, 0); // its build hold is empty, its kept inventory holds the wood
    sim.world.add(upgrade, Upgrading, {
      target: sim.world.get(upgrade, Building).buildingType,
      savedStock: new Map([[WOOD, 4]]),
      seeded: new Map(),
    });
    const sawmill = hqAt(sim, 11, 1, 5);
    sim.world.mut(sawmill, Building).buildingType = SAWMILL;
    setStockAmount(sim.world, sawmill, PLANK, 3);

    const stores = [plain, site, upgrade, sawmill];
    expect(holdingMatchesYield(sim, stores, [WOOD, PLANK])).toEqual([plain, upgrade]);
    expect(holdingMatchesYield(sim, stores, [PLANK])).toEqual([sawmill]);
  });

  it("leaves out a pile buried under a standing building's walls", () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(16, 4) });
    const house = sim.world.create(); // a built HOUSE: walls on nodes (10,4) and (12,4)
    sim.world.add(house, Position, positionOfNode(10, 4));
    sim.world.add(house, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    const buried = pileOnNode(sim, 10, 4);
    const free = pileOnNode(sim, 20, 4);

    expect(holdingMatchesYield(sim, [buried, free], [STONE])).toEqual([free]);
  });
});

describe('TargetBands kept across passes', () => {
  it('re-files a member that moved, lost its stock or its building since the last pass', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const [moved, drained, unbuilt] = [hqAt(sim, 2, 1, 5), hqAt(sim, 7, 1, 5), hqAt(sim, 13, 1, 5)];
    const stores = [moved, drained, unbuilt];
    const nearestFrom = (x: number, y: number): Entity | null =>
      nearestStoreHolding(
        collectTargets(sim.world, ctxOf(sim), terrain).bands,
        sim.world,
        terrain.nodeAtClamped(x, y),
        terrain.nodeAtClamped(x, y),
        WOOD,
        undefined,
        collectSupplyTally(sim.world),
      );
    expect(holdingMatchesYield(sim, stores, [WOOD])).toEqual(stores);

    sim.world.add(moved, Position, { x: fx.fromInt(10), y: fx.fromInt(2) });
    expect(nearestFrom(20, 4)).toBe(moved);
    setStockAmount(sim.world, drained, WOOD, 0);
    expect(holdingMatchesYield(sim, stores, [WOOD])).toEqual([moved, unbuilt]);
    setStockAmount(sim.world, drained, WOOD, 5);
    sim.world.remove(unbuilt, Building); // filed by its door before, by its own node now
    expect(holdingMatchesYield(sim, stores, [WOOD])).toEqual(stores);
    expect(nearestFrom(26, 2)).toBe(unbuilt);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

describe('TargetBands.holding kept off the holder ledger', () => {
  function houseOn(sim: Simulation, hx: number, hy: number): Entity {
    const house = sim.world.create(); // a built HOUSE: walls on its own node and two half-cells east
    sim.world.add(house, Position, positionOfNode(hx, hy));
    sim.world.add(house, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    return house;
  }

  it('matches a cold judgement after stock, pile and wall changes between passes', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(16, 4) });
    const [west, middle, east] = [pileOnNode(sim, 4, 4), pileOnNode(sim, 10, 4), pileOnNode(sim, 20, 4)];
    expect(holdingMatchesYield(sim, [west, middle, east], [STONE])).toEqual([west, middle, east]);

    const house = houseOn(sim, 10, 4);
    expect(holdingMatchesYield(sim, [west, middle, east], [STONE])).toEqual([west, east]);
    const buried = pileOnNode(sim, 12, 4); // laid under standing walls, judged as a changed holder
    setStockAmount(sim.world, west, STONE, 0);
    sim.world.destroy(east);
    expect(holdingMatchesYield(sim, [west, middle, buried], [STONE])).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);

    sim.world.destroy(house);
    setStockAmount(sim.world, west, STONE, 1);
    expect(holdingMatchesYield(sim, [west, middle, buried], [STONE])).toEqual([west, middle, buried]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('re-judges only the ground drops when a resource comes to stand under them', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(16, 4) });
    houseOn(sim, 10, 4);
    const pile = pileOnNode(sim, 6, 4);
    const drop = pileOnNode(sim, 14, 4);
    sim.world.add(drop, GroundDrop, { goodType: STONE });
    // A deposit footprint on each pile's node whose one work cell lies under the house walls: the
    // structure overlay moves here, before any resource stands.
    const deposits = [
      depositFootprint(sim, 6, 4, WEST_WALL_FROM_PILE),
      depositFootprint(sim, 14, 4, EAST_WALL_FROM_DROP),
    ];
    expect(holdingMatchesYield(sim, [pile, drop], [STONE])).toEqual([pile, drop]);

    // Only the Resource store moves: the drop is now worked from the deposit's walled-in stance, and the
    // plain pile, whose anchor no resource reads, stays.
    for (const deposit of deposits) {
      sim.world.add(deposit, Resource, { goodType: STONE, remaining: 1, harvestAtomic: ANY_HARVEST_ATOMIC });
    }
    expect(holdingMatchesYield(sim, [pile, drop], [STONE])).toEqual([pile]);
    expect(sim.world.verifyCaches()).toEqual([]);

    const [, underDrop] = deposits;
    if (underDrop === undefined) throw new Error('setup: the deposit under the drop');
    sim.world.remove(underDrop, Resource);
    expect(holdingMatchesYield(sim, [pile, drop], [STONE])).toEqual([pile, drop]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it.each([1])(
    'matches a cold judgement as walls and blocking deposits come and go around the piles (seed %i)',
    (seed) => {
      const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(24, 8) });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('fixture map missing');
      const roll = lcg(seed);
      const node = () => [roll(terrain.width), roll(terrain.height)] as const;
      const piles = Array.from({ length: RANDOM_PILES }, () => pileOnNode(sim, ...node()));
      const houses: Entity[] = [];
      const deposits: Entity[] = [];
      for (let round = 0; round < RANDOM_ROUNDS; round++) {
        const action = roll(5);
        if (action === 0) houses.push(houseOn(sim, ...node()));
        else if (action === 1 && houses.length > 0)
          sim.world.destroy(houses.splice(roll(houses.length), 1)[0] as Entity);
        else if (action === 2) deposits.push(blockingDeposit(sim, ...node()));
        else if (action === 3 && deposits.length > 0)
          sim.world.destroy(deposits.splice(roll(deposits.length), 1)[0] as Entity);
        else setStockAmount(sim.world, piles[roll(piles.length)] as Entity, STONE, roll(2));
        const bands = collectTargets(sim.world, ctxOf(sim), terrain).bands;
        bands.supplying(STONE);
        holdingMatchesYield(sim, piles, [STONE]);
        expect(sim.world.verifyCaches(), `round ${round}`).toEqual([]);
      }
    },
  );

  it('reports a pile that moved without the ledger seeing it', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(16, 4) });
    houseOn(sim, 10, 4);
    const pile = pileOnNode(sim, 20, 4);
    expect(holdingMatchesYield(sim, [pile], [STONE])).toEqual([pile]);

    // A positioned stockpile never moves: an in-place write onto the walls breaks that invariant.
    const onWall = positionOfNode(10, 4);
    const position = sim.world.mut(pile, Position);
    position.x = onWall.x;
    position.y = onWall.y;
    expect(sim.world.verifyCaches()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^targetBands holding \d+: members \[\d+\] differ/)]),
    );
  });
});

function pileOnNode(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Stockpile, { amounts: new Map([[STONE, 1]]) });
  return e;
}

const RANDOM_PILES = 60;
const RANDOM_ROUNDS = 120;

/** A deterministic LCG, so a failure replays. */
function lcg(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

/** A deposit footprint that walls in its own node. */
function blockingDeposit(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
  return e;
}

/** No band reads how a deposit is harvested. */
const ANY_HARVEST_ATOMIC = 0;
/** Work cells, in half-cells along the row, from the piles on (6,4) and (14,4) onto the house walls. */
const WEST_WALL_FROM_PILE = { dx: 4, dy: 0 };
const EAST_WALL_FROM_DROP = { dx: -2, dy: 0 };

/** A deposit footprint on a node that blocks nothing and is worked from `work` alone. */
function depositFootprint(sim: Simulation, hx: number, hy: number, work: { dx: number; dy: number }): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, ResourceFootprint, { walk: [], build: [], work: [work] });
  return e;
}
