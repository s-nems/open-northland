import { beforeEach, describe, expect, it } from 'vitest';
import { Health, HerdMember, Position, Settler } from '../src/components/index.js';
import { Simulation, type TerrainMap, buildTerrainGraph, seedAnimalHerds } from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Tests for the **map populator** `seedAnimalHerds` — the pure command-producer that seeds a map's
 * wildlife by issuing `spawnAnimalHerd` commands at walkable birth points. The fixture's recorded
 * animal tribes are the BEAR (tribe 10, herd of 3, searchForLeader) and the BEE (tribe 11, solitary);
 * the VIKING (tribe 1) is a civilization (no animaltypes record) and is never seeded.
 *
 * The populator is pure (no world mutation): it returns `spawnAnimalHerd` commands, which a caller
 * enqueues through the one mutation seam — so the end-to-end test enqueues them and runs `step()`.
 */

const BEAR = 10;
const BEE = 11;
const GRASS = 0; // walkable landscape typeId
const WATER = 1; // non-walkable landscape typeId

/** A row-major terrain map from a 2-D grid of landscape typeIds (row 0 first). */
function mapOf(rows: number[][]): TerrainMap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return { width, height, typeIds: rows.flat() };
}

/** An all-grass (fully walkable) w×h map. */
function grass(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function clearStores(): void {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  HerdMember.store.clear();
}

beforeEach(clearStores);

describe('seedAnimalHerds (map populator)', () => {
  it('emits one spawnAnimalHerd per walkable cell at stride 1, only at walkable cells', () => {
    const content = testContent();
    // A 3×1 strip: grass | water | grass — only two cells are walkable.
    const map = mapOf([[GRASS, WATER, GRASS]]);
    const cmds = seedAnimalHerds(content, map);

    expect(cmds).toHaveLength(2); // two walkable cells -> two herds
    expect(cmds.every((c) => c.kind === 'spawnAnimalHerd')).toBe(true);
    // The water cell (x=1) is never a birth point; both herds land on the grass cells (x=0, x=2).
    const xs = cmds.map((c) => (c.kind === 'spawnAnimalHerd' ? c.x : -1)).sort();
    expect(xs).toEqual([0, 2]);
  });

  it('only seeds recorded animal tribes, never a civilization, in canonical order', () => {
    const content = testContent();
    const cmds = seedAnimalHerds(content, grass(4, 1));
    const tribes = new Set(cmds.map((c) => (c.kind === 'spawnAnimalHerd' ? c.tribe : -1)));
    // BEAR(10) + BEE(11) are the only recorded animals; the VIKING civilization is never seeded.
    expect([...tribes].sort((a, b) => a - b)).toEqual([BEAR, BEE]);
  });

  it('round-robins successive birth points across the animal tribes', () => {
    const content = testContent();
    const cmds = seedAnimalHerds(content, grass(4, 1)); // 4 walkable cells, 2 tribes
    const tribes = cmds.map((c) => (c.kind === 'spawnAnimalHerd' ? c.tribe : -1));
    // Canonical tribe order [10, 11] assigned round-robin to birth points 0..3.
    expect(tribes).toEqual([BEAR, BEE, BEAR, BEE]);
  });

  it('cellStride spreads birth points out (every Nth walkable cell)', () => {
    const content = testContent();
    const cmds = seedAnimalHerds(content, grass(6, 1), { cellStride: 3 });
    const xs = cmds.map((c) => (c.kind === 'spawnAnimalHerd' ? c.x : -1));
    expect(xs).toEqual([0, 3]); // every 3rd of 6 walkable cells
  });

  it('maxHerds caps the number of commands', () => {
    const content = testContent();
    const cmds = seedAnimalHerds(content, grass(10, 1), { maxHerds: 3 });
    expect(cmds).toHaveLength(3);
  });

  it('the tribes filter restricts to a subset (and drops a non-animal id)', () => {
    const content = testContent();
    // Request BEAR + the VIKING civilization (1, which has no animal record -> dropped).
    const cmds = seedAnimalHerds(content, grass(3, 1), { tribes: [BEAR, 1] });
    const tribes = new Set(cmds.map((c) => (c.kind === 'spawnAnimalHerd' ? c.tribe : -1)));
    expect([...tribes]).toEqual([BEAR]); // only the recorded animal survives
  });

  it('seeds nothing on a map with no walkable cells', () => {
    const content = testContent();
    const allWater = { width: 3, height: 1, typeIds: [WATER, WATER, WATER] };
    expect(seedAnimalHerds(content, allWater)).toHaveLength(0);
  });

  it('is deterministic: two calls (and a built-graph call) produce identical commands', () => {
    const content = testContent();
    const map = grass(5, 2);
    const a = seedAnimalHerds(content, map);
    const b = seedAnimalHerds(content, map);
    // Accepts a built TerrainGraph too — same result as the raw map.
    const c = seedAnimalHerds(content, buildTerrainGraph(content, map));
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('end-to-end: enqueuing the seeded commands actually places herds via step()', () => {
    const content = testContent();
    const map = grass(8, 1);
    // One BEAR herd only, so the count is exact: 3 creatures (maximumGroupSize), with a leader.
    const cmds = seedAnimalHerds(content, map, { tribes: [BEAR], maxHerds: 1 });
    expect(cmds).toHaveLength(1);

    const sim = new Simulation({ seed: 1, content, map });
    for (const c of cmds) sim.enqueue(c);
    sim.step();

    const herd = [...sim.world.query(Settler, Health, Position)];
    expect(herd).toHaveLength(3); // the bear's maximumGroupSize
    for (const e of herd) {
      expect(sim.world.get(e, Settler).tribe).toBe(BEAR);
      expect(sim.world.has(e, HerdMember)).toBe(true); // bear searchForLeader -> a herd with a leader
    }
  });
});
