import { describe, expect, it } from 'vitest';
import {
  Carrying,
  LostWay,
  Owner,
  PickupClaim,
  Position,
  Stockpile,
  SupplyRun,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { dropGroundPile } from '../../src/systems/settlers/atomics/effects/goods/piles.js';
import { CUT_OFF_CHECK_TICKS } from '../../src/systems/settlers/drives/cut-off.js';
import { idleReplanDue } from '../../src/systems/settlers/planner/idle-replan.js';
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
 * A builder, the stores of its material and the signpost network between them and its site. Goods are
 * found by a terrain search of 20 tiles from where the builder stands, or under the posts of a group that
 * search catches; its walks reach 25 tiles, or a caught group's cover; posts link under 20 tiles, so a post
 * 18 tiles from the next joins its group and one 36 tiles away does not. Tile coords, all on one row.
 */

const P0 = 0;
const ROW = 2;
const STORE_X = 12;
/** Sees the store, and catches the island post with its walks but not with its goods search. */
const BUILDER_X = 26;
/** Sees the store and the island post both, so the island store is found through the post. */
const BETWEEN_X = 30;
/** A post the builder catches whose cover holds the island site, out of the store's reach. */
const ISLAND_POST_X = 46;
const ISLAND_SITE_X = 50;
/** A store under the island post, farther from the builder than the first store. */
const ISLAND_STORE_X = 54;
/** Past the walk range of the store and of every post. */
const FAR_SITE_X = 60;
/** Ample for the builder's walk to the island site at a builder's pace, about 16 ticks a tile. */
const WALK_THERE_TICKS = 600;
/** Posts under the link range from the store to the island post. */
const CHAIN = [10, 28, ISLAND_POST_X];

function world(siteX: number): { sim: Simulation; builder: Entity; site: Entity } {
  const { sim, builder } = scene(siteX === FAR_SITE_X ? STORE_X + 2 : BUILDER_X);
  return { sim, builder, site: placeSite(sim, siteX) };
}

function scene(builderX: number): { sim: Simulation; builder: Entity } {
  const sim = new Simulation({ seed: 3, content: constructionContent(), map: grassCellMap(128, 8) });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.step();
  const store = builtBuildingAt(sim, HEADQUARTERS, STORE_X, ROW, [
    [STONE, 10],
    [WOOD, 10],
  ]);
  sim.world.add(store, Owner, { player: P0 });
  const builder = builderAt(sim, builderX, ROW);
  sim.world.add(builder, Owner, { player: P0 });
  return { sim, builder };
}

function placeSite(sim: Simulation, x: number): Entity {
  const site = siteAt(sim, HOUSE, x, ROW);
  sim.world.add(site, Owner, { player: P0 });
  return site;
}

function lostNotesOver(sim: Simulation, builder: Entity, ticks: number): number {
  let notes = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'settlerLost' && ev.entity === builder) notes++;
  }
  return notes;
}

function fetching(sim: Simulation, builder: Entity): boolean {
  return sim.world.has(builder, SupplyRun) || sim.world.has(builder, Carrying);
}

function cutOff(sim: Simulation, builder: Entity): boolean {
  return sim.world.tryGet(builder, LostWay)?.cutOff === true;
}

/** Whether the builder's lost mark stands nearer the first store than the island site, in tiles. */
function nearerToStore(sim: Simulation, builder: Entity): boolean {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('expected a mapped sim');
  const x = terrain.xOf(sim.world.get(builder, LostWay).goal) / 2;
  return Math.abs(x - STORE_X) < Math.abs(x - ISLAND_SITE_X);
}

describe('a builder whose site the signpost network keeps from its material', () => {
  it('fetches nothing it could not carry to the site and is never told it is lost', () => {
    const { sim, builder, site } = world(ISLAND_SITE_X);
    stampPost(sim, ISLAND_POST_X, ROW);
    let fetched = false;
    for (let t = 0; t < WALK_THERE_TICKS + 2 * CUT_OFF_CHECK_TICKS; t++) {
      sim.step();
      fetched ||= fetching(sim, builder);
    }
    expect(fetched).toBe(false);
    // Material beyond the posts is the site's shortage, not a lost builder: the store is out of reach.
    expect(sim.world.has(builder, LostWay)).toBe(false);
    expect(sim.constructionSupply(site)).toMatchObject({
      kind: 'short',
      shortfalls: [
        { goodType: STONE, held: false },
        { goodType: WOOD, held: false },
      ],
    });
  });

  it('builds once a post chain links the store to the site', () => {
    const { sim, builder, site } = world(ISLAND_SITE_X);
    stampPost(sim, ISLAND_POST_X, ROW);
    for (let t = 0; t < WALK_THERE_TICKS + 2 * CUT_OFF_CHECK_TICKS; t++) sim.step();
    expect(fetching(sim, builder)).toBe(false);

    for (const x of CHAIN.slice(0, -1)) stampPost(sim, x, ROW);
    expect(sim.constructionSupply(site)).toMatchObject({
      kind: 'short',
      shortfalls: [{ held: true }, { held: true }],
    });
    const delivered = (): boolean => (sim.world.tryGet(site, Stockpile)?.amounts.size ?? 0) > 0;
    for (let t = 0; t < 40 * CUT_OFF_CHECK_TICKS && !delivered(); t++) sim.step();
    expect(delivered()).toBe(true);
    expect(sim.world.has(builder, LostWay)).toBe(false);
  });
});

describe('a builder whose nearest store cannot serve its site', () => {
  it("fetches from a farther store that can, inside the site's signpost group", () => {
    const { sim, builder } = scene(BETWEEN_X);
    const site = placeSite(sim, ISLAND_SITE_X);
    stampPost(sim, ISLAND_POST_X, ROW);
    const island = builtBuildingAt(sim, HEADQUARTERS, ISLAND_STORE_X, ROW, [
      [STONE, 10],
      [WOOD, 10],
    ]);
    sim.world.add(island, Owner, { player: P0 });
    let source: Entity | null | undefined;
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS && source === undefined; t++) {
      sim.step();
      source = sim.world.tryGet(builder, PickupClaim)?.source;
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
    // The store is in reach and the site is not: the mark points at the site.
    expect(nearerToStore(sim, builder)).toBe(false);
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

describe('a builder whose only material lies on a neutral pile beyond every signpost', () => {
  it('is never marked lost over it: a pile nobody owns is no store to link', () => {
    const sim = new Simulation({ seed: 3, content: constructionContent(), map: grassCellMap(128, 8) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();
    const builder = builderAt(sim, BUILDER_X, ROW);
    sim.world.add(builder, Owner, { player: P0 });
    placeSite(sim, BUILDER_X + 2);
    dropGroundPile(sim.world, fx.fromInt(FAR_SITE_X + 40), fx.fromInt(ROW), STONE, 5);

    expect(lostNotesOver(sim, builder, WALK_THERE_TICKS + 2 * CUT_OFF_CHECK_TICKS)).toBe(0);
    expect(sim.world.has(builder, LostWay)).toBe(false);
  });
});

describe('a builder whose signposts reach its work', () => {
  it('is never told it is lost over a site placed while it idles, whichever tick checks it', () => {
    const { sim, builder } = scene(BUILDER_X);
    for (const x of CHAIN) stampPost(sim, x, ROW);
    // Nothing to build: it idles on its tail through two checks.
    expect(lostNotesOver(sim, builder, 2 * CUT_OFF_CHECK_TICKS)).toBe(0);
    // A site placed just before a check that falls between its idle beats is in reach, so that check,
    // which runs with no site pick of its own, must not read it as beyond.
    const checkOffBeat = (tick: number): boolean =>
      tick % CUT_OFF_CHECK_TICKS === 0 && !idleReplanDue(tick, builder);
    for (let t = 0; t < 2 * CUT_OFF_CHECK_TICKS && !checkOffBeat(sim.tick + 1); t++) sim.step();
    expect(checkOffBeat(sim.tick + 1)).toBe(true);
    placeSite(sim, ISLAND_SITE_X);
    let notes = lostNotesOver(sim, builder, 1);
    let fetched = false;
    for (let t = 0; t < 3 * CUT_OFF_CHECK_TICKS; t++) {
      notes += lostNotesOver(sim, builder, 1);
      fetched ||= fetching(sim, builder);
    }
    expect(notes).toBe(0);
    expect(fetched).toBe(true);
    expect(sim.world.has(builder, LostWay)).toBe(false);
  });
});
