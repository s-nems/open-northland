import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { halfCellToScreen } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { EntityBounds } from '../sprite-pool/pooled-entity.js';
import { hashCells } from './cell-signature.js';

/**
 * The translucent grey plot washed over the ground cells a placed foundation occupies, shaped to the
 * building's footprint (the `blocked` body cells the sim hands over) and drawn as one rounded outline per
 * contiguous region. Colour, alpha, and corner radius are approximations tuned by eye.
 */

/** The half-cell `(col,row)` body cells one site occupies. */
export interface ConstructionPlotFrame {
  readonly ref: number;
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

const PLOT_COLOR = 0x4a4640;
const PLOT_ALPHA = 0.55;
/** Corner rounding cap in world px. */
const MAX_CORNER_RADIUS = 12;

interface PickPlot {
  readonly plot: ConstructionPlotFrame;
  lastSeen: number;
  shape?: GraphicsContext;
  readonly bounds: { -readonly [K in keyof EntityBounds]: EntityBounds[K] };
}

export class ConstructionPlotLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  /** The list last handed in: the frame loop passes the same array while no plot changed. */
  private drawn: readonly ConstructionPlotFrame[] | null = null;
  /** Signature of the plot set last drawn - an unchanged set skips the rebuild. */
  private key = '';
  private readonly picks = new Map<number, PickPlot>();
  private pickGeneration = 0;
  private readonly point = { x: 0, y: 0 };
  private elevation: ElevationField | undefined;

  constructor() {
    this.container.alpha = PLOT_ALPHA;
    this.container.addChild(this.g);
  }

  /** Redraw the plots for the current set of construction sites; an empty list clears them. */
  set(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): void {
    const elevationChanged = elevation !== this.elevation;
    if (plots === this.drawn && !elevationChanged) return;
    this.drawn = plots;
    this.elevation = elevation;
    const generation = ++this.pickGeneration;
    for (const plot of plots) {
      const held = this.picks.get(plot.ref);
      // Fog refreshes the source list even when this site's visible cells stay unchanged.
      if (held !== undefined && !elevationChanged && sameCells(held.plot.cells, plot.cells)) {
        held.lastSeen = generation;
        continue;
      }
      held?.shape?.destroy();
      this.picks.set(plot.ref, {
        plot,
        lastSeen: generation,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      });
    }
    for (const [ref, pick] of this.picks) {
      if (pick.lastSeen === generation) continue;
      pick.shape?.destroy();
      this.picks.delete(ref);
    }
    const key = signatureOf(plots);
    if (key === this.key && !elevationChanged) return;
    this.key = key;

    const g = this.g.clear();
    if (plots.length === 0) return;
    fillPlots(g.context, plots, elevation);
  }

  destroy(): void {
    for (const pick of this.picks.values()) pick.shape?.destroy();
    this.picks.clear();
    this.g.destroy();
    this.container.destroy({ children: true });
  }

  /** The visible ground plot remains selectable before its building has any revealed pixels. */
  hit(ref: number, x: number, y: number): boolean {
    const pick = this.pickPlot(ref);
    this.point.x = x;
    this.point.y = y;
    return pick?.shape?.containsPoint(this.point) ?? false;
  }

  boundsOf(ref: number, body: EntityBounds | undefined): EntityBounds | undefined {
    const pick = this.pickPlot(ref);
    const plot = pick?.shape?.bounds;
    if (pick === undefined || plot === undefined) return body;
    const bounds = pick.bounds;
    bounds.minX = Math.min(plot.minX, body?.minX ?? plot.minX);
    bounds.minY = Math.min(plot.minY, body?.minY ?? plot.minY);
    bounds.maxX = Math.max(plot.maxX, body?.maxX ?? plot.maxX);
    bounds.maxY = Math.max(plot.maxY, body?.maxY ?? plot.maxY);
    return bounds;
  }

  /** Built only for queried sites; the hit shape uses the same lifted, rounded outline as the decal. */
  private pickPlot(ref: number): PickPlot | undefined {
    const pick = this.picks.get(ref);
    const elevation = this.elevation;
    if (pick === undefined || elevation === undefined) return undefined;
    if (pick.shape === undefined) {
      pick.shape = new GraphicsContext();
      fillPlots(pick.shape, [pick.plot], elevation);
    }
    return pick;
  }
}

function sameCells(a: ConstructionPlotFrame['cells'], b: ConstructionPlotFrame['cells']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.col !== b[i]?.col || a[i]?.row !== b[i]?.row) return false;
  }
  return true;
}

function fillPlots(
  context: GraphicsContext,
  plots: readonly ConstructionPlotFrame[],
  elevation: ElevationField,
): void {
  for (const loop of plotOutlines(plots)) {
    const points = loop.map(({ u, v }) => projectUV(elevation, u, v));
    context.roundShape(withCornerRadii(points), MAX_CORNER_RADIUS);
  }
  context.fill(PLOT_COLOR);
}

/**
 * The union outlines of the plots' cell diamonds, as loops of integer vertices in the rotated `(u,v)`
 * frame (`u = col + row`, `v = col − row`), where a node diamond is the axis-aligned 2×2 square centred
 * `(u, v)` - so the union becomes unit grid squares whose rectilinear boundary is walked exactly. Loops
 * wind with the region on the left (holes wind opposite); at a corner-pinch vertex the walk prefers the
 * left turn, so loops never self-cross. Deterministic: squares and edges are visited in sorted-key order,
 * so the outlines do not depend on the caller's cell order.
 */
export function plotOutlines(
  plots: readonly Pick<ConstructionPlotFrame, 'cells'>[],
): { u: number; v: number }[][] {
  // 1. The covered unit squares, keyed by their min corner "a,b" - 4 per cell (the 2×2 block).
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

  // 3. Chain edges into loops, merging collinear runs.
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
        if (dirs === undefined || next === undefined) break; // exhausted - loop closed below
        dirs[next] = false;
        if (next !== dir || loop.length === 0) loop.push({ u, v }); // a turn starts a new segment
        dir = next;
        u += DU[dir] ?? 0;
        v += DV[dir] ?? 0;
        if (loop[0] !== undefined && u === loop[0].u && v === loop[0].v) break;
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

/** Project a `(u,v)` outline vertex to world px; fractional node coords use the `(hx/2, hy/2)` cell-space
 *  approximation. */
function projectUV(elevation: ElevationField, u: number, v: number): { x: number; y: number } {
  const col = (u + v) / 2;
  const row = (u - v) / 2;
  const p = halfCellToScreen(col, row);
  return { x: p.x, y: p.y - terrainLiftAt(elevation, col / 2, row / 2) };
}

/** Per-vertex corner radii: half the shorter adjacent edge, capped at {@link MAX_CORNER_RADIUS}. */
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

/** Cell count plus a rolling hash of every cell. */
function signatureOf(plots: readonly ConstructionPlotFrame[]): string {
  let h = 0;
  let n = 0;
  for (const plot of plots) {
    h = hashCells(plot.cells, h);
    n += plot.cells.length;
  }
  return `${n}:${h}`;
}
