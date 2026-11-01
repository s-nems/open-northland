import { Livestock, Position } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { derivedEntityNode, entityNode } from '../spatial/nodes.js';

/**
 * Pushes onto `out` every positioned livestock animal within `range` hex map points of `at`, by node in
 * row-major order. The index is caught up on the call, so a pass that moves no animal calls it per scout
 * and reads the same nodes throughout.
 */
export function livestockWithin(
  world: World,
  terrain: TerrainGraph,
  at: NodeId,
  range: number,
  out: Entity[],
): void {
  const herd = herdNodesOf(world, terrain);
  const x = terrain.xOf(at);
  const y = terrain.yOf(at);
  // The half-cell columns a hex distance of `range` can span on either side; the exact test filters the box.
  const columns = 2 * range + 1;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -columns; dx <= columns; dx++) {
      if (!terrain.inBounds(x + dx, y + dy)) continue;
      if (hexDistanceBetween(x, y, x + dx, y + dy) > range) continue;
      const animals = herd.byNode.get(terrain.nodeAt(x + dx, y + dy));
      if (animals !== undefined) for (const animal of animals) out.push(animal);
    }
  }
}

/** No held node: the animal is not positioned livestock. */
const NO_NODE = -1;

/** Every positioned livestock animal by its clamped node, kept across ticks from the livestock and
 *  Position membership feed and node moves. */
interface HerdNodes {
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly moves: NodeMoveFeed;
  nodes: Int32Array;
  readonly byNode: Map<NodeId, Entity[]>;
  readonly resync: (e: Entity) => void;
  readonly move: (e: Entity) => void;
}

const herdNodes = new WeakMap<World, HerdNodes>();

function herdNodesOf(world: World, terrain: TerrainGraph): HerdNodes {
  const held = herdNodes.get(world);
  if (held === undefined || held.terrain !== terrain) return rebuildHerdNodes(world, terrain, held);
  let lost = held.feed.drain(held.resync);
  if (held.moves.drain(held.move)) lost = true;
  return lost ? rebuildHerdNodes(world, terrain, held) : held;
}

function rebuildHerdNodes(world: World, terrain: TerrainGraph, held: HerdNodes | undefined): HerdNodes {
  const feed = held?.feed ?? world.watchChanges([Livestock, Position], []);
  const moves = held?.moves ?? watchNodeMoves(world);
  feed.drain(() => {});
  moves.drain(() => {});
  const resync = (e: Entity): void => {
    const node = world.has(e, Livestock) && world.has(e, Position) ? entityNode(world, terrain, e) : NO_NODE;
    if (e >= index.nodes.length) {
      const grown = new Int32Array(Math.max(world.nextEntityId, e + 1, 2 * index.nodes.length)).fill(NO_NODE);
      grown.set(index.nodes);
      index.nodes = grown;
    }
    const was = index.nodes[e] ?? NO_NODE;
    if (was === node) return;
    if (was !== NO_NODE) {
      const list = index.byNode.get(was as NodeId);
      const at = list?.indexOf(e) ?? -1;
      if (list !== undefined && at >= 0) {
        list[at] = list[list.length - 1] as Entity;
        list.pop();
        if (list.length === 0) index.byNode.delete(was as NodeId);
      }
    }
    index.nodes[e] = node;
    if (node === NO_NODE) return;
    const list = index.byNode.get(node);
    if (list === undefined) index.byNode.set(node, [e]);
    else list.push(e);
  };
  const index: HerdNodes = {
    terrain,
    feed,
    moves,
    nodes: new Int32Array(world.nextEntityId).fill(NO_NODE),
    byNode: new Map(),
    resync,
    // Runs after the membership changes, so only a held animal can move.
    move: (e) => {
      if ((index.nodes[e] ?? NO_NODE) !== NO_NODE) resync(e);
    },
  };
  for (const e of world.query(Livestock, Position)) resync(e);
  if (held === undefined) world.registerCacheVerifier('livestockHerdNodes', () => verifyHerdNodes(world));
  herdNodes.set(world, index);
  return index;
}

/** Brings the index up to date, then compares each animal's held node with its current one. */
function verifyHerdNodes(world: World): string[] {
  const held = herdNodes.get(world);
  if (held === undefined) return [];
  const index = herdNodesOf(world, held.terrain);
  let wrong = 0;
  let count = 0;
  for (const e of world.query(Livestock, Position)) {
    count++;
    const node = derivedEntityNode(world, index.terrain, e);
    if (index.nodes[e] !== node || index.byNode.get(node)?.includes(e) !== true) wrong++;
  }
  let listed = 0;
  for (const list of index.byNode.values()) listed += list.length;
  if (listed !== count) wrong++;
  return wrong === 0 ? [] : [`livestockHerdNodes: ${wrong} animals disagree with their stores`];
}
