import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { hexDistanceBetween } from '../../../src/nav/halfcell.js';
import { NO_WALK, type WalkLengths } from '../../../src/nav/node-circle.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import { nearestCell } from '../../../src/systems/spatial/metric.js';
import {
  leastRankLength,
  nearestRankedCell,
  rankSweepRadius,
  walkRanking,
} from '../../../src/systems/spatial/walk-rank.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

function terrainOf(sim: Simulation) {
  if (sim.terrain === undefined) throw new Error('fixture map missing');
  return sim.terrain;
}

describe('ranking cells by the walk to them', () => {
  const terrain = terrainOf(new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(40, 8) }));
  const from = terrain.nodeAt(10, 4);
  const near = terrain.nodeAt(13, 4);
  const far = terrain.nodeAt(20, 4);
  const farther = terrain.nodeAt(24, 4);
  const NEAR_DETOUR_STEPS = 40;
  const FAR_STEPS = 10;
  /** `near` lies behind a detour, `far` on open ground, `farther` past the walk's reach. */
  const walk: WalkLengths = {
    from,
    maxSteps: NEAR_DETOUR_STEPS,
    stepsTo: (node: NodeId) => (node === near ? NEAR_DETOUR_STEPS : node === far ? FAR_STEPS : NO_WALK),
  };
  const gate = {
    bounds: { minX: 0, maxX: terrain.width - 1, minY: 0, maxY: terrain.height - 1 },
    allowsNode: () => true,
    walkLengths: () => walk,
  };

  it('takes the shorter walk over the shorter line, and a walked cell over an unwalked one', () => {
    expect(nearestCell(terrain, [near, far, farther], from)).toBe(near);
    expect(nearestRankedCell(terrain, walk, [near, far, farther], from)).toBe(far);
    expect(nearestRankedCell(terrain, walk, [near, farther], from)).toBe(near);
    expect(nearestRankedCell(terrain, walk, [near, far], from, (cell) => cell !== far)).toBe(near);
  });

  it('ranks unwalked cells among themselves by distance', () => {
    const beyond = terrain.nodeAt(30, 4);
    expect(nearestRankedCell(terrain, walk, [beyond, farther], from)).toBe(farther);
  });

  it('bounds a walk by distance from both sides, on even and odd rows alike', () => {
    const SPAN = 40;
    const broken: string[] = [];
    for (const [ox, oy] of [
      [SPAN, SPAN],
      [SPAN, SPAN + 1],
    ] as const) {
      for (let dx = -SPAN; dx <= SPAN; dx++) {
        for (let dy = -SPAN; dy <= SPAN; dy++) {
          // The shortest walk over open ground takes the hex distance.
          const steps = hexDistanceBetween(ox, oy, ox + dx, oy + dy);
          const distance = Math.abs(dx) + Math.abs(dy);
          if (leastRankLength(walk, distance) > steps || rankSweepRadius(walk, steps) < distance) {
            broken.push(`${dx},${dy} from row ${oy}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('ranks by the walk only from the node the walk starts at', () => {
    expect(walkRanking(gate, from)).toBe(walk);
    expect(walkRanking(gate, near)).toBeUndefined();
    expect(walkRanking(gate, from, near)).toBeUndefined();
    expect(walkRanking({ ...gate, walkLengths: () => null }, from)).toBeUndefined();
  });
});
