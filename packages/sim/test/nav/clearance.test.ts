import { describe, expect, it } from 'vitest';
import {
  buildTerrainGraph,
  ClearanceField,
  halfCellMapFromCells,
  MAX_CLEARANCE_CLASS,
  type NodeId,
} from '../../src/index.js';
import { hexDisc } from '../../src/systems/footprint/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';

/**
 * The free-size class field (docs/formats/VEHICLES.md "Movement", the Open Northland reading): a node's
 * class is the largest hexagon-disc radius of in-bounds, open, same-component nodes around it, capped
 * at 7. Pinned against the disc definition itself, node by node, and the local recompute against a
 * fresh build.
 */

const GRASS = 0;
const WATER = 1;
const NODE_W = 40;
const NODE_H = 40;

/** The definition the field is checked against: the widest disc every point of which is open. */
function discClass(
  graph: ReturnType<typeof buildTerrainGraph>,
  open: (n: NodeId) => boolean,
  node: NodeId,
): number {
  if (!open(node)) return 0;
  const { x, y } = graph.coordsOf(node);
  const component = graph.componentOf(node);
  for (let r = 1; r <= MAX_CLEARANCE_CLASS; r++) {
    for (const { hx, hy } of hexDisc({ hx: x, hy: y }, r)) {
      if (!graph.inBounds(hx, hy)) return r - 1;
      const n = graph.nodeAt(hx, hy);
      if (!open(n) || graph.componentOf(n) !== component) return r - 1;
    }
  }
  return MAX_CLEARANCE_CLASS;
}

function expectMatchesDefinition(
  graph: ReturnType<typeof buildTerrainGraph>,
  field: ClearanceField,
  open: (n: NodeId) => boolean,
): void {
  for (let node = 0; node < graph.nodeCount; node++) {
    const id = node as NodeId;
    expect(field.classOf(id), `node ${node}`).toBe(discClass(graph, open, id));
  }
}

describe('ClearanceField', () => {
  it('reads the disc radius at every node of a map with a wall, water and the map edge', () => {
    // 20x20 cells with a water column at cell 10: two banks, each its own component, 40x40 nodes.
    const graph = buildTerrainGraph(testContent(), waterColumnMap(20, 20, 10));
    const wall = new Set<NodeId>();
    for (let y = 8; y < 30; y++) wall.add(graph.nodeAt(6, y)); // a fence down the left bank
    wall.add(graph.nodeAt(30, 14)); // one post on the right bank
    const open = (n: NodeId): boolean => graph.isWalkable(n) && !wall.has(n);
    const field = new ClearanceField(graph, open);
    expectMatchesDefinition(graph, field, open);
    expect(field.classOf(graph.nodeAt(6, 10))).toBe(0); // the fence itself
    expect(field.classOf(graph.nodeAt(7, 10))).toBe(0); // beside the fence
    expect(field.classOf(graph.nodeAt(30, 30))).toBe(MAX_CLEARANCE_CLASS); // open ground far from anything
    expect(field.classOf(graph.nodeAt(20, 20))).toBe(0); // in the water
  });

  it('recomputes a change locally and lands on the fresh build', () => {
    const graph = buildTerrainGraph(testContent(), grassNodeMap(NODE_W, NODE_H));
    const wall = new Set<NodeId>();
    const open = (n: NodeId): boolean => !wall.has(n);
    const field = new ClearanceField(graph, open);
    expect(field.classOf(graph.nodeAt(20, 20))).toBe(MAX_CLEARANCE_CLASS);

    // A post appears, then a second one, then the first is taken away again.
    const first = graph.nodeAt(20, 20);
    const second = graph.nodeAt(24, 20);
    wall.add(first);
    let probes = 0;
    const counted = (n: NodeId): boolean => {
      probes++;
      return open(n);
    };
    field.recompute(counted, new Set([first]));
    expectMatchesDefinition(graph, field, open);
    // Local: the scan reaches 2 * (cap + 1) rings around the change, a few hundred nodes of a 1600-node
    // map, and each is probed a bounded number of times.
    const scanRing = 2 * (MAX_CLEARANCE_CLASS + 1);
    const scanNodes = hexDisc({ hx: 20, hy: 20 }, scanRing).length;
    expect(probes).toBeLessThan(scanNodes * 9);
    expect(scanNodes).toBeLessThan(graph.nodeCount);

    wall.add(second);
    field.recompute(open, new Set([second]));
    expectMatchesDefinition(graph, field, open);
    wall.delete(first);
    field.recompute(open, new Set([first]));
    expectMatchesDefinition(graph, field, open);
    expect(field.classOf(first)).toBe(3); // four steps from the remaining post: a disc of radius 3
  });
  it('recomputes several changes in one local pass, their discs overlapping and clipped by the edge', () => {
    const side = 120; // wide enough that a handful of scan discs stay a local recompute
    const graph = buildTerrainGraph(testContent(), grassNodeMap(side, side));
    const wall = new Set<NodeId>();
    const open = (n: NodeId): boolean => !wall.has(n);
    const field = new ClearanceField(graph, open);
    const posts = [graph.nodeAt(1, 2), graph.nodeAt(40, 40), graph.nodeAt(44, 41), graph.nodeAt(50, 37)];
    for (const post of posts) wall.add(post);
    field.recompute(open, new Set(posts));
    expectMatchesDefinition(graph, field, open);
    const [, middle] = posts;
    if (middle === undefined) throw new Error('fixture lost its posts');
    wall.delete(middle);
    field.recompute(open, new Set([middle, graph.nodeAt(1, 2)]));
    expectMatchesDefinition(graph, field, open);
  });

  it('moves the water revision of the classes a water edit crosses, and never on a land edit', () => {
    // 20x20 cells, grass west of cell 6 and open water from there: node 30 lies deep in the sea.
    const typeIds = Array.from({ length: 20 * 20 }, (_, i) => (i % 20 < 6 ? GRASS : WATER));
    const graph = buildTerrainGraph(testContent(), halfCellMapFromCells({ width: 20, height: 20, typeIds }));
    const blocked = new Set<NodeId>();
    const open = (n: NodeId): boolean => (graph.isWalkable(n) || graph.isWater(n)) && !blocked.has(n);
    const field = new ClearanceField(graph, open);
    const revisions = (): number[] =>
      Array.from({ length: MAX_CLEARANCE_CLASS }, (_, k) => field.waterRevision(k + 1));
    const built = revisions();

    const land = graph.nodeAt(8, 20); // a post on the shore, beside the water
    blocked.add(land);
    field.recompute(open, new Set([land]));
    expect(field.classOf(land)).toBe(0);
    expect(revisions()).toEqual(built);

    const water = graph.nodeAt(30, 20);
    blocked.add(water);
    field.recompute(open, new Set([water]));
    expect(field.classOf(water)).toBe(0);
    // Open sea all round: the blocked node and its rings fall through every class.
    const after = revisions();
    for (const [k, revision] of after.entries())
      expect(revision, `class ${k + 1}`).toBeGreaterThan(built[k] ?? 0);
    expectMatchesDefinition(graph, field, open);
  });
});
