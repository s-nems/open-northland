import { Container, Graphics, GraphicsContext, type Texture } from 'pixi.js';
import {
  aabbIntersects,
  type Box,
  halfCellToScreenX,
  halfCellToScreenY,
  rowStagger,
  TILE_HALF_H,
  TILE_HALF_W,
  type Viewport,
} from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { EntityBounds } from '../sprite-pool/pooled-entity.js';
import { hashCells } from './cell-signature.js';

/**
 * The ground a placed foundation occupies until its house stands: trampled earth over the building's
 * footprint (the `blocked` body cells the sim hands over), one rounded outline per contiguous region.
 * A vehicle's yard lays no foundation and draws no plot. A project choice: the original washes the cells
 * grey. Colours, alphas and the corner radius are tuned by eye.
 */

/** The half-cell `(col,row)` body cells one site occupies. */
export interface ConstructionPlotFrame {
  readonly ref: number;
  /** False for a vehicle's yard, which draws no earth but is still picked by its outline. */
  readonly foundation: boolean;
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/** Without the earth art (a bare render test, the `?shot` entry) a flat wash stands in. */
const FALLBACK_COLOR = 0x4a4640;
const FALLBACK_ALPHA = 0.55;
const EARTH_ALPHA = 0.94;
/** The earth thinning into the grass past the outline: bands of the same earth stroked along it, widest
 *  first, each adding its alpha over the ones under it. Round joins swell the corners. Tuned by eye. */
const FEATHER: readonly { readonly width: number; readonly alpha: number }[] = [
  { width: 22, alpha: 0.16 },
  { width: 17, alpha: 0.2 },
  { width: 12, alpha: 0.28 },
  { width: 8, alpha: 0.38 },
  { width: 4, alpha: 0.55 },
];
/** World px a feather band reaches past the outline it is stroked along. */
const FEATHER_REACH = Math.max(...FEATHER.map((band) => band.width)) / 2;
/** Corner rounding cap in world px. */
const MAX_CORNER_RADIUS = 12;

interface PickPlot {
  readonly plot: ConstructionPlotFrame;
  lastSeen: number;
  shape?: GraphicsContext;
  readonly bounds: { -readonly [K in keyof EntityBounds]: EntityBounds[K] };
}

export class ConstructionPlotLayer {
  /** Its own Pixi render group: an island the cull shows or hides rebuilds this short list alone. */
  readonly container = new Container({ isRenderGroup: true });
  /** The earth's paint passes, back to front: one per feather band, then the fill. Every island draws
   *  one decal in each, so a band of one island never paints over a later band or the fill of another. */
  private readonly passes: readonly Container[];
  /** The list last handed in: the frame loop passes the same array while no plot changed. */
  private drawn: readonly ConstructionPlotFrame[] | null = null;
  /** Signature of the plot set last drawn - an unchanged set skips the rebuild. */
  private key = '';
  private readonly picks = new Map<number, PickPlot>();
  /** The plot islands last drawn, by the ref of each island's first plot. */
  private islands = new Map<number, Island>();
  private culled: Viewport | null = null;
  private pickGeneration = 0;
  private readonly point = { x: 0, y: 0 };
  private elevation: ElevationField | undefined;

  /** `earth` tiles over the plots in world px; absent, a flat wash stands in. */
  constructor(private readonly earth?: Texture) {
    this.passes = (earth === undefined ? [null] : [...FEATHER, null]).map(() =>
      this.container.addChild(new Container()),
    );
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
    const earth = plots.filter(hasFoundation);
    const key = signatureOf(earth);
    if (key === this.key && !elevationChanged) return;
    this.key = key;
    this.drawIslands(earth, elevation, elevationChanged);
  }

  /**
   * Show the islands whose earth reaches `vp` and hide the rest, so the plots drawn follow the screen
   * and not the map's count of sites. `vp` must cover everything the next render shows.
   */
  cull(vp: Viewport): void {
    const last = this.culled;
    if (
      last !== null &&
      last.minX === vp.minX &&
      last.minY === vp.minY &&
      last.maxX === vp.maxX &&
      last.maxY === vp.maxY
    )
      return;
    this.culled = vp;
    for (const island of this.islands.values()) showIsland(island, aabbIntersects(vp, island));
  }

  /** One island per group of plots whose outlines can meet, keeping the decals of each island whose
   *  plots held since the last draw, so a site placed or finished redraws its island only. */
  private drawIslands(
    plots: readonly ConstructionPlotFrame[],
    elevation: ElevationField,
    elevationChanged: boolean,
  ): void {
    const held = this.islands;
    const drawn = new Map<number, Island>();
    for (const plotsOfIsland of plotIslands(plots)) {
      const first = plotsOfIsland[0];
      if (first === undefined) continue;
      const kept = elevationChanged ? undefined : held.get(first.ref);
      if (kept !== undefined && sameIsland(kept.plots, plotsOfIsland)) {
        held.delete(first.ref);
        drawn.set(first.ref, kept);
        continue;
      }
      const island = this.makeIsland(plotsOfIsland, elevation);
      if (this.culled !== null) showIsland(island, aabbIntersects(this.culled, island));
      drawn.set(first.ref, island);
    }
    for (const island of held.values()) for (const decal of island.decals) decal.destroy();
    this.islands = drawn;
  }

  private makeIsland(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): Island {
    const loops = projectedLoops(plots, elevation);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const loop of loops) {
      for (const { x, y } of loop.points) {
        box.minX = Math.min(box.minX, x - FEATHER_REACH);
        box.minY = Math.min(box.minY, y - FEATHER_REACH);
        box.maxX = Math.max(box.maxX, x + FEATHER_REACH);
        box.maxY = Math.max(box.maxY, y + FEATHER_REACH);
      }
    }
    const decals = this.passes.map((pass, index) => {
      const decal = new Graphics();
      // Never through Pixi's batcher, which places a small shape's vertices itself: every decal
      // rasterizes through the one path, whatever its size.
      decal.context.batchMode = 'no-batch';
      decal.alpha = this.earth === undefined ? FALLBACK_ALPHA : EARTH_ALPHA;
      paintPass(decal.context, loops, index, this.earth);
      return pass.addChild(decal);
    });
    return { plots, decals, ...box };
  }

  destroy(): void {
    for (const pick of this.picks.values()) pick.shape?.destroy();
    this.picks.clear();
    // A decal destroyed through its parent keeps its context alive.
    for (const island of this.islands.values()) for (const decal of island.decals) decal.destroy();
    this.islands.clear();
    this.container.destroy({ children: true });
  }

  /** A site's plot remains selectable before its building has any revealed pixels, drawn or not. */
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
      fillPlotOutlines(pick.shape, [pick.plot], elevation);
    }
    return pick;
  }
}

const hasFoundation = (plot: ConstructionPlotFrame): boolean => plot.foundation;

function sameCells(a: ConstructionPlotFrame['cells'], b: ConstructionPlotFrame['cells']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.col !== b[i]?.col || a[i]?.row !== b[i]?.row) return false;
  }
  return true;
}

/** One outline loop, projected and radiused for `roundShape`. */
interface OutlineLoop {
  /** Handed to `roundShape`, which keeps the array but only reads it. */
  readonly points: { x: number; y: number; radius: number }[];
}

/** The plots of one island, as last handed in, its decal in each paint pass, and the world box its
 *  earth reaches. */
interface Island extends Box {
  readonly plots: readonly ConstructionPlotFrame[];
  readonly decals: readonly Graphics[];
}

function showIsland(island: Island, shown: boolean): void {
  for (const decal of island.decals) decal.visible = shown;
}

function projectedLoops(
  plots: readonly Pick<ConstructionPlotFrame, 'cells'>[],
  elevation: ElevationField,
): OutlineLoop[] {
  return plotOutlines(plots).map((loop) => ({
    points: withCornerRadii(loop.map(({ u, v }) => projectUV(elevation, u, v))),
  }));
}

function traceLoops(context: GraphicsContext, loops: readonly OutlineLoop[]): void {
  for (const loop of loops) context.roundShape(loop.points, MAX_CORNER_RADIUS);
}

/**
 * Paint pass `index` of `loops`: with the earth art, the feather band of that index, a band of the same
 * earth stroked along the outline, and after the last band the fill; without it, the flat wash.
 */
function paintPass(
  context: GraphicsContext,
  loops: readonly OutlineLoop[],
  index: number,
  earth?: Texture,
): void {
  traceLoops(context, loops);
  if (earth === undefined) {
    context.fill(FALLBACK_COLOR);
    return;
  }
  const band = FEATHER[index];
  // World-space texels: neighbouring plots continue one stretch of earth.
  if (band === undefined) context.fill({ texture: earth, textureSpace: 'global' });
  else {
    context.stroke({
      texture: earth,
      textureSpace: 'global',
      width: band.width,
      alpha: band.alpha,
      join: 'round',
    });
  }
}

/** Outline every plot afresh and fill them as one shape: a site's click shape. */
export function fillPlotOutlines(
  context: GraphicsContext,
  plots: readonly ConstructionPlotFrame[],
  elevation: ElevationField,
): void {
  paintPass(context, projectedLoops(plots, elevation), 0);
}

/** Add every plot's rounded outline to `context` as paths, for the caller to fill or stroke. */
export function tracePlotOutlines(
  context: GraphicsContext,
  plots: readonly Pick<ConstructionPlotFrame, 'cells'>[],
  elevation: ElevationField,
): void {
  traceLoops(context, projectedLoops(plots, elevation));
}

function sameIsland(a: readonly ConstructionPlotFrame[], b: readonly ConstructionPlotFrame[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.ref !== y.ref || !sameCells(x.cells, y.cells)) return false;
  }
  return true;
}

/** The `(u,v)` extent of a plot's outline vertices: a node's square reaches {@link NODE_SQUARE_HALF} past its centre. */
interface UVBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

function vertexBoxOf(plot: ConstructionPlotFrame): UVBox {
  const box = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const { col, row } of plot.cells) {
    const { u, v } = nodeSquareCentre(col, row);
    box.minU = Math.min(box.minU, u - NODE_SQUARE_HALF);
    box.maxU = Math.max(box.maxU, u + NODE_SQUARE_HALF);
    box.minV = Math.min(box.minV, v - NODE_SQUARE_HALF);
    box.maxV = Math.max(box.maxV, v + NODE_SQUARE_HALF);
  }
  return box;
}

/**
 * The plots grouped so no outline vertex is shared between groups: plots whose vertex extents meet or
 * overlap, transitively, share an island, each island's plots in list order. An island's loops are then
 * exactly the loops the whole set walks around its squares, with the same start edges.
 */
export function plotIslands(plots: readonly ConstructionPlotFrame[]): ConstructionPlotFrame[][] {
  const boxes = plots.map(vertexBoxOf);
  const parent = plots.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const byMinU = plots.map((_, i) => i).sort((a, b) => (boxes[a]?.minU ?? 0) - (boxes[b]?.minU ?? 0));
  const open: number[] = [];
  for (const i of byMinU) {
    const box = boxes[i] as UVBox;
    let kept = 0;
    for (const j of open) {
      const other = boxes[j] as UVBox;
      if (other.maxU < box.minU) continue;
      open[kept++] = j;
      if (other.minV <= box.maxV && box.minV <= other.maxV) parent[root(j)] = root(i);
    }
    open.length = kept;
    open.push(i);
  }
  const islands = new Map<number, ConstructionPlotFrame[]>();
  plots.forEach((plot, i) => {
    const r = root(i);
    const island = islands.get(r);
    if (island === undefined) islands.set(r, [plot]);
    else island.push(plot);
  });
  return [...islands.values()];
}

/**
 * The union outlines of the plots' node diamonds, as loops of integer vertices in the rotated `(u,v)`
 * frame of {@link nodeSquareCentre}, where a node diamond is an axis-aligned square - so the union
 * becomes unit grid squares whose rectilinear boundary is walked exactly. Loops
 * wind with the region on the left (holes wind opposite); at a corner-pinch vertex the walk prefers the
 * left turn, so loops never self-cross. Deterministic: squares and edges are visited in sorted-key order,
 * so the outlines do not depend on the caller's cell order.
 */
export function plotOutlines(
  plots: readonly Pick<ConstructionPlotFrame, 'cells'>[],
): { u: number; v: number }[][] {
  // 1. The covered unit squares, keyed by their min corner "a,b".
  const squares = new Set<string>();
  for (const plot of plots) {
    for (const cell of plot.cells) {
      const { u, v } = nodeSquareCentre(cell.col, cell.row);
      for (let du = -NODE_SQUARE_HALF; du < NODE_SQUARE_HALF; du++) {
        for (let dv = -NODE_SQUARE_HALF; dv < NODE_SQUARE_HALF; dv++) squares.add(`${u + du},${v + dv}`);
      }
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

/** Half a node square's side in outline units: two, so odd rows' squares, a quarter cell east, stay on
 *  the integer grid. */
const NODE_SQUARE_HALF = 2;
/** World px per outline unit along `x` and along `y`: a node diamond reaches `TILE_HALF_W` across and
 *  `TILE_HALF_H / 2` down. */
const UNIT_X = TILE_HALF_W / NODE_SQUARE_HALF;
const UNIT_Y = TILE_HALF_H / 2 / NODE_SQUARE_HALF;

/** A node's square centre in the outline frame, rotated from its flat screen point so the node's
 *  diamond becomes the axis-aligned square of half-side {@link NODE_SQUARE_HALF}. */
function nodeSquareCentre(col: number, row: number): { u: number; v: number } {
  const x = halfCellToScreenX(col, row) / UNIT_X;
  const y = halfCellToScreenY(row) / UNIT_Y;
  return { u: x + y, v: x - y };
}

/** Project a `(u,v)` outline vertex to world px, lifted by the terrain under that point. */
export function projectUV(elevation: ElevationField, u: number, v: number): { x: number; y: number } {
  const x = ((u + v) / 2) * UNIT_X;
  const y = ((u - v) / 2) * UNIT_Y;
  const tileRow = y / TILE_HALF_H;
  const tileCol = (x / TILE_HALF_W - rowStagger(tileRow)) / 2;
  return { x, y: y - terrainLiftAt(elevation, tileCol, tileRow) };
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
