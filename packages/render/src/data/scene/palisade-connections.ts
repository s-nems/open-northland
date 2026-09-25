import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  type EntitySnapshot,
  type Fixed,
  hexNeighboursOf,
  nodeOfPosition,
  positionOfNode,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ONE, tileToScreen } from '../projection/index.js';
import type { ElevationField } from '../terrain/index.js';
import { terrainLiftAt } from '../terrain/index.js';
import type { PalisadePostDraw, StaticDrawFields } from './draw-item.js';
import { palisadeStaggerX, staggeredNodeKeys, type WallNode, wallNodeKey } from './palisade-stagger.js';
import { palisadesOf } from './snapshot-index.js';
import {
  assignStaticFields,
  readPalisadeClaimed,
  readPalisadeStatePct,
  readPosition,
} from './snapshot-readers/index.js';

/** One repeated post between two neighbouring palisade anchors, relative to the first anchor. */
export interface PalisadePostOffset {
  readonly dx: number;
  readonly dy: number;
}

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
  /** Edge posts by the entity that draws them: the edge end each post stands nearer, or for a gate's
   *  collar the wall outside its terminal. */
  readonly posts: ReadonlyMap<number, readonly PalisadePostDraw[]>;
  /** Screen px a staggered palisade draws beside its node, by entity id. */
  readonly shiftX: ReadonlyMap<number, number>;
  /** Every wall and wall site by {@link wallNodeKey}, and the nodes the gates end on. */
  readonly walls: ReadonlyMap<string, WallNode>;
  readonly terminals: ReadonlySet<string>;
  /** Screen px drawn beside the node, by {@link wallNodeKey}, for every node of `walls` and `terminals`. */
  readonly nodeShiftX: ReadonlyMap<string, number>;
}

const EMPTY_LAYOUT: PalisadeLayout = {
  posts: new Map(),
  shiftX: new Map(),
  walls: new Map(),
  terminals: new Set(),
  nodeShiftX: new Map(),
};

/** The last layout built for one elevation, and the latest palisade list found equal to the one it was
 *  built from, so later frames of the same snapshot match by identity. */
interface BuiltLayout {
  palisades: readonly EntitySnapshot[];
  readonly layout: PalisadeLayout;
}

let lastFlat: BuiltLayout | undefined;
const lastByElevation = new WeakMap<ElevationField, BuiltLayout>();

/**
 * Join snapshot palisades on the six-node landscape lattice. An edge is emitted once, from its lower
 * entity id, regardless of snapshot order, and each of its two posts rides the draw of the endpoint it
 * stands nearer. A post then sorts within a third of an edge of its own place, so in a wall two posts
 * thick no row paints over a post standing in front of it. Deleting either endpoint makes the join
 * disappear on the next snapshot. The inserted posts use the lower id's art variant and the construction
 * state interpolated between the endpoints. Walls, sites and gates draw staggered where that keeps lines
 * straight ({@link staggeredNodeKeys}), and the posts between them follow.
 *
 * An untouched entity keeps its snapshot object, so while every palisade entity is the one the last
 * layout was built from, that layout object is returned again.
 */
export function palisadeLayoutOf(snapshot: WorldSnapshot, elevation?: ElevationField): PalisadeLayout {
  const palisades = palisadesOf(snapshot);
  const last = elevation === undefined ? lastFlat : lastByElevation.get(elevation);
  if (last !== undefined && sameEntities(last.palisades, palisades)) {
    last.palisades = palisades;
    return last.layout;
  }
  const built: BuiltLayout = { palisades, layout: buildPalisadeLayout(palisades, elevation) };
  if (elevation === undefined) lastFlat = built;
  else lastByElevation.set(elevation, built);
  return built.layout;
}

function sameEntities(a: readonly EntitySnapshot[], b: readonly EntitySnapshot[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function buildPalisadeLayout(
  palisades: readonly EntitySnapshot[],
  elevation: ElevationField | undefined,
): PalisadeLayout {
  const byNode = new Map<string, PalisadeNode>();
  const nodes: PalisadeNode[] = [];
  const gates: GateNode[] = [];
  // Every wall and wall site by node, and the refs drawn there, for the stagger.
  const layoutNodes = new Map<string, WallNode>();
  const refsByNode = new Map<string, number>();
  for (const entity of palisades) {
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
    if ('UnderConstruction' in entity.components) {
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
  const terminals = new Map<string, WallNode>();
  for (const gate of gates) {
    shiftX.set(gate.ref, palisadeStaggerX(gate.hy));
    for (const end of gateEndpoints(gate)) terminals.set(wallNodeKey(end.hx, end.hy), end);
  }
  const nodeShiftX = new Map<string, number>();
  for (const key of layoutNodes.keys()) nodeShiftX.set(key, 0);
  const terminalKeys = new Set(terminals.keys());
  const staggered = staggeredNodeKeys(layoutNodes, terminalKeys);
  // A gate leaves its span's outer posts standing on its terminals; they stagger with it.
  for (const [key, node] of [...layoutNodes, ...terminals]) {
    if (!staggered.has(key) && !terminalKeys.has(key)) continue;
    nodeShiftX.set(key, palisadeStaggerX(node.hy));
    const ref = refsByNode.get(key);
    if (ref !== undefined) shiftX.set(ref, palisadeStaggerX(node.hy));
  }
  const shiftOf = (hx: number, hy: number): number => nodeShiftX.get(wallNodeKey(hx, hy)) ?? 0;

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
  // outside each terminal to that terminal; drawing toward the gate anchor would fill the passage. A wall
  // still standing on the terminal already joins its neighbours, so it needs no collar.
  for (const gate of gates) {
    for (const endpoint of gateEndpoints(gate)) {
      if (byNode.has(wallNodeKey(endpoint.hx, endpoint.hy))) continue;
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
  return { posts, shiftX, walls: layoutNodes, terminals: terminalKeys, nodeShiftX };
}

/**
 * Assign what a palisade draws by onto `target`, a live draw item or a fog ghost, and return the screen
 * px it draws beside its node.
 */
export function assignPalisadeFields(
  target: StaticDrawFields,
  ref: number,
  components: Readonly<Record<string, unknown>>,
  layout: PalisadeLayout,
): number {
  assignStaticFields(target, 'palisade', components);
  if ('UnderConstruction' in components) {
    // The wood set down on the flag goes into the wall, so the flag alone stands until the strike raises
    // the segment.
    target.palisadeSite = readPalisadeClaimed(components) ? 'claimed' : 'unclaimed';
  } else {
    const posts = layout.posts.get(ref);
    if (posts !== undefined && posts.length > 0) target.palisadePosts = posts;
  }
  return layout.shiftX.get(ref) ?? 0;
}

/**
 * Screen px each node of a planned wall line draws beside its node once laid among `layout`'s walls, so
 * the plan stands where its walls will. A node already standing keeps the shift it draws with now. The
 * stagger reads a node's joints and its column partner's, so walls two steps off the plan decide it.
 */
export function planShiftX(plan: readonly WallNode[], layout: PalisadeLayout = EMPTY_LAYOUT): number[] {
  const walls = new Map<string, WallNode>();
  for (const node of plan) walls.set(wallNodeKey(node.hx, node.hy), node);
  if (layout.walls.size > 0 || layout.terminals.size > 0) {
    for (const node of plan) {
      for (const near of hexNeighboursOf(node.hx, node.hy)) {
        for (const far of [near, ...hexNeighboursOf(near.hx, near.hy)]) {
          const key = wallNodeKey(far.hx, far.hy);
          const standing = layout.walls.get(key);
          if (standing !== undefined) walls.set(key, standing);
        }
      }
    }
  }
  const staggered = staggeredNodeKeys(walls, layout.terminals);
  return plan.map((node) => {
    const key = wallNodeKey(node.hx, node.hy);
    return layout.nodeShiftX.get(key) ?? (staggered.has(key) ? palisadeStaggerX(node.hy) : 0);
  });
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
