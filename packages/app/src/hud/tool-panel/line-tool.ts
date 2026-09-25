import { halfCellToScreen } from '@open-northland/render';

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

/** The started line the reach overlay washes around: every node a straight run from `anchor` of at most
 *  `maxEdges` steps reaches through accepted (open or built) nodes only. */
export interface ActiveLine {
  /** Names the probe behind `accepts`, so a memo never serves one tool's reach to another. */
  readonly tool: string;
  readonly anchor: LineNode;
  readonly maxEdges: number;
  readonly accepts: (col: number, row: number) => boolean;
}

type Step = (node: LineNode) => LineNode;

const oddRow = (row: number): boolean => (row & 1) === 1;

/**
 * The eight straight runs a line may take: along a row, down a column, and the four hex diagonals, whose
 * steps alternate with the row parity. Rows and columns draw straight, a diagonal as a regular two-step
 * stair, and rows and diagonals hold a gate. A line at any other angle would mix steps and turn every few
 * posts. Project rule.
 */
const DIRECTIONS: readonly Step[] = [
  (n) => ({ col: n.col + 1, row: n.row }),
  (n) => ({ col: n.col - 1, row: n.row }),
  (n) => ({ col: n.col, row: n.row - 1 }),
  (n) => ({ col: n.col, row: n.row + 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col + 1 : n.col, row: n.row - 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col : n.col - 1, row: n.row - 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col + 1 : n.col, row: n.row + 1 }),
  (n) => ({ col: oddRow(n.row) ? n.col : n.col - 1, row: n.row + 1 }),
];

function walk(start: LineNode, step: Step, edges: number): LineNode[] {
  const nodes: LineNode[] = [{ col: start.col, row: start.row }];
  for (let i = 0; i < edges; i++) {
    const last = nodes[nodes.length - 1] ?? start;
    nodes.push(step(last));
  }
  return nodes;
}

/**
 * The straight line from `start` whose direction on screen lies nearest the cursor, as long as the
 * cursor's reach along it and at most `maxEdges` steps. Every step joins hex neighbours.
 */
export function straightLine(start: LineNode, cursor: LineNode, maxEdges: number): LineNode[] {
  const from = halfCellToScreen(start.col, start.row);
  const to = halfCellToScreen(cursor.col, cursor.row);
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const reach = Math.hypot(vx, vy);
  if (reach === 0) return [{ col: start.col, row: start.row }];
  let best: { step: Step; edges: number } | null = null;
  let bestCos = -Infinity;
  for (const step of DIRECTIONS) {
    // Two steps average out a diagonal's alternating stride.
    const two = step(step(start));
    const end = halfCellToScreen(two.col, two.row);
    const dx = (end.x - from.x) / 2;
    const dy = (end.y - from.y) / 2;
    const stride = Math.hypot(dx, dy);
    const cos = (vx * dx + vy * dy) / (reach * stride);
    if (cos > bestCos) {
      bestCos = cos;
      best = { step, edges: Math.round((reach * cos) / stride) };
    }
  }
  if (best === null) return [{ col: start.col, row: start.row }];
  return walk(start, best.step, Math.min(maxEdges, Math.max(0, best.edges)));
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

/** The nodes a started line can end on: every straight run from the anchor up to its first refused node. */
export function lineReach(line: ActiveLine): ReadonlySet<string> {
  const reach = new Set<string>();
  const { anchor, maxEdges, accepts } = line;
  if (!accepts(anchor.col, anchor.row)) return reach;
  reach.add(`${anchor.col},${anchor.row}`);
  for (const step of DIRECTIONS) {
    let node = anchor;
    for (let i = 0; i < maxEdges; i++) {
      node = step(node);
      if (!accepts(node.col, node.row)) break;
      reach.add(`${node.col},${node.row}`);
    }
  }
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
 * and a second left click lays the accepted prefix and leaves the tool armed for the next line.
 * `stepBack` drops a started line, which the right button and Esc reach first.
 */
export interface LineTool {
  anchor(): LineNode | null;
  /** The cursor's marker before a line starts, the capped line toward the cursor after. */
  preview(tile: LineNode): LinePreviewNode[];
  click(tile: LineNode | null): void;
  stepBack(): boolean;
  active(): ActiveLine | null;
}

export function createLineTool(spec: LineToolSpec): LineTool {
  // Built once per started line: the frame loop reads it every frame.
  let line: ActiveLine | null = null;
  const stateOf = (node: LineNode): LineNodeState =>
    spec.built?.(node) === true ? 'built' : spec.canPlace(node) ? 'open' : 'blocked';
  const accepts = (col: number, row: number): boolean => stateOf({ col, row }) !== 'blocked';
  const route = (from: LineNode, tile: LineNode): LinePreviewNode[] =>
    markPrefix(straightLine(from, tile, spec.maxEdges), stateOf);
  return {
    anchor: () => line?.anchor ?? null,
    preview: (tile) => route(line?.anchor ?? tile, tile),
    click: (tile): void => {
      if (tile === null) return;
      if (line === null) {
        if (stateOf(tile) !== 'blocked') {
          line = {
            tool: spec.tool,
            anchor: { col: tile.col, row: tile.row },
            maxEdges: spec.maxEdges,
            accepts,
          };
        }
        return;
      }
      const placed = route(line.anchor, tile).filter((node) => node.state === 'open');
      line = null;
      if (placed.length > 0) spec.commit(placed.map(({ col, row }) => ({ col, row })));
    },
    stepBack: (): boolean => {
      if (line === null) return false;
      line = null;
      return true;
    },
    active: () => line,
  };
}
