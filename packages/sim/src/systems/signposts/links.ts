import type { ContentSet } from '@open-northland/data';
import { Owner, Position, SIGNPOST_LINK_RANGE_NODES, Signpost } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { TileBuckets } from '../../inspect/tile-buckets.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { reachContains, searchReach } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { signpostNetworkRevision } from './network.js';
import { signpostTerrainKey, type TerrainReach, terrainReach } from './terrain-reach.js';

interface Sites {
  readonly generation: number;
  readonly buckets: TileBuckets<{ id: Entity; hx: number; hy: number }>;
}
const sites = new WeakMap<World, Sites>();
function candidates(world: World, post: Entity): { id: Entity; hx: number; hy: number }[] {
  const generation = world.componentGeneration(Signpost);
  let held = sites.get(world);
  if (held === undefined || held.generation !== generation) {
    const buckets = new TileBuckets<{ id: Entity; hx: number; hy: number }>();
    for (const id of world.query(Signpost, Position)) {
      const p = world.get(id, Position);
      const n = nodeOfPosition(p.x, p.y);
      buckets.set(id, { id, ...n }, n.hx / 2, n.hy / 2);
    }
    held = { generation, buckets };
    sites.set(world, held);
  }
  const p = world.get(post, Position);
  const n = nodeOfPosition(p.x, p.y);
  const r = SIGNPOST_LINK_RANGE_NODES;
  const owner = world.get(post, Owner).player;
  return held.buckets
    .within({ minX: (n.hx - r) / 2, maxX: (n.hx + r) / 2, minY: (n.hy - r) / 2, maxY: (n.hy + r) / 2 })
    .filter((p) => p.id !== post && world.tryGet(p.id, Owner)?.player === owner);
}

const reaches = new WeakMap<World, Map<Entity, TerrainReach>>();

function reachableLinks(world: World, terrain: TerrainGraph, post: Entity, content?: ContentSet): Entity[] {
  const nearby = candidates(world, post);
  if (nearby.length === 0) return [];
  const p = world.get(post, Position);
  const origin = nodeOfPosition(p.x, p.y);
  let held = reaches.get(world);
  if (held === undefined) {
    held = new Map();
    reaches.set(world, held);
  }
  const found =
    content === undefined
      ? undefined
      : terrainReach(
          world,
          content,
          terrain,
          origin.hx,
          origin.hy,
          SIGNPOST_LINK_RANGE_NODES,
          held.get(post),
        );
  if (found !== undefined) held.set(post, found);
  const area =
    found?.area ??
    searchReach(terrain, { size: 0, has: () => false }, origin.hx, origin.hy, SIGNPOST_LINK_RANGE_NODES);
  return nearby
    .filter((p) => reachContains(area, p.hx, p.hy))
    .map((p) => p.id)
    .sort((a, b) => a - b);
}

/** Original guide links use the goods search's terrain budget and strict 40-node boundary.
 *  Link count remains uncapped; the original retains at most eight neighbours. */
export function settleSignpostLinks(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): void {
  const linked = reachableLinks(world, terrain, post, content);
  world.mut(post, Signpost).links = linked;
  for (const other of linked) {
    const links = world.get(other, Signpost).links;
    if (!links.includes(post)) world.mut(other, Signpost).links = [...links, post].sort((a, b) => a - b);
  }
}

const layouts = new WeakMap<World, string>();
/** A changed road, building or landscape can connect or cut an existing network. */
export const signpostLinksSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const key = `${signpostTerrainKey(world, ctx.content, terrain)}:${signpostNetworkRevision(world)}`;
  if (layouts.get(world) === key) return;
  const posts = world.canonicalQuery(Signpost, Position, Owner);
  const held = reaches.get(world);
  for (const id of held?.keys() ?? []) if (!world.has(id, Signpost)) held?.delete(id);
  const next = new Map(posts.map((p) => [p, new Set<Entity>()]));
  for (const post of posts)
    for (const other of reachableLinks(world, terrain, post, ctx.content)) {
      next.get(post)?.add(other);
      next.get(other)?.add(post);
    }
  for (const [post, ids] of next) {
    const links = [...ids].sort((a, b) => a - b);
    const old = world.get(post, Signpost).links;
    if (old.length !== links.length || old.some((id, i) => id !== links[i]))
      world.mut(post, Signpost).links = links;
  }
  layouts.set(world, `${signpostTerrainKey(world, ctx.content, terrain)}:${signpostNetworkRevision(world)}`);
};

/** Drop a falling post from its neighbours' link lists, before it is destroyed. */
export function unlinkSignpost(world: World, post: Entity): void {
  for (const other of world.get(post, Signpost).links) {
    const links = world.tryMut(other, Signpost);
    if (links !== undefined) links.links = links.links.filter((e) => e !== post);
  }
}

/** Re-settle the links of a post that changed hands: it leaves its old owner's posts and joins the new
 *  owner's in range. Source basis: the original's guide rescan links same-player guides only. */
export function relinkSignpost(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  content?: ContentSet,
): void {
  unlinkSignpost(world, post);
  world.mut(post, Signpost).links = [];
  settleSignpostLinks(world, terrain, post, content);
}
