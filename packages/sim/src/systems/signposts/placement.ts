import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Owner,
  Position,
  SIGNPOST_DISPLACE_RADIUS_NODES,
  SIGNPOST_LINK_RANGE_NODES,
  SIGNPOST_SPACING_NODES,
  Signpost,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, type NodeArea, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFlagBodyNodes, buildingFootprintOf, doorNodeOf } from '../footprint/geometry.js';
import {
  buildingDoorNodes,
  canPlaceWorkFlag,
  nearestWorkFlagPlacement,
  workFlagPlacementTest,
} from '../footprint/index.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { settleSignpostLinks, unlinkSignpost } from './links.js';
import { signpostNetwork } from './network.js';
import { plannedSignposts, type SignpostSpot } from './planned.js';

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

/** Whether `post`'s spacing can cover a node of `area`: the hex distance is at least the row gap and at
 *  least one less than the column gap. */
function spacingReaches(post: SignpostSpot, area: NodeArea): boolean {
  const rows = gapOutside(post.hy, area.minHy, area.maxHy);
  const columns = gapOutside(post.hx, area.minHx, area.maxHx);
  return rows < SIGNPOST_SPACING_NODES && columns - 1 < SIGNPOST_SPACING_NODES;
}

function gapOutside(value: number, min: number, max: number): number {
  return value < min ? min - value : value > max ? value - max : 0;
}

function insideSpacing(posts: readonly SignpostSpot[], x: number, y: number): boolean {
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
 * decision or frame and build a fresh one after the world changes. A probe asked only `within` a node box
 * keeps just the posts whose spacing can reach into it. With `planned`, the spots the player's scouts
 * are on their way to erect at keep their spacing too, as the placement overlay shows it; the erect
 * command itself judges only standing posts.
 */
export function signpostProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  player: number,
  within?: NodeArea,
  { planned = false }: { readonly planned?: boolean } = {},
): SignpostProbe {
  const placeable = workFlagPlacementTest(world, content, terrain);
  const network = signpostNetwork(world).get(player) ?? [];
  const spots: readonly SignpostSpot[] = planned
    ? [...network, ...plannedSignposts(world, terrain, player)]
    : network;
  const posts = within === undefined ? spots : spots.filter((post) => spacingReaches(post, within));
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
  return createSignpost(world, terrain, node, player, ctx.content);
}

/** Stand `player`'s signpost on `node` with no legality check and link it into the network: the erect's
 *  second half, and how pre-tick assembly, a scene or a fixture stands a post directly. */
export function createSignpost(
  world: World,
  terrain: TerrainGraph,
  node: NodeId,
  player: number,
  content?: ContentSet,
): Entity {
  const c = terrain.coordsOf(node);
  const pos = positionOfNode(c.x, c.y);
  const e = world.create();
  world.add(e, Position, { x: pos.x, y: pos.y });
  world.add(e, Owner, { player });
  world.add(e, Signpost, { links: [] });
  settleSignpostLinks(world, terrain, e, content);
  return e;
}

/** Take a signpost down: its neighbours drop the link, then the entity goes. */
export function razeSignpost(world: World, post: Entity): void {
  unlinkSignpost(world, post);
  world.destroy(post);
}

/**
 * Push every signpost under a just-placed `building`'s walls or on its door to the nearest node the erect
 * rule's ground test accepts, off every door and on the same static ground, and re-link it there. It
 * prefers, in turn, a node that keeps every link in range, so the push does not split the network, and a
 * row south of the anchor, which the renderer draws over the building rather than behind its art. The
 * post may stay in the building's reserved margin: no later building's zone may overlap that one, so
 * nothing covers the post again. Spacing to the other posts is not re-checked, since the post moves and
 * nobody erects it. A post with no such node within {@link SIGNPOST_DISPLACE_RADIUS_NODES} falls. Project
 * rule, as the original never builds on a post.
 */
export function displaceSignpostsFromFootprint(world: World, ctx: SystemContext, building: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return;
  const anchor = nodeOfPosition(p.x, p.y);
  const covered = buildingFlagBodyNodes(ctx.content, terrain, b.buildingType, b.tribe, anchor.hx, anchor.hy);
  const footprint = buildingFootprintOf(ctx.content, b.buildingType, b.tribe);
  const door = doorNodeOf(terrain, footprint, anchor.hx, anchor.hy);
  if (door !== null) covered.add(door);
  const enclosed = [...world.query(Signpost, Position)].filter((e) =>
    covered.has(entityNode(world, terrain, e)),
  );
  if (enclosed.length === 0) return;
  const doors = buildingDoorNodes(world, ctx, terrain);
  // Canonical order, and each relocation lands before the next search, so two posts never share a node.
  for (const post of canonicalById(enclosed)) {
    const from = entityNode(world, terrain, post);
    const ground = terrain.componentOf(from);
    const standable = (n: NodeId): boolean => !doors.has(n) && terrain.componentOf(n) === ground;
    const neighbours = world.get(post, Signpost).links.map((e) => entityNode(world, terrain, e));
    const keepsLinks = (n: NodeId): boolean =>
      neighbours.every(
        (m) =>
          hexDistanceBetween(terrain.xOf(n), terrain.yOf(n), terrain.xOf(m), terrain.yOf(m)) <
          SIGNPOST_LINK_RANGE_NODES,
      );
    const search = (accept: (n: NodeId) => boolean): NodeId | null =>
      nearestWorkFlagPlacement(world, ctx, terrain, from, {
        accept,
        withinRadius: SIGNPOST_DISPLACE_RADIUS_NODES,
      });
    const inFront = (n: NodeId): boolean => terrain.yOf(n) > anchor.hy;
    const to =
      search((n) => standable(n) && keepsLinks(n) && inFront(n)) ??
      search((n) => standable(n) && keepsLinks(n)) ??
      search((n) => standable(n) && inFront(n)) ??
      search(standable);
    if (to === null) razeSignpost(world, post);
    else relocateSignpost(world, terrain, post, to, ctx.content);
  }
}

/** Stand `post` on `node` and re-link it there. The component is re-added rather than the Position written
 *  in place: the placement blocker caches replay Signpost membership and hold a post's cell fixed while it
 *  keeps the component. */
function relocateSignpost(
  world: World,
  terrain: TerrainGraph,
  post: Entity,
  node: NodeId,
  content: ContentSet,
): void {
  unlinkSignpost(world, post);
  world.remove(post, Signpost);
  const c = terrain.coordsOf(node);
  const pos = world.mut(post, Position);
  const centre = positionOfNode(c.x, c.y);
  pos.x = centre.x;
  pos.y = centre.y;
  world.add(post, Signpost, { links: [] });
  settleSignpostLinks(world, terrain, post, content);
}
