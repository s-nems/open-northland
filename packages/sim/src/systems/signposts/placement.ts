import type { ContentSet } from '@open-northland/data';
import { Owner, Position, SIGNPOST_SPACING_NODES, Signpost } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { canPlaceWorkFlag, workFlagBlockerVersion, workFlagPlacementBlocks } from '../footprint/index.js';
import { settleSignpostLinks, unlinkSignpost } from './links.js';
import { type SignpostSite, signpostNetwork } from './network.js';

/**
 * Whether `player` may erect a signpost at `node`: open walkable ground under the work-flag rule, off any
 * existing signpost's cell, and not inside {@link SIGNPOST_SPACING_NODES} of a same-player signpost.
 * Signposts do not block walking, so walkability is a ground-quality gate only.
 */
export function canPlaceSignpost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  player: number,
): boolean {
  // canPlaceWorkFlag already covers ground quality, standing bodies, markers, and existing signpost
  // cells; the spacing is the signpost-specific extra gate, same-player only as in the original.
  if (!canPlaceWorkFlag(world, ctx, terrain, node)) return false;
  const c = terrain.coordsOf(node);
  return !insideSpacing(signpostNetwork(world).get(player) ?? [], c.x, c.y);
}

function insideSpacing(posts: readonly SignpostSite[], x: number, y: number): boolean {
  for (const s of posts) {
    if (hexDistanceBetween(s.hx, s.hy, x, y) < SIGNPOST_SPACING_NODES) return true;
  }
  return false;
}

/** A ready-to-query erectability test for one player: {@link canPlaceSignpost}'s rule with the blocked set
 *  and the player's spacing resolved once, asked per visible node by the placement overlay. */
export interface SignpostProbe {
  /** Whether `player` may erect a signpost at half-cell node `(x, y)`. */
  canPlace(x: number, y: number): boolean;
}

/**
 * Per-world memo of the last built probe, keyed by the {@link workFlagBlockerVersion} and its player. One
 * entry suffices, since the app probes for the one human player. A pure read-path cache feeding only the
 * overlay, never a sim decision, so it is not hashed and needs no `verifyCaches` registration.
 */
interface ProbeMemo {
  version: string;
  content: ContentSet;
  terrain: TerrainGraph;
  probe: SignpostProbe;
}
const probeMemo = new WeakMap<World, ProbeMemo>();

/**
 * Build a {@link SignpostProbe} for `player`: the world's blocked set is collected once, so each
 * `canPlace` costs only the player's post count, and the probe rebuilds only when a blocker changes.
 */
export function signpostProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
): SignpostProbe {
  const version = `${workFlagBlockerVersion(world)}:${player}`;
  const cached = probeMemo.get(world);
  if (
    cached !== undefined &&
    cached.version === version &&
    cached.content === content &&
    cached.terrain === terrain
  ) {
    return cached.probe;
  }
  const blocked = workFlagPlacementBlocks(world, content, terrain);
  const posts = signpostNetwork(world).get(player) ?? [];
  const probe: SignpostProbe = {
    canPlace: (x, y) => {
      if (!terrain.inBounds(x, y)) return false;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node) || blocked.has(node)) return false;
      return !insideSpacing(posts, x, y);
    },
  };
  probeMemo.set(world, { version, content, terrain, probe });
  return probe;
}

/**
 * Erect a signpost owned by `player` at `node`, the build-guide atomic's completion effect. Re-validates
 * {@link canPlaceSignpost}, since the world may have changed during the hammer swing, and returns null
 * when the spot is no longer legal. Source basis: observed original, one hammer strike and no materials.
 */
export function erectSignpost(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  node: NodeId,
  player: number,
): Entity | null {
  if (!canPlaceSignpost(world, ctx, terrain, node, player)) return null;
  return createSignpost(world, terrain, node, player);
}

/** Stand `player`'s signpost on `node` with no legality check and link it into the network: the erect's
 *  second half, and how pre-tick assembly, a scene or a fixture stands a post directly. */
export function createSignpost(world: World, terrain: TerrainGraph, node: NodeId, player: number): Entity {
  const c = terrain.coordsOf(node);
  const pos = positionOfNode(c.x, c.y);
  const e = world.create();
  world.add(e, Position, { x: pos.x, y: pos.y });
  world.add(e, Owner, { player });
  world.add(e, Signpost, { links: [] });
  settleSignpostLinks(world, terrain, e);
  return e;
}

/** Take a signpost down: its neighbours drop the link, then the entity goes. */
export function razeSignpost(world: World, post: Entity): void {
  unlinkSignpost(world, post);
  world.destroy(post);
}
