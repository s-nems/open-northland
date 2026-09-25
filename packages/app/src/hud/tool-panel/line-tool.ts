import { hexDistanceBetween } from '@open-northland/sim';

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

interface Cube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function toCube(node: LineNode): Cube {
  const x = node.col - (node.row - (node.row & 1)) / 2;
  const z = node.row;
  return { x, y: -x - z, z };
}

function fromCube(cube: Cube): LineNode {
  const row = cube.z;
  return { col: cube.x + (row - (row & 1)) / 2, row };
}

function roundCube(cube: Cube): Cube {
  let x = Math.round(cube.x);
  let y = Math.round(cube.y);
  let z = Math.round(cube.z);
  const dx = Math.abs(x - cube.x);
  const dy = Math.abs(y - cube.y);
  const dz = Math.abs(z - cube.z);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy > dz) y = -x - z;
  else z = -x - y;
  return { x, y, z };
}

/** A deterministic shortest hex line from `start` toward `end`, at most `maxEdges` steps long. */
export function hexLine(start: LineNode, end: LineNode, maxEdges: number): LineNode[] {
  const distance = hexDistanceBetween(start.col, start.row, end.col, end.row);
  if (distance === 0) return [{ col: start.col, row: start.row }];
  const steps = Math.min(maxEdges, distance);
  const a = toCube(start);
  const b = toCube(end);
  const nodes: LineNode[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / distance;
    nodes.push(
      fromCube(roundCube({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })),
    );
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

/**
 * The nodes a started line can end on: those whose whole line from the anchor is accepted. Each node in
 * the reach radius is probed once, so the cost is the radius's area, not area times line length.
 */
export function lineReach(line: ActiveLine): ReadonlySet<string> {
  const verdicts = new Map<string, boolean>();
  const accepted = (node: LineNode): boolean => {
    const key = `${node.col},${node.row}`;
    let verdict = verdicts.get(key);
    if (verdict === undefined) {
      verdict = line.accepts(node.col, node.row);
      verdicts.set(key, verdict);
    }
    return verdict;
  };
  const reach = new Set<string>();
  const { anchor, maxEdges } = line;
  if (!accepted(anchor)) return reach;
  // Half-cell rows step one hex row each, and a row holds at most `maxEdges` steps either way.
  for (let row = anchor.row - maxEdges; row <= anchor.row + maxEdges; row++) {
    for (let col = anchor.col - maxEdges; col <= anchor.col + maxEdges; col++) {
      const end = { col, row };
      if (hexDistanceBetween(anchor.col, anchor.row, col, row) > maxEdges) continue;
      if (hexLine(anchor, end, maxEdges).every(accepted)) reach.add(`${col},${row}`);
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
    markPrefix(hexLine(from, tile, spec.maxEdges), stateOf);
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
