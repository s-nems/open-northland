import { Container, Graphics } from 'pixi.js';
import { halfCellToScreen } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import { hashCells } from './cell-signature.js';

/**
 * The construction-site plot — a translucent grey "plac budowy" washed over the ground cells a placed
 * foundation occupies, so a fresh site reads as a marked-out building plot the instant it is placed (before
 * the scaffold has risen at all). Shaped to the building's footprint (the `blocked` body cells the sim
 * hands over as half-cell `(col,row)` nodes), never a generic circle — a big house marks a big plot — and
 * drawn as ONE rounded outline per contiguous region ({@link plotOutlines}), so the plot reads as a soft
 * cleared patch of earth instead of a hard-edged pile of cell diamonds.
 *
 * Drawn in world space (a child of the camera's world layer, below the sprites like the placement wash), so
 * the plot pans/zooms with the ground and the rising scaffold + builders draw over it. All regions fill in
 * one {@link Graphics} pass at a single translucent alpha. Retained: the outlines are rebuilt only when the
 * plot set changes (a site placed or finished), not per frame — a still build re-draws nothing.
 *
 * The colour/alpha/corner radius are tuned by eye (source basis "observed original behavior"; a human signs
 * off the feel).
 */

/** One site's ground plot: the half-cell `(col,row)` body cells it occupies (from `Simulation.constructionPlots`). */
export interface ConstructionPlotFrame {
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/** The cleared-earth grey of the build plot, and its translucency over the ground. */
const PLOT_COLOR = 0x4a4640;
const PLOT_ALPHA = 0.55;
/** Corner rounding cap in world px; short outline edges shrink their corners to fit (half the edge). */
const MAX_CORNER_RADIUS = 12;

export class ConstructionPlotLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  /** Signature of the plot set last drawn; skips the rebuild when nothing changed frame-to-frame. */
  private key = '';

  constructor() {
    this.container.alpha = PLOT_ALPHA;
    this.container.addChild(this.g);
  }

  /**
   * Redraw the grey plots for the current set of construction sites; an empty list clears them. Each
   * union region becomes one rounded polygon; vertices ride the terrain lift like every projected item
   * (bilinear at the outline's fractional node coords — the documented fractional-position approximation).
   */
  set(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): void {
    const key = signatureOf(plots);
    if (key === this.key) return;
    this.key = key;

    const g = this.g.clear();
    if (plots.length === 0) return;
    for (const loop of plotOutlines(plots)) {
      const points = loop.map(({ u, v }) => projectUV(elevation, u, v));
      g.roundShape(withCornerRadii(points), MAX_CORNER_RADIUS);
    }
    g.fill(PLOT_COLOR);
  }

  destroy(): void {
    this.g.destroy();
    this.container.destroy({ children: true });
  }
}

/**
 * The union outlines of the plots' cell diamonds, as loops of integer vertices in the rotated `(u,v)`
 * frame (`u = col + row`, `v = col − row`). In that frame a node diamond centred `(col,row)` is the
 * axis-aligned 2×2 square centred `(u, v)` — so the union of (overlapping) diamonds becomes a union of
 * unit grid squares, whose rectilinear boundary is walked exactly: shared edges cancel, collinear runs
 * merge, and each closed region yields one loop. Loops wind with the region on the LEFT (holes wind
 * opposite); at a corner-pinch vertex the walk prefers the left turn, so loops never self-cross.
 * Deterministic: squares and edges are visited in sorted-key order.
 */
export function plotOutlines(plots: readonly ConstructionPlotFrame[]): { u: number; v: number }[][] {
  // 1. The covered unit squares, keyed by their min corner "a,b" — 4 per cell (the 2×2 block).
  const squares = new Set<string>();
  for (const plot of plots) {
    for (const cell of plot.cells) {
      const u = cell.col + cell.row;
      const v = cell.col - cell.row;
      squares.add(`${u - 1},${v - 1}`);
      squares.add(`${u - 1},${v}`);
      squares.add(`${u},${v - 1}`);
      squares.add(`${u},${v}`);
    }
  }

  // 2. Boundary edges (neighbour square absent), directed so the region lies on the left.
  //    Directions: 0=+u, 1=+v, 2=−u, 3=−v.
  const DU = [1, 0, -1, 0];
  const DV = [0, 1, 0, -1];
  /** startVertexKey → per-direction edge flag (an edge is uniquely (start, dir)). */
  const edges = new Map<string, boolean[]>();
  const addEdge = (u: number, v: number, dir: number): void => {
    const k = `${u},${v}`;
    let dirs = edges.get(k);
    if (dirs === undefined) {
      dirs = [false, false, false, false];
      edges.set(k, dirs);
    }
    dirs[dir] = true;
  };
  for (const key of [...squares].sort()) {
    const [a = 0, b = 0] = key.split(',').map(Number);
    if (!squares.has(`${a},${b - 1}`)) addEdge(a, b, 0); // bottom: (a,b) → (a+1,b)
    if (!squares.has(`${a + 1},${b}`)) addEdge(a + 1, b, 1); // right: (a+1,b) → (a+1,b+1)
    if (!squares.has(`${a},${b + 1}`)) addEdge(a + 1, b + 1, 2); // top: (a+1,b+1) → (a,b+1)
    if (!squares.has(`${a - 1},${b}`)) addEdge(a, b + 1, 3); // left: (a,b+1) → (a,b)
  }

  // 3. Chain edges into loops, merging collinear runs. From an incoming direction the next edge is
  //    picked left-turn first (then straight, then right), so a pinch vertex splits into two loops
  //    that each keep their region on the left.
  const loops: { u: number; v: number }[][] = [];
  for (const [startKey, startDirs] of [...edges.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    for (let startDir = 0; startDir < 4; startDir++) {
      if (!startDirs[startDir]) continue;
      const loop: { u: number; v: number }[] = [];
      let [u = 0, v = 0] = startKey.split(',').map(Number);
      let dir = startDir;
      for (;;) {
        const dirs = edges.get(`${u},${v}`);
        // Turn priority relative to the incoming direction: left, straight, right.
        const next = [(dir + 1) % 4, dir, (dir + 3) % 4].find((d) => dirs?.[d]);
        if (dirs === undefined || next === undefined) break; // exhausted — loop closed below
        dirs[next] = false;
        if (next !== dir || loop.length === 0) loop.push({ u, v }); // a turn starts a new segment
        dir = next;
        u += DU[dir] ?? 0;
        v += DV[dir] ?? 0;
        if (loop[0] !== undefined && u === loop[0].u && v === loop[0].v) break; // back at the start
      }
      // The walk seeds mid-run when the start vertex is collinear; fold the seed into the last run.
      const first = loop[0];
      const last = loop[loop.length - 1];
      if (loop.length >= 2 && first !== undefined && last !== undefined) {
        const closingCollinear =
          (first.u === last.u && first.u === (loop[1]?.u ?? Number.NaN)) ||
          (first.v === last.v && first.v === (loop[1]?.v ?? Number.NaN));
        if (closingCollinear) loop.shift();
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** Project a `(u,v)` outline vertex to world px: back to half-cell node coords, then the lattice pitch
 *  and the bilinear terrain lift (fractional node coords use the documented `(hx/2, hy/2)` cell-space
 *  approximation). */
function projectUV(elevation: ElevationField, u: number, v: number): { x: number; y: number } {
  const col = (u + v) / 2;
  const row = (u - v) / 2;
  const p = halfCellToScreen(col, row);
  return { x: p.x, y: p.y - terrainLiftAt(elevation, col / 2, row / 2) };
}

/** Per-vertex corner radii: half the shorter adjacent edge, capped at {@link MAX_CORNER_RADIUS} — so a
 *  short sawtooth edge rounds fully into a soft bump while a long straight run keeps a gentle corner. */
function withCornerRadii(
  points: readonly { x: number; y: number }[],
): { x: number; y: number; radius: number }[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i + n - 1) % n] ?? p;
    const next = points[(i + 1) % n] ?? p;
    const lenPrev = Math.hypot(p.x - prev.x, p.y - prev.y);
    const lenNext = Math.hypot(next.x - p.x, next.y - p.y);
    return { ...p, radius: Math.min(MAX_CORNER_RADIUS, lenPrev / 2, lenNext / 2) };
  });
}

/** A cheap order-sensitive signature of the plot set (cell count + a rolling mix of every cell) so an
 *  unchanged set skips the redraw. Only gates a cosmetic redraw — a collision self-corrects next change. */
function signatureOf(plots: readonly ConstructionPlotFrame[]): string {
  let h = 0;
  let n = 0;
  for (const plot of plots) {
    h = hashCells(plot.cells, h);
    n += plot.cells.length;
  }
  return `${n}:${h}`;
}
