import { Container, Graphics } from 'pixi.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/elevation.js';
import { halfCellToScreen, nodeDiamondPoly, TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';
import { hashCells } from './cell-signature.js';

/**
 * The CONSTRUCTION-SITE plot — a translucent grey "plac budowy" washed over the ground cells a placed
 * foundation occupies, so a fresh site reads as a marked-out building plot the instant it is placed (before
 * the scaffold has risen at all). Shaped to the building's FOOTPRINT (the `blocked` body cells the sim
 * hands over as half-cell `(col,row)` nodes), never a generic circle — a big house marks a big plot.
 *
 * Drawn in WORLD space (a child of the camera's world layer, BELOW the sprites like the placement wash), so
 * the plot pans/zooms with the ground and the rising scaffold + builders draw over it. Each cell is one
 * node diamond (the `(TILE_HALF_W, TILE_HALF_H/2)` half-cell lattice pitch); all cells of all sites are
 * filled in ONE {@link Graphics} pass so overlapping diamonds UNION (nonzero winding — no double-blended
 * seam) and the whole layer draws at a single translucent alpha. RETAINED: the union is rebuilt only when
 * the plot set changes (a site placed or finished), not per frame — a still build re-draws nothing.
 *
 * The colour/alpha are TUNED BY EYE (source basis "observed original behavior"; a human signs off the feel).
 */

/** One site's ground plot: the half-cell `(col,row)` body cells it occupies (from `Simulation.constructionPlots`). */
export interface ConstructionPlotFrame {
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/** The cleared-earth grey of the build plot, and its translucency over the ground. */
const PLOT_COLOR = 0x4a4640;
const PLOT_ALPHA = 0.55;

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
   * Redraw the grey plots for the current set of construction sites; an empty list clears them. Diamonds
   * ride the terrain lift like every projected item. Cheap signature-gated: an unchanged set is a no-op.
   */
  set(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): void {
    const key = signatureOf(plots);
    if (key === this.key) return;
    this.key = key;

    const g = this.g.clear();
    if (plots.length === 0) return;
    const hw = TILE_HALF_W;
    const hh = TILE_HALF_H / 2;
    for (const plot of plots) {
      for (const cell of plot.cells) {
        const p = halfCellToScreen(cell.col, cell.row);
        const cx = p.x;
        const cy = p.y - terrainLiftAtNode(elevation, cell.col, cell.row);
        // One node diamond per cell; all cells share the single fill below, so overlaps union cleanly.
        g.poly(nodeDiamondPoly(cx, cy, hw, hh));
      }
    }
    g.fill(PLOT_COLOR);
  }

  destroy(): void {
    this.g.destroy();
    this.container.destroy({ children: true });
  }
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
