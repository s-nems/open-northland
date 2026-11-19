import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/index.js';
import { NodeMask } from '../../src/nav/block-overlay.js';
import { floodReach } from '../../src/nav/range-search.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { walkStepsBetween } from '../../src/nav/walk-steps.js';
import { walkLengthTo } from '../../src/systems/signposts/walk-length.js';
import { testContent } from '../fixtures/content.js';
import { waterColumnMap } from '../fixtures/terrain.js';

const CELLS_W = 30;
const CELLS_H = 24;
const RIVER_COLUMN = 14;
const FORD_ROWS = 2;
const LONGEST_WALK = 75;
const BLOCKED_ONE_IN = 7;
const STARTS = 6;
const UNBOUNDED_SEARCH = Number.MAX_SAFE_INTEGER;
/** The hex range of a flood asked only for its costs. */
const NO_MARKED_AREA = 1;

/** A deterministic LCG, so a failure replays. */
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % n;
  };
}

describe('walkStepsBetween', () => {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: waterColumnMap(CELLS_W, CELLS_H, RIVER_COLUMN, FORD_ROWS),
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const roll = rng(3);
  // A river with a ford at its foot and scattered blockers: straight walks, detours and no walk at all.
  const blocked = new NodeMask(terrain.width * terrain.height);
  for (let node = 0; node < terrain.width * terrain.height; node++) {
    if (roll(BLOCKED_ONE_IN) === 0) blocked.set(node as NodeId, true);
  }
  const starts: { x: number; y: number }[] = [];
  while (starts.length < STARTS) {
    const at = { x: roll(terrain.width), y: roll(terrain.height) };
    const node = terrain.nodeAt(at.x, at.y);
    if (terrain.isWalkable(node) && terrain.resistanceAt(node) !== 0 && !blocked.has(node)) starts.push(at);
  }

  it.each([4, 20, LONGEST_WALK])('tells every length a flood of %i steps tells', (within) => {
    const wrong: string[] = [];
    for (const from of starts) {
      const flood = floodReach(terrain, blocked, from.x, from.y, NO_MARKED_AREA, within, false).costs;
      for (let y = 0; y < terrain.height; y++) {
        for (let x = 0; x < terrain.width; x++) {
          const expected = walkLengthTo(flood, x, y);
          const got = walkStepsBetween(terrain, blocked, from.x, from.y, x, y, within, UNBOUNDED_SEARCH);
          if (got !== expected) wrong.push(`${from.x},${from.y} to ${x},${y}: ${got} for ${expected}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('gives up undecided once it has settled its share of nodes', () => {
    const from = starts[0] as { x: number; y: number };
    const flood = floodReach(terrain, blocked, from.x, from.y, NO_MARKED_AREA, LONGEST_WALK, false).costs;
    let undecided = 0;
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const got = walkStepsBetween(terrain, blocked, from.x, from.y, x, y, LONGEST_WALK, STARTS);
        if (got === undefined) undecided++;
        else expect(got).toBe(walkLengthTo(flood, x, y));
      }
    }
    expect(undecided).toBeGreaterThan(0);
  });
});
