import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { latticeOffsetDistance } from '../../src/nav/terrain/index.js';
import { NO_ROAD_NETWORK, RoadNetworks } from '../../src/nav/terrain/road-networks.js';

const WIDTH = 19;
const HEIGHT = 23;
const RANDOM_ROADS = 120;

/** The eight lattice neighbours of `node`, the edge set the networks join over. */
function neighbours(node: number): number[] {
  const x = node % WIDTH;
  const y = (node - x) / WIDTH;
  const out: number[] = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 2],
    [-1, 2],
    [1, -2],
    [-1, -2],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) out.push(ny * WIDTH + nx);
  }
  return out;
}

/** Each road node's least connected road node id, by flood fill. */
function leastConnected(roads: ReadonlySet<number>): Map<number, number> {
  const labels = new Map<number, number>();
  for (const seed of [...roads].sort((a, b) => a - b)) {
    if (labels.has(seed)) continue;
    const queue = [seed];
    labels.set(seed, seed);
    for (const node of queue) {
      for (const next of neighbours(node)) {
        if (!roads.has(next) || labels.has(next)) continue;
        labels.set(next, seed);
        queue.push(next);
      }
    }
  }
  return labels;
}

describe('road networks', () => {
  it('merges two networks when a lay bridges them, and widens the bounding box', () => {
    const networks = new RoadNetworks(WIDTH, HEIGHT);
    const west = [2, 3, 4].map((x) => 10 * WIDTH + x);
    const east = [6, 7, 8].map((x) => 10 * WIDTH + x);
    for (const node of [...west, ...east]) networks.add(node);
    const westLabel = networks.networkOf(west[0] ?? 0);
    expect(networks.networkOf(east[0] ?? 0)).not.toBe(westLabel);
    // East of x = 4 lies outside the west network's box, so the east end is a column's gap away.
    expect(networks.gapTo(westLabel, 8, 10)).toBe(latticeOffsetDistance(4, 0));

    networks.add(10 * WIDTH + 5);
    for (const node of [...west, ...east]) expect(networks.networkOf(node)).toBe(westLabel);
    expect(networks.gapTo(westLabel, 8, 10)).toBe(0);
    expect(networks.networkOf(0)).toBe(NO_ROAD_NETWORK);
  });

  it('labels each network by its least node, whatever order the roads came in', () => {
    const rng = new Rng(3);
    const roads = new Set<number>();
    const networks = new RoadNetworks(WIDTH, HEIGHT);
    for (let i = 0; i < RANDOM_ROADS; i++) {
      const node = rng.int(WIDTH * HEIGHT);
      roads.add(node);
      networks.add(node);
    }
    const rebuilt = new RoadNetworks(WIDTH, HEIGHT);
    for (const node of [...roads].reverse()) rebuilt.add(node);
    const expected = leastConnected(roads);
    for (let node = 0; node < WIDTH * HEIGHT; node++) {
      const label = expected.get(node) ?? NO_ROAD_NETWORK;
      expect(networks.networkOf(node)).toBe(label);
      expect(rebuilt.networkOf(node)).toBe(label);
    }
  });
});
