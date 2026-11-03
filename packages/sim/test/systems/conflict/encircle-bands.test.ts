import { describe, expect, it } from 'vitest';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import { type LandscapeProps, type NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { bandGeometry } from '../../../src/systems/conflict/encircle-bands.js';
import type { WeaponBand } from '../../../src/systems/conflict/weapon-band.js';

const GRASS = 0;
const WATER = 1;
const PROPS = new Map<number, LandscapeProps>([
  [GRASS, { walkable: true, buildable: true, plantable: true }],
  [WATER, { walkable: false, buildable: false, plantable: false }],
]);
const WIDTH = 23;
const HEIGHT = 17;
const CASES = 150;
const MAX_BODY_NODES = 9;
const MAX_REACH = 6;
/** One node in this many is water, so the walkable filter is exercised. */
const WATER_ONE_IN = 5;

/** A deterministic integer stream for the fixtures (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/** The contract by brute force: every walkable node whose map-point distance to the nearest wall lies in
 *  the band. */
function reference(terrain: TerrainGraph, body: readonly NodeId[], band: WeaponBand): NodeId[] {
  const cells: NodeId[] = [];
  for (let node = 0; node < terrain.nodeCount; node++) {
    const cell = node as NodeId;
    if (!terrain.isWalkable(cell)) continue;
    let reach = Number.POSITIVE_INFINITY;
    for (const wall of body) {
      reach = Math.min(
        reach,
        hexDistanceBetween(terrain.xOf(cell), terrain.yOf(cell), terrain.xOf(wall), terrain.yOf(wall)),
      );
    }
    if (reach >= band.minRange && reach <= band.maxRange) cells.push(cell);
  }
  return cells;
}

describe('bandGeometry', () => {
  const next = lcg(11);
  const types = Int32Array.from({ length: WIDTH * HEIGHT }, () =>
    next() % WATER_ONE_IN === 0 ? WATER : GRASS,
  );
  const terrain = new TerrainGraph(WIDTH, HEIGHT, types, PROPS);

  it('holds exactly the walkable nodes whose reach to the nearest wall is in the band, edges included', () => {
    for (let i = 0; i < CASES; i++) {
      const body = Array.from(
        { length: 1 + (next() % MAX_BODY_NODES) },
        () => (next() % terrain.nodeCount) as NodeId,
      );
      const minRange = next() % MAX_REACH;
      const band = { minRange, maxRange: minRange + (next() % MAX_REACH) };
      const cells = bandGeometry(terrain, body, band);
      expect(new Set(cells).size).toBe(cells.length);
      expect([...cells].sort((a, b) => a - b)).toEqual(reference(terrain, body, band));
    }
  });

  it('holds nothing around an empty body', () => {
    expect(bandGeometry(terrain, [], { minRange: 0, maxRange: MAX_REACH })).toEqual([]);
  });
});
