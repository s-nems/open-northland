import { describe, expect, it } from 'vitest';
import { Carrying, LostWay, Owner, Position, Stockpile, SupplyRun } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { CUT_OFF_CHECK_TICKS } from '../../src/systems/settlers/drives/cut-off.js';
import {
  builderAt,
  builtBuildingAt,
  constructionContent,
  HEADQUARTERS,
  HOUSE,
  STONE,
  siteAt,
  WOOD,
} from '../economy/construction-system/support.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { stampPost } from './support.js';

/**
 * A builder and the signpost network between its site and the material for it. The walk range is 25 tiles
 * E/W and posts link under 20, so a post 18 tiles from the next joins its group and one 36 tiles away does
 * not. Tile coords, all on one row.
 */

const P0 = 0;
const ROW = 2;
const STORE_X = 2;
const BUILDER_X = 24;
/** A post the builder catches whose range covers the island site, out of the store's reach. */
const ISLAND_POST_X = 46;
const ISLAND_SITE_X = 50;
/** A store inside the island post's range, farther from the builder than the first store. */
const ISLAND_STORE_X = 54;
/** Past the walk range of the store and of every post. */
const FAR_SITE_X = 60;
/** Ample for the builder's walk to the island site at a builder's pace, about 16 ticks a tile. */
const WALK_THERE_TICKS = 600;
/** Posts under the link range from the store to the island post. */
const CHAIN = [10, 28, ISLAND_POST_X];

function world(siteX: number): { sim: Simulation; builder: Entity; site: Entity } {
  const sim = new Simulation({ seed: 3, content: constructionContent(), map: grassCellMap(128, 8) });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.step();
  const store = builtBuildingAt(sim, HEADQUARTERS, STORE_X, ROW, [
    [STONE, 10],
    [WOOD, 10],
  ]);
  sim.world.add(store, Owner, { player: P0 });
  const site = siteAt(sim, HOUSE, siteX, ROW);
  sim.world.add(site, Owner, { player: P0 });
  const builder = builderAt(sim, siteX === FAR_SITE_X ? STORE_X + 2 : BUILDER_X, ROW);
  sim.world.add(builder, Owner, { player: P0 });
  return { sim, builder, site };
}

function fetching(sim: Simulation, builder: Entity): boolean {
  return sim.world.has(builder, SupplyRun) || sim.world.has(builder, Carrying);
}

function cutOff(sim: Simulation, builder: Entity): boolean {
  return sim.world.tryGet(builder, LostWay)?.cutOff === true;
}

describe('a builder whose site the signpost network keeps from its material', () => {
  it('fetches nothing it could not carry to the site and stands lost, told once', () => {
    const { sim, builder } = world(ISLAND_SITE_X);
    stampPost(sim, ISLAND_POST_X, ROW);
    let lostNotes = 0;
    let fetched = false;
    // It may first walk to wait at the site, as for any site short of material; the next check tells.
    for (let t = 0; t < WALK_THERE_TICKS + 2 * CUT_OFF_CHECK_TICKS; t++) {
      sim.step();
      fetched ||= fetching(sim, builder);
      for (const ev of sim.events.current())
        if (ev.kind === 'settlerLost' && ev.entity === builder) lostNotes++;
    }
    expect(fetched).toBe(false);
    expect(cutOff(sim, builder)).toBe(true);
    expect(lostNotes).toBe(1);
    // It stands: no walk back towards the store and out again.
    const x = sim.world.get(builder, Position).x;
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS; t++) sim.step();
    expect(sim.world.get(builder, Position).x).toBe(x);
  });

  it('builds once a post chain links the store to the site, and the mark lifts', () => {
    const { sim, builder, site } = world(ISLAND_SITE_X);
    stampPost(sim, ISLAND_POST_X, ROW);
    for (let t = 0; t < WALK_THERE_TICKS + 2 * CUT_OFF_CHECK_TICKS; t++) sim.step();
    expect(cutOff(sim, builder)).toBe(true);

    for (const x of CHAIN.slice(0, -1)) stampPost(sim, x, ROW);
    const delivered = (): boolean => (sim.world.tryGet(site, Stockpile)?.amounts.size ?? 0) > 0;
    for (let t = 0; t < 40 * CUT_OFF_CHECK_TICKS && !delivered(); t++) sim.step();
    expect(delivered()).toBe(true);
    expect(sim.world.has(builder, LostWay)).toBe(false);
  });
});

describe('a builder whose nearest store cannot serve its site', () => {
  it("fetches from a farther store that can, inside the site's signpost group", () => {
    const { sim, builder, site } = world(ISLAND_SITE_X);
    stampPost(sim, ISLAND_POST_X, ROW);
    const island = builtBuildingAt(sim, HEADQUARTERS, ISLAND_STORE_X, ROW, [
      [STONE, 10],
      [WOOD, 10],
    ]);
    sim.world.add(island, Owner, { player: P0 });
    let source: Entity | undefined;
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS && source === undefined; t++) {
      sim.step();
      source = sim.world.tryGet(builder, SupplyRun)?.source;
    }
    expect(source).toBe(island);
    const delivered = (): boolean => (sim.world.tryGet(site, Stockpile)?.amounts.size ?? 0) > 0;
    for (let t = 0; t < WALK_THERE_TICKS * 2 && !delivered(); t++) sim.step();
    expect(delivered()).toBe(true);
    expect(sim.world.has(builder, LostWay)).toBe(false);
  });
});

describe('a builder whose only site lies beyond every signpost', () => {
  it('is marked lost at the cut-off check', () => {
    const { sim, builder } = world(FAR_SITE_X);
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS; t++) sim.step();
    expect(fetching(sim, builder)).toBe(false);
    expect(cutOff(sim, builder)).toBe(true);
  });

  it('is not marked, and fetches, once a post chain reaches the site', () => {
    const { sim, builder } = world(FAR_SITE_X);
    for (const x of [...CHAIN, FAR_SITE_X - 4]) stampPost(sim, x, ROW);
    let fetched = false;
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS; t++) {
      sim.step();
      fetched ||= fetching(sim, builder);
    }
    expect(fetched).toBe(true);
    expect(sim.world.has(builder, LostWay)).toBe(false);
  });
});
