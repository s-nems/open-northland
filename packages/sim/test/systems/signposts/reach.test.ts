import { describe, expect, it } from 'vitest';
import { WALK_ROUTE_STEPS } from '../../../src/components/index.js';
import { cellAnchorNode, type NodeId } from '../../../src/index.js';
import { walkLengthTo } from '../../../src/nav/range-search.js';
import { walkLengthsFrom } from '../../../src/systems/signposts/index.js';
import { walkReachLimitAt } from '../../../src/systems/signposts/reach.js';
import { ACROSS_CELL, nodeOfCell, ORIGIN_CELL, RIVER_PLAYER, riverSim } from '../../fixtures/river-bank.js';
import { stampPost } from './support.js';

const OTHER_PLAYER = 1;
/** Where another player's post stands, far from every node the origin's flood read. */
const FAR_POST_CELL = { x: 1, y: 0 };

describe("a walk reach's own steps", () => {
  it('are the same searched towards the node, read off its flood and read off a flood held from before', () => {
    const { sim, terrain } = riverSim(true);
    const from = cellAnchorNode(ORIGIN_CELL.x, ORIGIN_CELL.y);
    const reach = () => {
      const limit = walkReachLimitAt(sim.world, sim.content, terrain, RIVER_PLAYER, from.hx, from.hy, false);
      if (limit === null) throw new Error('a walk starts on the bank');
      return limit;
    };
    const everyStep = (limit: ReturnType<typeof reach>): number[] => {
      const steps: number[] = [];
      for (let node = 0; node < terrain.nodeCount; node++)
        steps.push(
          limit.ownWalkSteps(terrain.xOf(node as NodeId), terrain.yOf(node as NodeId), WALK_ROUTE_STEPS),
        );
      return steps;
    };
    const full = walkLengthsFrom(sim.world, sim.content, terrain, from.hx, from.hy, WALK_ROUTE_STEPS - 1);
    if (full === null) throw new Error('a walk starts on the bank');
    const expected: number[] = [];
    for (let node = 0; node < terrain.nodeCount; node++)
      expected.push(walkLengthTo(full, terrain.xOf(node as NodeId), terrain.yOf(node as NodeId)));

    const searched = reach();
    expect(everyStep(searched)).toEqual(expected);
    // A node in range that no group covers is answered by the spot's flood, which the limit then reads.
    searched.allowsNode(nodeOfCell(terrain, ACROSS_CELL));
    expect(everyStep(searched)).toEqual(expected);
    // Another player's post moves the reach key: the limit is made anew and finds the flood still held.
    stampPost(sim, FAR_POST_CELL.x, FAR_POST_CELL.y, OTHER_PLAYER);
    const rebased = reach();
    expect(rebased).not.toBe(searched);
    expect(everyStep(rebased)).toEqual(expected);
  });
});
