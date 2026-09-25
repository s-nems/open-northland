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

/** The started line the reach overlay washes around: every node a straight line from `anchor` of at
 *  most `maxEdges` steps reaches through accepted (open or built) nodes only. */
export interface ActiveLine {
  /** Names the probe behind `accepts`, so a memo never serves one tool's reach to another. */
  readonly tool: string;
  readonly anchor: LineNode;
  readonly maxEdges: number;
  readonly accepts: (col: number, row: number) => boolean;
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

/** Every line a started line can draw from `anchor`, walked once: only the anchor and the edge budget
 *  shape them, so a world change re-probes the nodes without walking the lines again. */
export interface LineFan {
  readonly anchor: LineNode;
  readonly maxEdges: number;
  /** The distinct nodes the lines pass; the anchor is the first. */
  readonly nodes: readonly LineNode[];
  /** Each end a line reaches exactly, with its nodes as indexes into `nodes`. */
  readonly lines: readonly { readonly end: string; readonly path: readonly number[] }[];
}

export function lineFan(anchor: LineNode, maxEdges: number): LineFan {
  const nodes: LineNode[] = [];
  const indexOf = new Map<string, number>();
  const index = (node: LineNode): number => {
    const key = `${node.col},${node.row}`;
    let at = indexOf.get(key);
    if (at === undefined) {
      at = nodes.length;
      nodes.push({ col: node.col, row: node.row });
      indexOf.set(key, at);
    }
    return at;
  };
  index(anchor);
  const lines: { end: string; path: number[] }[] = [];
  // Half-cell rows step one hex row each, and a row holds at most `maxEdges` steps either way.
  for (let row = anchor.row - maxEdges; row <= anchor.row + maxEdges; row++) {
    for (let col = anchor.col - maxEdges; col <= anchor.col + maxEdges; col++) {
      if (hexDistanceBetween(anchor.col, anchor.row, col, row) > maxEdges) continue;
      const path = screenLine(anchor, { col, row }, maxEdges);
      const last = path[path.length - 1];
      if (last?.col === col && last.row === row) lines.push({ end: `${col},${row}`, path: path.map(index) });
    }
  }
  return { anchor: { col: anchor.col, row: anchor.row }, maxEdges, nodes, lines };
}

const UNPROBED = 0;
const ACCEPTED = 1;
const REFUSED = 2;

/**
 * The nodes a started line can end on: those whose whole line from the anchor is accepted. Each node the
 * fan passes is probed at most once, so the cost is the reach radius's area, not area times line length.
 * `fan` must be the one of `line`'s anchor and budget.
 */
export function lineReach(
  line: ActiveLine,
  fan: LineFan = lineFan(line.anchor, line.maxEdges),
): ReadonlySet<string> {
  const verdicts = new Uint8Array(fan.nodes.length);
  const accepted = (at: number): boolean => {
    let verdict = verdicts[at] ?? UNPROBED;
    if (verdict === UNPROBED) {
      const node = fan.nodes[at];
      verdict = node !== undefined && line.accepts(node.col, node.row) ? ACCEPTED : REFUSED;
      verdicts[at] = verdict;
    }
    return verdict === ACCEPTED;
  };
  const reach = new Set<string>();
  if (!accepted(0)) return reach;
  for (const { end, path } of fan.lines) if (path.every(accepted)) reach.add(end);
  return reach;
}

export interface LineToolSpec {
  readonly tool: string;
  readonly maxEdges: number;
  readonly canPlace: (node: LineNode) => boolean;
  /** A node that already holds a piece: a line may start, pass or end there without laying another. */
  readonly built?: (node: LineNode) => boolean;
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
  /** The cursor's marker before a line starts, the capped line toward the cursor after; `straight`
   *  keeps it to the nearest of the eight straight runs. */
  preview(tile: LineNode, straight?: boolean): LinePreviewNode[];
  /** True when the press laid a line. */
  click(tile: LineNode | null, opts?: LineClick): boolean;
  stepBack(): boolean;
  active(): ActiveLine | null;
}

export interface LineClick {
  /** Keeps the line to the nearest straight run, as in `preview`. */
  readonly straight?: boolean;
  /** Starts the next line at the laid line's last accepted node. */
  readonly chain?: boolean;
}

export function createLineTool(spec: LineToolSpec): LineTool {
  // Built once per started line: the frame loop reads it every frame.
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
  const startAt = (node: LineNode): ActiveLine => ({
    tool: spec.tool,
    anchor: { col: node.col, row: node.row },
    maxEdges: spec.maxEdges,
    accepts,
  });
  const route = (from: LineNode, tile: LineNode, straight: boolean): LinePreviewNode[] =>
    markPrefix((straight ? straightLine : screenLine)(from, tile, spec.maxEdges), stateOf);
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
  };
}
