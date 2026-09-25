import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  type Fixed,
  hexNeighboursOf,
  nodeOfPosition,
  positionOfNode,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ONE, tileToScreen } from '../projection/index.js';
import type { ElevationField } from '../terrain/index.js';
import { terrainLiftAt } from '../terrain/index.js';
import type { PalisadePostDraw } from './draw-item.js';
import { palisadeStaggerX, staggeredNodeKeys, type WallNode, wallNodeKey } from './palisade-stagger.js';
import { readPosition } from './snapshot-readers/index.js';
import { readPalisadeStatePct } from './snapshot-readers/static-readers.js';

/** One repeated post between two neighbouring palisade anchors, relative to the first anchor. */
export interface PalisadePostOffset {
  readonly dx: number;
  readonly dy: number;
}

/**
 * The largest centre-to-centre gap between repeated wall posts on the current half-cell projection.
 * The original wall draw inserts posts at one-third and two-thirds of a neighbouring edge; with the
 * recovered 68×38 px lattice its longest third is just under 13 px.
 */
export const PALISADE_POST_SPACING_PX = 13;

/**
 * Fill the open edge between two neighbouring palisade anchors with the original's two one-third
 * posts. Endpoints stay owned by their entities, so removing either endpoint also removes every
 * repeated post on that edge. Draw-space coordinates include terrain lift before they reach this
 * helper, which makes a joined edge follow a slope rather than floating at one endpoint's height.
 */
export function palisadePostOffsets(dx: number, dy: number): PalisadePostOffset[] {
  if (dx === 0 && dy === 0) return [];
  return [
    { dx: dx / 3, dy: dy / 3 },
    { dx: (dx * 2) / 3, dy: (dy * 2) / 3 },
  ];
}

interface PalisadeNode {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
  readonly gfxIndex: number;
  readonly builtPct: number | undefined;
}

interface GateNode {
  readonly ref: number;
  readonly hx: number;
  readonly hy: number;
  readonly walk: readonly FootprintCell[];
  readonly builtPct: number | undefined;
}

/** How snapshot palisades draw beyond their own anchor sprite. */
export interface PalisadeLayout {
  /** Posts inserted on every palisade edge, keyed by the one endpoint that owns that edge's draw. */
  readonly posts: ReadonlyMap<number, readonly PalisadePostDraw[]>;
  /** Screen px a staggered palisade draws beside its node, by entity id. */
  readonly shiftX: ReadonlyMap<number, number>;
}

const EMPTY_LAYOUT: PalisadeLayout = { posts: new Map(), shiftX: new Map() };

interface CachedLayout {
  readonly flat?: PalisadeLayout;
  readonly elevated: WeakMap<ElevationField, PalisadeLayout>;
}

const layoutBySnapshot = new WeakMap<WorldSnapshot, CachedLayout>();

/**
 * Join snapshot palisades on the six-node landscape lattice. An edge is emitted once, from its lower
 * entity id, regardless of snapshot order, and each of its two posts rides the draw of the endpoint it
 * stands nearer. A post then sorts within a third of an edge of its own place, so in a wall two posts
 * thick no row paints over a post standing in front of it. Deleting either endpoint makes the join
 * disappear on the next snapshot. The inserted posts use the lower id's art variant and the construction
 * state interpolated between the endpoints. Walls, sites and gates draw staggered where that keeps lines
 * straight ({@link staggeredNodeKeys}), and the posts between them follow.
 */
export function palisadeLayoutOf(snapshot: WorldSnapshot, elevation?: ElevationField): PalisadeLayout {
  const cached = layoutBySnapshot.get(snapshot);
  const hit = elevation === undefined ? cached?.flat : cached?.elevated.get(elevation);
  if (hit !== undefined) return hit;
  const built = buildPalisadeLayout(snapshot, elevation);
  if (cached === undefined) {
    layoutBySnapshot.set(snapshot, {
      ...(elevation === undefined ? { flat: built } : {}),
      elevated: new WeakMap(elevation === undefined ? [] : [[elevation, built]]),
    });
  } else if (elevation === undefined) {
    layoutBySnapshot.set(snapshot, { flat: built, elevated: cached.elevated });
  } else cached.elevated.set(elevation, built);
  return built;
}

function buildPalisadeLayout(snapshot: WorldSnapshot, elevation: ElevationField | undefined): PalisadeLayout {
  const byNode = new Map<string, PalisadeNode>();
  const nodes: PalisadeNode[] = [];
  const gates: GateNode[] = [];
  // Every wall and wall site by node, and the refs drawn there, for the stagger.
  const layoutNodes = new Map<string, WallNode>();
  const refsByNode = new Map<string, number>();
  for (const entity of snapshot.entities) {
    const component = entity.components.Palisade as
      | { gfxIndex?: unknown; gate?: unknown; walk?: unknown }
      | undefined;
    if (component === undefined || typeof component.gfxIndex !== 'number') continue;
    const position = readPosition(entity.components);
    if (position === null) continue;
    const node = nodeOfPosition(position.x as Fixed, position.y as Fixed);
    const key = wallNodeKey(node.hx, node.hy);
    // Construction sites are ground markers until completed; they neither draw a post nor connect
    // completed neighbours across their anchor, but stagger with the line they stand in.
    if ('UnderConstruction' in entity.components && !('PalisadeBlocking' in entity.components)) {
      layoutNodes.set(key, node);
      refsByNode.set(key, entity.id);
      continue;
    }
    if (component.gate !== undefined && component.gate !== null) {
      const walk = footprintCells(component.walk);
      if (walk.length > 1) {
        gates.push({
          ref: entity.id,
          hx: node.hx,
          hy: node.hy,
          walk,
          builtPct: readPalisadeStatePct(entity.components),
        });
      }
      continue;
    }
    const post: PalisadeNode = {
      ref: entity.id,
      x: position.x,
      y: position.y,
      gfxIndex: component.gfxIndex,
      builtPct: readPalisadeStatePct(entity.components),
    };
    byNode.set(key, post);
    nodes.push(post);
    layoutNodes.set(key, node);
    refsByNode.set(key, entity.id);
  }
  if (layoutNodes.size === 0 && gates.length === 0) return EMPTY_LAYOUT;

  const shiftX = new Map<number, number>();
  const terminals = new Set<string>();
  for (const gate of gates) {
    shiftX.set(gate.ref, palisadeStaggerX(gate.hy));
    for (const end of gateEndpoints(gate)) terminals.add(wallNodeKey(end.hx, end.hy));
  }
  // A gate leaves its span's outer posts standing on its terminals; they stagger with it.
  for (const key of [...staggeredNodeKeys(layoutNodes, terminals), ...terminals]) {
    const ref = refsByNode.get(key);
    const node = layoutNodes.get(key);
    if (ref !== undefined && node !== undefined) shiftX.set(ref, palisadeStaggerX(node.hy));
  }
  const shiftOf = (hx: number, hy: number): number => {
    const key = wallNodeKey(hx, hy);
    if (terminals.has(key)) return palisadeStaggerX(hy);
    const ref = refsByNode.get(key);
    return ref === undefined ? 0 : (shiftX.get(ref) ?? 0);
  };

  const posts = new Map<number, PalisadePostDraw[]>();
  for (const from of nodes) {
    const fromNode = nodeOfPosition(from.x as Fixed, from.y as Fixed);
    const fromTileX = from.x / ONE;
    const fromTileY = from.y / ONE;
    const fromScreen = tileToScreen(fromTileX, fromTileY);
    const fromDrawX = fromScreen.x + shiftOf(fromNode.hx, fromNode.hy);
    const fromDrawY = fromScreen.y - terrainLiftAt(elevation, fromTileX, fromTileY);
    for (const neighbour of hexNeighboursOf(fromNode.hx, fromNode.hy)) {
      const to = byNode.get(wallNodeKey(neighbour.hx, neighbour.hy));
      if (to === undefined || from.ref >= to.ref) continue;
      const toTileX = to.x / ONE;
      const toTileY = to.y / ONE;
      const toScreen = tileToScreen(toTileX, toTileY);
      appendEdgePosts(
        posts,
        from,
        toScreen.x + shiftOf(neighbour.hx, neighbour.hy) - fromDrawX,
        toScreen.y - terrainLiftAt(elevation, toTileX, toTileY) - fromDrawY,
        to.builtPct,
        to,
      );
    }
  }

  // A gate sprite owns the leaf and its two terminal posts. Join only the ordinary wall immediately
  // outside each terminal to that terminal; drawing toward the gate anchor would fill the passage.
  for (const gate of gates) {
    for (const endpoint of gateEndpoints(gate)) {
      const outside = outsideNeighbour(gate, endpoint);
      if (outside === null) continue;
      const wall = byNode.get(wallNodeKey(outside.hx, outside.hy));
      if (wall === undefined) continue;
      const wallTileX = wall.x / ONE;
      const wallTileY = wall.y / ONE;
      const wallScreen = tileToScreen(wallTileX, wallTileY);
      const wallDrawY = wallScreen.y - terrainLiftAt(elevation, wallTileX, wallTileY);
      const endpointPosition = positionOfNode(endpoint.hx, endpoint.hy);
      const endpointTileX = endpointPosition.x / ONE;
      const endpointTileY = endpointPosition.y / ONE;
      const endpointScreen = tileToScreen(endpointTileX, endpointTileY);
      appendEdgePosts(
        posts,
        wall,
        endpointScreen.x +
          shiftOf(endpoint.hx, endpoint.hy) -
          (wallScreen.x + shiftOf(outside.hx, outside.hy)),
        endpointScreen.y - terrainLiftAt(elevation, endpointTileX, endpointTileY) - wallDrawY,
        gate.builtPct,
        null,
        true,
      );
    }
  }
  return { posts, shiftX };
}

function footprintCells(value: unknown): FootprintCell[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((cell) => {
    if (typeof cell !== 'object' || cell === null) return [];
    const record = cell as { dx?: unknown; dy?: unknown };
    return typeof record.dx === 'number' && typeof record.dy === 'number'
      ? [{ dx: record.dx, dy: record.dy }]
      : [];
  });
}

function gateEndpoints(gate: GateNode): Array<{ hx: number; hy: number }> {
  const cells = gate.walk.map((cell) => ({
    hx: gate.hx + footprintCellDx(gate.hy, cell),
    hy: gate.hy + cell.dy,
  }));
  let pair: [{ hx: number; hy: number }, { hx: number; hy: number }] | null = null;
  let span = -1;
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j];
      if (b === undefined) continue;
      const dx = b.hx - a.hx;
      const dy = b.hy - a.hy;
      const candidate = dx * dx + dy * dy;
      if (candidate > span) {
        span = candidate;
        pair = [a, b];
      }
    }
  }
  return pair ?? [];
}

function outsideNeighbour(
  gate: GateNode,
  endpoint: { readonly hx: number; readonly hy: number },
): { hx: number; hy: number } | null {
  const outwardX = endpoint.hx - gate.hx;
  const outwardY = endpoint.hy - gate.hy;
  let best: { hx: number; hy: number } | null = null;
  let bestDot = 0;
  for (const candidate of hexNeighboursOf(endpoint.hx, endpoint.hy)) {
    const dot = (candidate.hx - endpoint.hx) * outwardX + (candidate.hy - endpoint.hy) * outwardY;
    if (dot > bestDot) {
      best = candidate;
      bestDot = dot;
    }
  }
  return best;
}

/** Emit an edge's posts. With a `far` endpoint the post nearer it rides its draw, offset from its own
 *  anchor; a gate's collar edge has none, so every post stays with the wall. */
function appendEdgePosts(
  posts: Map<number, PalisadePostDraw[]>,
  from: PalisadeNode,
  dx: number,
  dy: number,
  toBuiltPct: number | undefined,
  far: PalisadeNode | null,
  includeEndpoint = false,
): void {
  const fromProgress = from.builtPct ?? 100;
  const toProgress = toBuiltPct ?? 100;
  const offsets = palisadePostOffsets(dx, dy);
  // Gate art has transparent margin outside its terminal posts. An ordinary source wall post at the
  // exact terminal overlaps that margin and closes the collar while leaving the leaf opening untouched.
  if (includeEndpoint) offsets.push({ dx, dy });
  offsets.forEach((offset, index) => {
    const fraction = (index + 1) / 3;
    const progress = Math.floor(fromProgress + (toProgress - fromProgress) * fraction);
    const nearFar = far !== null && fraction > 1 / 2;
    const post: PalisadePostDraw = {
      dx: nearFar ? offset.dx - dx : offset.dx,
      dy: nearFar ? offset.dy - dy : offset.dy,
      gfxIndex: from.gfxIndex,
      variantStep: index + 1,
      ...(progress < 100 ? { builtPct: progress } : {}),
    };
    const owner = nearFar ? far.ref : from.ref;
    const existing = posts.get(owner);
    if (existing === undefined) posts.set(owner, [post]);
    else existing.push(post);
  });
}
