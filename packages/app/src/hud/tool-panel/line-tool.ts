import { halfCellToScreen, palisadeStaggerX, TILE_HALF_H, TILE_HALF_W } from '@open-northland/render';
import { hexDistanceBetween, hexNeighboursOf } from '@open-northland/sim';

/** A half-cell node on the sim lattice. */
export interface LineNode {
  readonly col: number;
  readonly row: number;
}

/** `open` takes a new piece, `built` already has one the line passes through, and `blocked` marks the
 *  first refused node and everything after it: a commit stops before it. */
export type LineNodeState = 'open' | 'built' | 'blocked';

export interface LinePreviewNode extends LineNode {
  readonly state: LineNodeState;
}

/** A set of nodes the placement wash leaves bright; `key` changes whenever the set does. */
export interface LitNodes {
  readonly key: string;
  has(col: number, row: number): boolean;
}

/** The nodes a started line can end on, each keyed `col,row` with the fewest steps a line takes there. */
export interface LineReach extends LitNodes {
  readonly steps: ReadonlyMap<string, number>;
}

/** The started line the reach overlay washes around. */
export interface ActiveLine {
  readonly anchor: LineNode;
  /** Walked once per anchor and `answersKey`: the frame loop reads it every frame. */
  reach(): LineReach;
}

/** Two candidate steps this close to the drawn segment count as equally near it. */
const TIE_PX = 1e-6;

/**
 * The line from `start` toward `end` as it looks on screen, at most `maxEdges` steps: each step takes the
 * hex neighbour that advances along the segment and strays least from it. A line flatter than the hex
 * diagonal is measured where its walls draw, on the staggered rows; a steeper one on the lattice without a
 * sideways step, so it runs as straight columns joined by slants. A cube-coordinate line would zigzag
 * across a column the screen shows straight.
 */
export function screenLine(start: LineNode, end: LineNode, maxEdges: number): LineNode[] {
  const origin = halfCellToScreen(start.col, start.row);
  const target = halfCellToScreen(end.col, end.row);
  // The hex diagonal crosses one column per two rows.
  const steep = Math.abs(target.x - origin.x) * TILE_HALF_H < Math.abs(target.y - origin.y) * TILE_HALF_W;
  const at = (col: number, row: number): { x: number; y: number } => {
    const p = halfCellToScreen(col, row);
    return steep ? p : { x: p.x + palisadeStaggerX(row), y: p.y };
  };
  const from = at(start.col, start.row);
  const to = at(end.col, end.row);
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const length = Math.hypot(vx, vy);
  const nodes: LineNode[] = [{ col: start.col, row: start.row }];
  if (length === 0) return nodes;
  let node = start;
  let along = 0;
  while (nodes.length <= maxEdges && (node.col !== end.col || node.row !== end.row)) {
    let best: { node: LineNode; along: number; off: number } | null = null;
    for (const next of hexNeighboursOf(node.col, node.row)) {
      if (steep && next.hy === node.row) continue;
      const p = at(next.hx, next.hy);
      const nextAlong = ((p.x - from.x) * vx + (p.y - from.y) * vy) / length;
      if (nextAlong <= along) continue;
      const off = Math.abs((p.x - from.x) * vy - (p.y - from.y) * vx) / length;
      if (best === null || off < best.off - TIE_PX || (off <= best.off + TIE_PX && nextAlong > best.along)) {
        best = { node: { col: next.hx, row: next.hy }, along: nextAlong, off };
      }
    }
    if (best === null || best.along > length + TIE_PX) break;
    node = best.node;
    along = best.along;
    nodes.push(node);
  }
  return nodes;
}

type Step = (node: LineNode) => LineNode;

const oddRow = (row: number): boolean => (row & 1) === 1;

/** The eight straight runs a held Shift keeps a line to: along a row, down a column and the four hex
 *  diagonals, whose steps alternate with the row parity. */
const STRAIGHT_STEPS: readonly Step[] = [
  (n) => ({ col: n.col + 1, row: n.row }),
  (n) => ({ col: n.col - 1, row: n.row }),
  (n) => ({ col: n.col, row: n.row - 1 }),
  (n) => ({ col: n.col, row: n.row + 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col + 1 : n.col, row: n.row - 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col : n.col - 1, row: n.row - 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col + 1 : n.col, row: n.row + 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col : n.col - 1, row: n.row + 1 }),
];

/** The straight run from `start` whose screen direction lies nearest the cursor, reaching as far along it
 *  as the cursor does and at most `maxEdges` steps. */
export function straightLine(start: LineNode, cursor: LineNode, maxEdges: number): LineNode[] {
  const from = halfCellToScreen(start.col, start.row);
  const to = halfCellToScreen(cursor.col, cursor.row);
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const reach = Math.hypot(vx, vy);
  const nodes: LineNode[] = [{ col: start.col, row: start.row }];
  if (reach === 0) return nodes;
  let best: Step | undefined;
  let bestCos = -Infinity;
  let edges = 0;
  for (const step of STRAIGHT_STEPS) {
    // Two steps average out a diagonal's alternating stride.
    const twoSteps = step(step(start));
    const two = halfCellToScreen(twoSteps.col, twoSteps.row);
    const dx = (two.x - from.x) / 2;
    const dy = (two.y - from.y) / 2;
    const stride = Math.hypot(dx, dy);
    const cos = (vx * dx + vy * dy) / (reach * stride);
    if (cos > bestCos) {
      bestCos = cos;
      best = step;
      edges = Math.round((reach * cos) / stride);
    }
  }
  if (best === undefined) return nodes;
  for (let i = 0; i < Math.min(maxEdges, Math.max(0, edges)); i++) {
    const last = nodes[nodes.length - 1] ?? start;
    nodes.push(best(last));
  }
  return nodes;
}

/** Marks the accepted prefix of a line; every node after the first rejection is blocked too. */
function markPrefix(
  nodes: readonly LineNode[],
  stateOf: (node: LineNode) => LineNodeState,
): LinePreviewNode[] {
  let refused = false;
  return nodes.map((node) => {
    const state = refused ? 'blocked' : stateOf(node);
    refused = state === 'blocked';
    return { col: node.col, row: node.row, state };
  });
}

const nodeKey = (col: number, row: number): string => `${col},${row}`;

/**
 * The nodes a started line can end on, each with the fewest steps a line of accepted nodes takes there
 * from the anchor: a breadth-first walk over the hex neighbours, so a line bends around what refuses it.
 * The walk stays within `maxEdges` steps, so its cost is the reach radius's area, not the map's.
 */
export function lineReach(
  anchor: LineNode,
  maxEdges: number,
  accepts: (col: number, row: number) => boolean,
): ReadonlyMap<string, number> {
  const steps = new Map<string, number>();
  if (!accepts(anchor.col, anchor.row)) return steps;
  steps.set(nodeKey(anchor.col, anchor.row), 0);
  const refused = new Set<string>();
  let ring: LineNode[] = [anchor];
  for (let step = 1; step <= maxEdges && ring.length > 0; step++) {
    const next: LineNode[] = [];
    for (const node of ring) {
      for (const { hx, hy } of hexNeighboursOf(node.col, node.row)) {
        const key = nodeKey(hx, hy);
        if (steps.has(key) || refused.has(key)) continue;
        if (!accepts(hx, hy)) {
          refused.add(key);
          continue;
        }
        steps.set(key, step);
        next.push({ col: hx, row: hy });
      }
    }
    ring = next;
  }
  return steps;
}

/** Squared screen distance from `p` to the segment `a`-`b`. */
function segmentDistanceSq(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSq));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return dx * dx + dy * dy;
}

/**
 * A shortest line from the anchor of `reach` to `end` over its accepted nodes, or null when `end` is out of
 * reach. Among the equally short lines it keeps each step nearest the drawn segment, so it hugs an
 * obstacle instead of swinging wide of it.
 */
export function routedLine(
  anchor: LineNode,
  end: LineNode,
  reach: ReadonlyMap<string, number>,
): LineNode[] | null {
  let steps = reach.get(nodeKey(end.col, end.row));
  if (steps === undefined) return null;
  const from = halfCellToScreen(anchor.col, anchor.row);
  const to = halfCellToScreen(end.col, end.row);
  const nodes: LineNode[] = [{ col: end.col, row: end.row }];
  let node: LineNode = end;
  while (steps > 0) {
    let best: LineNode | null = null;
    let bestOff = Infinity;
    for (const { hx, hy } of hexNeighboursOf(node.col, node.row)) {
      if (reach.get(nodeKey(hx, hy)) !== steps - 1) continue;
      const off = segmentDistanceSq(halfCellToScreen(hx, hy), from, to);
      if (off < bestOff - TIE_PX) {
        best = { col: hx, row: hy };
        bestOff = off;
      }
    }
    // A breadth-first step count always has a predecessor one step nearer the anchor.
    if (best === null) return null;
    nodes.push(best);
    node = best;
    steps--;
  }
  return nodes.reverse();
}

export interface LineToolSpec {
  /** Names the probe behind `canPlace`, so a memo never serves one tool's reach to another. */
  readonly tool: string;
  readonly maxEdges: number;
  readonly canPlace: (node: LineNode) => boolean;
  /** A node that already holds a piece: a line may start, pass or end there without laying another. */
  readonly built?: (node: LineNode) => boolean;
  /** Changes whenever `canPlace` or `built` may answer differently. */
  readonly answersKey: () => string;
  /** Lays the open nodes of a confirmed line's accepted prefix; never called with none. */
  readonly commit: (nodes: readonly LineNode[]) => void;
}

/**
 * A two-click line placement: a click on an open or built node starts the line, the pointer moves its end,
 * and a second left click lays the accepted prefix and waits for the next start, or with `chain` starts
 * the next line where the laid one ends. `stepBack` drops a started line, which the right button and Esc
 * reach first.
 */
export interface LineTool {
  anchor(): LineNode | null;
  /** The cursor's marker before a line starts, the capped line toward the cursor after. A refused node on
   *  the way bends the line around it when a free line within the budget exists; `straight` keeps it to
   *  the nearest of the eight straight runs instead. */
  preview(tile: LineNode, straight?: boolean): LinePreviewNode[];
  /** True when the press laid a line. */
  click(tile: LineNode | null, opts?: LineClick): boolean;
  stepBack(): boolean;
  active(): ActiveLine | null;
  /** The nodes a first click starts a line on, for the wash before a line starts. */
  starts(): LitNodes;
}

export interface LineClick {
  /** Keeps the line to the nearest straight run, as in `preview`. */
  readonly straight?: boolean;
  /** Starts the next line at the laid line's last accepted node. */
  readonly chain?: boolean;
}

export function createLineTool(spec: LineToolSpec): LineTool {
  let line: ActiveLine | null = null;
  // A chained line's anchor, just committed: built before the commit lands, never laid twice.
  let laid: LineNode | null = null;
  const stateOf = (node: LineNode): LineNodeState =>
    (laid?.col === node.col && laid.row === node.row) || spec.built?.(node) === true
      ? 'built'
      : spec.canPlace(node)
        ? 'open'
        : 'blocked';
  const accepts = (col: number, row: number): boolean => stateOf({ col, row }) !== 'blocked';
  let starts: LitNodes = { key: '', has: accepts };
  const startAt = (node: LineNode): ActiveLine => {
    const anchor = { col: node.col, row: node.row };
    let walked: LineReach = { key: '', steps: new Map(), has: () => false };
    return {
      anchor,
      reach: () => {
        const key = `${spec.tool}:${anchor.col},${anchor.row}:${spec.answersKey()}`;
        if (key !== walked.key) {
          const steps = lineReach(anchor, spec.maxEdges, accepts);
          walked = { key, steps, has: (col, row) => steps.has(nodeKey(col, row)) };
        }
        return walked;
      },
    };
  };
  const route = (from: LineNode, tile: LineNode, straight: boolean): LinePreviewNode[] => {
    if (straight) return markPrefix(straightLine(from, tile, spec.maxEdges), stateOf);
    const direct = markPrefix(screenLine(from, tile, spec.maxEdges), stateOf);
    const last = direct.at(-1);
    const clear = last?.col === tile.col && last.row === tile.row && last.state !== 'blocked';
    // No line of accepted nodes is shorter than the hex distance, so a farther end keeps the refused line.
    if (
      clear ||
      line === null ||
      hexDistanceBetween(from.col, from.row, tile.col, tile.row) > spec.maxEdges
    ) {
      return direct;
    }
    const around = routedLine(from, tile, line.reach().steps);
    return around === null ? direct : around.map((node) => ({ ...node, state: stateOf(node) }));
  };
  return {
    anchor: () => line?.anchor ?? null,
    preview: (tile, straight = false) => route(line?.anchor ?? tile, tile, straight),
    click: (tile, { straight = false, chain = false } = {}): boolean => {
      if (tile === null) return false;
      if (line === null) {
        if (stateOf(tile) !== 'blocked') line = startAt(tile);
        return false;
      }
      const path = route(line.anchor, tile, straight);
      const placed = path.filter((node) => node.state === 'open');
      // The accepted prefix is laid, so the next line picks up at its last node.
      const end = path.filter((node) => node.state !== 'blocked').at(-1);
      line = null;
      laid = null;
      if (placed.length === 0) return false;
      spec.commit(placed.map(({ col, row }) => ({ col, row })));
      if (chain && end !== undefined) {
        line = startAt(end);
        laid = end;
      }
      return true;
    },
    stepBack: (): boolean => {
      if (line === null) return false;
      line = null;
      laid = null;
      return true;
    },
    active: () => line,
    starts: () => {
      const key = `${spec.tool}:start:${spec.answersKey()}`;
      if (key !== starts.key) starts = { key, has: accepts };
      return starts;
    },
  };
}
