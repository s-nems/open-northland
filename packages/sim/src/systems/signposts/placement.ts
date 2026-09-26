import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Owner,
  Position,
  SIGNPOST_DISPLACE_RADIUS_NODES,
  SIGNPOST_SPACING_NODES,
  Signpost,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import {
  buildingZoneTest,
  canPlaceWorkFlag,
  nearestWorkFlagPlacement,
  workFlagPlacementTest,
} from '../footprint/index.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
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
 * Build a {@link SignpostProbe} for `player` over the live blocked set and the current network, so each
 * `canPlace` costs only the player's post count. Both inputs are live views: ask the probe within one
 * decision or frame and build a fresh one after the world changes.
 */
export function signpostProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
): SignpostProbe {
  const placeable = workFlagPlacementTest(world, content, terrain);
  const posts = signpostNetwork(world).get(player) ?? [];
  return {
    canPlace: (x, y) =>
      terrain.inBounds(x, y) && placeable(terrain.nodeAt(x, y)) && !insideSpacing(posts, x, y),
  };
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

/**
 * Push every signpost inside a just-placed `building`'s reserved zone to the nearest node outside every
 * building's reserved zone that the erect rule's ground test accepts, on the same static ground, and
 * re-link it there. Landing in a neighbour's zone would stand the post under that building's margin art.
 * The placement gate lets a player build over only their own posts. Spacing to the other posts is not
 * re-checked: the post moves, nobody erects it. A post with no such node within {@link SIGNPOST_DISPLACE_RADIUS_NODES}
 * falls. Project rule, as the original never builds on a post.
 */
export function displaceSignpostsFromReserved(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const anchor = nodeOfPosition(p.x, p.y);
  const zone = buildingFootprintOf(ctx.content, b.buildingType)?.reserved;
  const cells = new Set(translatedCells(terrain, zone?.length ? zone : ANCHOR_ONLY, anchor.hx, anchor.hy));
  const enclosed = [...world.query(Signpost, Position)].filter((e) =>
    cells.has(entityNode(world, terrain, e)),
  );
  if (enclosed.length === 0) return;
  // The grid already holds the new building's zone; a post moving changes no zone.
  const zoned = buildingZoneTest(world, ctx.content, terrain);
  // Canonical order, and each relocation lands before the next search, so two posts never share a node.
  for (const post of canonicalById(enclosed)) {
    const from = entityNode(world, terrain, post);
    const ground = terrain.componentOf(from);
    const to = nearestWorkFlagPlacement(world, ctx, terrain, from, {
      accept: (n) => !zoned(n) && terrain.componentOf(n) === ground,
      withinRadius: SIGNPOST_DISPLACE_RADIUS_NODES,
    });
    if (to === null) razeSignpost(world, post);
    else relocateSignpost(world, terrain, post, to);
  }
}

/** Stand `post` on `node` and re-link it there. The component is re-added rather than the Position written
 *  in place: the placement blocker caches replay Signpost membership and hold a post's cell fixed while it
 *  keeps the component. */
function relocateSignpost(world: World, terrain: TerrainGraph, post: Entity, node: NodeId): void {
  unlinkSignpost(world, post);
  world.remove(post, Signpost);
  const c = terrain.coordsOf(node);
  const pos = world.mut(post, Position);
  const centre = positionOfNode(c.x, c.y);
  pos.x = centre.x;
  pos.y = centre.y;
  world.add(post, Signpost, { links: [] });
  settleSignpostLinks(world, terrain, post);
}
