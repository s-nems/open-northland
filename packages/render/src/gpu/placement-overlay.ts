import { Container, Graphics } from 'pixi.js';
import type { ElevationField } from '../data/elevation.js';
import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../data/iso.js';

/**
 * The BUILD-PLACEMENT overlay — a translucent dark wash over the tiles where the currently-held
 * building cannot be placed, so during build mode the map reads as "normal where I may build, dimmed
 * where I may not" (the original's build-mode look). Which tiles are blocked is decided upstream by
 * the sim's placement rule (`Simulation.placementProbe`) and handed here as plain data; this layer is
 * a pure projection of that set, exactly like the selection rings project selected ids — it never
 * calls back into the sim.
 *
 * Drawn in WORLD space (a child of the camera's `worldLayer`, BELOW the sprite layer) so the wash pans
 * and zooms with the ground and a house/tree sprite still draws over it. The diamonds are lifted onto
 * the terrain like the ground mesh. RETAINED like the other layers: the geometry is rebuilt only when
 * the blocked-cell SET changes (a `key` guard), so a still camera over an unchanged world re-tessellates
 * nothing — a pan/zoom is free (the camera transform moves the world-space graphics).
 *
 * The whole blocked region is ONE union-filled path (all diamonds added, then a single `fill`) with no
 * per-cell stroke, so contiguous blocked cells merge into a smooth dimmed area — only the boundary
 * against buildable ground shows a diamond edge. That is deliberate: the original shows no tile grid, so
 * the internal cell seams must not read as "hexes".
 */

/** One blocked tile the overlay dims (integer col,row). */
export interface PlacementOverlayCell {
  readonly col: number;
  readonly row: number;
}

/** The dim wash: near-black at a moderate alpha — enough to read "blocked" without hiding the ground. */
const OVERLAY_COLOR = 0x000000;
const OVERLAY_ALPHA = 0.4;

export class PlacementOverlayLayer {
  readonly container = new Container();
  private readonly graphics = new Graphics();
  /** Signature of the cell set last drawn; skips the diamond rebuild when it hasn't changed frame-to-frame. */
  private key = '';

  constructor() {
    this.container.addChild(this.graphics);
  }

  /**
   * Redraw the dark diamonds over `cells` (the build-blocked tiles), each lifted onto the terrain.
   * `null` or an empty list clears the overlay (build mode ended / everything here is buildable).
   */
  set(cells: readonly PlacementOverlayCell[] | null, elevation: ElevationField): void {
    if (cells === null || cells.length === 0) {
      if (this.key !== '') {
        this.graphics.clear();
        this.key = '';
      }
      return;
    }
    const key = signatureOf(cells);
    if (key === this.key) return;
    this.key = key;

    this.graphics.clear();
    const lifted = elevation.maxLift > 0;
    for (const c of cells) {
      const p = tileToScreen(c.col, c.row);
      const y = lifted ? p.y - elevation.liftAt(c.col, c.row) : p.y;
      // The cell diamond: top, right, bottom, left. No stroke — see the class note (no visible grid).
      this.graphics.poly([
        p.x,
        y - TILE_HALF_H,
        p.x + TILE_HALF_W,
        y,
        p.x,
        y + TILE_HALF_H,
        p.x - TILE_HALF_W,
        y,
      ]);
    }
    this.graphics.fill({ color: OVERLAY_COLOR, alpha: OVERLAY_ALPHA });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** A cheap order-sensitive hash of the cell set (length + a rolling mix of each col/row) so an unchanged
 *  set skips the rebuild. The caller emits cells in a fixed tile-scan order, so equal sets hash equal;
 *  a collision between two different same-length sets is tolerated (a stale cosmetic wash for one frame,
 *  self-correcting on the next change) — this only gates a redraw, never correctness. */
function signatureOf(cells: readonly PlacementOverlayCell[]): string {
  let h = cells.length | 0;
  for (const c of cells) h = (Math.imul(h, 31) + Math.imul(c.col, 73856093) + Math.imul(c.row, 19349663)) | 0;
  return `${cells.length}:${h}`;
}
