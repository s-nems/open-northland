import { describe, expect, it } from 'vitest';
import { Position } from '../../../../../src/components/index.js';
import { World } from '../../../../../src/ecs/world.js';
import { positionOfNode } from '../../../../../src/index.js';
import { buildReach } from '../../../../../src/systems/computer-player/build-order/ground/reach.js';

/** Overlapping building discs, one near the map's origin corner so a box there runs past the edge. */
const REACH_BUILDINGS = [
  { hx: 10, hy: 10 },
  { hx: 14, hy: 13 },
  { hx: 21, hy: 7 },
  { hx: 2, hy: 3 },
];
const REACH_RADIUS = 6;
/** Boxes over the overlaps, across the map edge, partly outside every disc, and wholly outside them. */
const BOXES = [
  { centre: { hx: 13, hy: 10 }, span: 9 },
  { centre: { hx: 0, hy: 0 }, span: 5 },
  { centre: { hx: 26, hy: 4 }, span: 4 },
  { centre: { hx: 40, hy: 40 }, span: 3 },
];
/** Nodes tested past each box side, where the box test falls back to the plain one. */
const BOX_MARGIN = 2;

describe('build reach box test', () => {
  it('answers like the plain reach test inside its box and around it', () => {
    const world = new World();
    const owned = REACH_BUILDINGS.map((node) => {
      const e = world.create();
      world.add(e, Position, positionOfNode(node.hx, node.hy));
      return e;
    });
    const reach = buildReach(world, owned, { hx: 0, hy: 0 }, REACH_RADIUS);
    for (const { centre, span } of BOXES) {
      const test = reach.boxTest(centre, span);
      const extent = span + BOX_MARGIN;
      for (let y = centre.hy - extent; y <= centre.hy + extent; y++) {
        for (let x = centre.hx - extent; x <= centre.hx + extent; x++)
          expect(test(x, y), `box at (${centre.hx}, ${centre.hy}): (${x}, ${y})`).toBe(reach.contains(x, y));
      }
    }
  });
});
