import { FOG_MODE, FOG_STATE, type FogView, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FogMemories } from '../../../src/data/fog/memories.js';
import { ONE } from '../../../src/index.js';
import { drawableGhosts, entity, fogViewOf, snapshotOf } from '../../support/fixtures.js';

const NODE_WIDTH = 64;
const node = (hx: number, hy: number): number => hy * NODE_WIDTH + hx;
const START = node(2, 2);
const NEAR = node(4, 2);
const FAR = node(40, 40);
const OWN = 0;
const ALLY = 1;

/** `player`'s view watching the cells of `nodes`; every other cell explored. */
function watchingNodes(player: number, nodes: readonly number[], generation: number): FogView {
  const cells = new Map<string, number>();
  for (const id of nodes) {
    const { cx, cy } = systems.cellOfNode(id % NODE_WIDTH, Math.floor(id / NODE_WIDTH));
    cells.set(`${cx},${cy}`, FOG_STATE.VISIBLE);
  }
  return { ...fogViewOf(cells, generation, FOG_MODE.RECON_FOG_OF_WAR), player };
}

describe('FogMemories', () => {
  it("keeps each seat's road memory apart and swaps the ground to the drawn one's", () => {
    const memories = new FogMemories(NODE_WIDTH);
    const own = watchingNodes(OWN, [NEAR], 1);
    const ally = watchingNodes(ALLY, [], 1);
    memories.setViews(own, [own, ally]);
    expect(memories.syncRoads({ added: [START], removed: [] })).toEqual({ added: [START], removed: [] });
    // A road laid where only the drawn seat looks.
    expect(memories.syncRoads({ added: [NEAR], removed: [] })).toEqual({ added: [NEAR], removed: [] });
    const revision = memories.revision;
    memories.setViews(ally, [own, ally]);
    expect(memories.syncRoads(null)).toEqual({ added: [], removed: [NEAR] });
    expect([...memories.nodes]).toEqual([START]);
    expect(memories.revision).not.toBe(revision);
    // The whole map draws the network as it stands.
    memories.setViews(null, [own, ally]);
    expect(memories.syncRoads(null)).toEqual({ added: [NEAR], removed: [] });
  });

  it('starts a memory begun mid-game from the network as it stands', () => {
    const memories = new FogMemories(NODE_WIDTH);
    const own = watchingNodes(OWN, [], 1);
    memories.setViews(own, [own]);
    memories.syncRoads({ added: [START], removed: [] });
    expect(memories.syncRoads({ added: [FAR], removed: [] })).toBeNull(); // laid out of sight
    const ally = watchingNodes(ALLY, [], 1);
    memories.setViews(ally, [own, ally]);
    expect(memories.syncRoads(null)).toEqual({ added: [FAR], removed: [] });
  });

  it("gives every seat's memory the start buildings, one begun later only those still standing", () => {
    const building = { buildingType: 7, tribe: 1, built: ONE, level: 0 };
    const house = entity(1, 5, 4, { Building: building });
    const razed = entity(2, 9, 4, { Building: building });
    const memories = new FogMemories(NODE_WIDTH);
    memories.knowStartBuildings();
    const own = watchingNodes(OWN, [], 1);
    memories.setViews(own, [own]);
    memories.updateGhosts(snapshotOf([house, razed]), undefined, undefined);
    const drawn = () => {
      const ghosts = memories.drawnGhosts;
      return ghosts === null ? [] : drawableGhosts(ghosts).map((g) => g.ref);
    };
    expect(drawn()).toEqual([house.id, razed.id]);
    const ally = watchingNodes(ALLY, [], 1);
    memories.setViews(ally, [own, ally]);
    memories.updateGhosts(snapshotOf([house]), undefined, undefined);
    expect(drawn()).toEqual([house.id]);
    // The first seat never saw the razing: it still remembers both.
    memories.setViews(own, [own, ally]);
    expect(drawn()).toEqual([house.id, razed.id]);
  });

  it("restores a save into its own seat's memory alone, its roads waiting for that seat's sight", () => {
    const house = entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 } });
    const memories = new FogMemories(NODE_WIDTH);
    const ghost = { ref: house.id, kind: 'building', tileX: 5, tileY: 4 } as const;
    memories.restore({ statics: { player: OWN, ghosts: [ghost], reconSeeded: false }, roads: [START] });
    const own = watchingNodes(OWN, [], 1);
    const ally = watchingNodes(ALLY, [], 1);
    memories.setViews(ally, [ally]);
    memories.updateGhosts(snapshotOf([house]), undefined, undefined);
    // The road the save never saw is laid out of sight: only the restored network shows.
    expect(memories.syncRoads({ added: [START, FAR], removed: [] })).toEqual({
      added: [START, FAR],
      removed: [],
    });
    expect(memories.drawnGhosts?.has(house.id)).toBe(false);
    memories.setViews(own, [own, ally]);
    memories.updateGhosts(snapshotOf([house]), undefined, undefined);
    expect(memories.drawnGhosts?.has(house.id)).toBe(true);
    expect(memories.syncRoads(null)).toEqual({ added: [], removed: [FAR] });
  });

  it('starts every memory over when no view is given, the fog turned off', () => {
    const memories = new FogMemories(NODE_WIDTH);
    const house = entity(1, 5, 4, { Building: { buildingType: 7, tribe: 1, built: ONE, level: 0 } });
    const seen = { ...fogViewOf(new Map([['5,4', FOG_STATE.VISIBLE]]), 1), player: ALLY };
    const left = { ...fogViewOf(new Map([['5,4', FOG_STATE.EXPLORED]]), 2), player: ALLY };
    memories.setViews(seen, [seen]);
    memories.updateGhosts(snapshotOf([house]), undefined, undefined);
    memories.setViews(left, [left]);
    memories.updateGhosts(snapshotOf([house]), undefined, undefined);
    expect(memories.drawnGhosts?.has(house.id)).toBe(true);
    memories.setViews(null, []);
    expect(memories.drawnGhosts).toBeNull();
    memories.setViews(left, [left]);
    memories.updateGhosts(snapshotOf([house]), undefined, undefined);
    expect(memories.drawnGhosts?.has(house.id)).toBe(false);
  });
});
