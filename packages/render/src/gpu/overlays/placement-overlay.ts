import { Container, Graphics, type Renderer, RenderTexture, Sprite } from 'pixi.js';
import { halfCellToScreen, nodeDiamondPoly, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { hashCells } from './cell-signature.js';

/**
 * The build-placement overlay: a translucent dark wash over everything the held building cannot anchor
 * on and a slight lift over the ground it can, with no visible tile grid. The sim's placement rule
 * (`Simulation.placementProbe`) decides the blocked set; this layer only projects it. Each side is
 * composited off-screen at half resolution first, where the padded diamonds fuse by saturating instead
 * of double-blending. The alpha and softness constants are tuned by eye against the original's
 * build-mode look (observation).
 */

/** One half-cell node of the probed band (integer col,row on the `2W×2H` lattice). */
export interface PlacementOverlayCell {
  readonly col: number;
  readonly row: number;
}

/** One build-mode frame: the probed node band, plus which of its nodes rejected the held building's
 *  anchor. The buildable side is the band's complement of `blocked`. */
export interface PlacementOverlayFrame {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
  readonly blocked: readonly PlacementOverlayCell[];
}

/** The dim wash: near-black at a moderate alpha - enough to read "blocked" without hiding the ground. */
const DIM_COLOR = 0x000000;
const DIM_ALPHA = 0.42;
/** The buildable-side lift: additive white, faint - the original's slight contrast boost. */
const BRIGHT_ALPHA = 0.08;
/** Half-resolution compositing - halves the fill cost. */
const COMPOSITE_RESOLUTION = 0.5;
/** World-px pad each diamond grows by, so adjacent same-side cells fuse without hairline seams. Must
 *  exceed 2 composite px (2 / COMPOSITE_RESOLUTION world px); below that the pad is sub-pixel and
 *  neighbouring AA edges leave a visible seam lattice. */
const CELL_OVERLAP = 5;
/** Composite-texture allocation step (texture px). */
const TEXTURE_QUANT = 128;

/** The world-space box of a band's composite, padded for the border diamonds + the terrain lift. */
interface OverlayBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The world-space bounds of a band's composite: the node centres' extent grown on every side by a border
 * diamond's half-extents (`TILE_HALF_W` × `TILE_HALF_H/2` - the rectangular node lattice has no stagger
 * overhang) plus the fusing pad, and by the map's max terrain lift upward. Pure, so it tests without GL.
 */
export function overlayBounds(
  frame: Pick<PlacementOverlayFrame, 'minCol' | 'maxCol' | 'minRow' | 'maxRow'>,
  maxLift: number,
): OverlayBounds {
  const topLeft = halfCellToScreen(frame.minCol, frame.minRow);
  const bottomRight = halfCellToScreen(frame.maxCol, frame.maxRow);
  const padX = TILE_HALF_W + CELL_OVERLAP;
  const padY = TILE_HALF_H / 2 + CELL_OVERLAP;
  return {
    x: topLeft.x - padX,
    y: topLeft.y - padY - maxLift,
    width: bottomRight.x - topLeft.x + 2 * padX,
    height: bottomRight.y - topLeft.y + 2 * padY + maxLift,
  };
}

export class PlacementOverlayLayer {
  readonly container = new Container();
  private readonly renderer: Renderer;
  /** The blocked cells' fused diamonds, tinted dark and translucent. */
  private readonly dim = new Sprite();
  /** The buildable cells' fused diamonds, additive and faint. */
  private readonly bright = new Sprite();
  private dimTexture: RenderTexture | null = null;
  private brightTexture: RenderTexture | null = null;
  /** The two retained composite sources, cleared + refilled per recomposite (never re-allocated). */
  private readonly blockedG = new Graphics();
  private readonly buildableG = new Graphics();
  /** Signature of the frame last composited - an unchanged signature skips the rebuild. */
  private key = '';

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.dim.tint = DIM_COLOR;
    this.dim.alpha = DIM_ALPHA;
    this.dim.visible = false;
    this.bright.blendMode = 'add';
    this.bright.alpha = BRIGHT_ALPHA;
    this.bright.visible = false;
    this.container.addChild(this.dim, this.bright);
  }

  /** Recomposite the wash for a build-mode frame; `null` clears it. Diamonds are lifted onto the terrain
   *  like every projected item. */
  set(frame: PlacementOverlayFrame | null, elevation: ElevationField): void {
    if (frame === null || frame.minCol > frame.maxCol || frame.minRow > frame.maxRow) {
      if (this.key !== '') {
        this.dim.visible = false;
        this.bright.visible = false;
        this.key = '';
      }
      return;
    }
    const key = signatureOf(frame);
    if (key === this.key) return;

    const bounds = overlayBounds(frame, elevation.maxLift);
    this.ensureTextures(
      Math.max(1, Math.ceil(bounds.width * COMPOSITE_RESOLUTION)),
      Math.max(1, Math.ceil(bounds.height * COMPOSITE_RESOLUTION)),
    );
    const dimTexture = this.dimTexture;
    const brightTexture = this.brightTexture;
    if (dimTexture === null || brightTexture === null) return; // ensureTextures always sets them

    const blocked = new Set<string>();
    for (const c of frame.blocked) blocked.add(`${c.col},${c.row}`);
    const blockedG = this.blockedG.clear();
    const buildableG = this.buildableG.clear();
    // The node lattice is a (HALF_W, HALF_H/2)-pitch rectangle, so a diamond of those half-extents on
    // every node covers the plane: the worst gap point between four nodes lands on four diamond edges.
    const hw = (TILE_HALF_W + CELL_OVERLAP) * COMPOSITE_RESOLUTION;
    const hh = (TILE_HALF_H / 2 + CELL_OVERLAP) * COMPOSITE_RESOLUTION;
    for (let row = frame.minRow; row <= frame.maxRow; row++) {
      for (let col = frame.minCol; col <= frame.maxCol; col++) {
        // Project into composite-texture space: the lifted node point, less the band origin, at half res.
        const p = projectNode(elevation, col, row);
        const cx = (p.x - bounds.x) * COMPOSITE_RESOLUTION;
        const cy = (p.y - bounds.y) * COMPOSITE_RESOLUTION;
        const g = blocked.has(`${col},${row}`) ? blockedG : buildableG;
        g.poly(nodeDiamondPoly(cx, cy, hw, hh));
      }
    }
    blockedG.fill(0xffffff);
    buildableG.fill(0xffffff);

    // The textures may be quantized larger than the band, so `clear: true` blanks the margin and the
    // slack past the band's edge stays transparent.
    this.renderer.render({ container: blockedG, target: dimTexture, clear: true });
    this.renderer.render({ container: buildableG, target: brightTexture, clear: true });

    for (const spr of [this.dim, this.bright]) {
      spr.position.set(bounds.x, bounds.y);
      spr.scale.set(1 / COMPOSITE_RESOLUTION);
      spr.visible = true;
    }
    this.dim.texture = dimTexture;
    this.bright.texture = brightTexture;
    // Marked only now: a failed alloc or lost context above retries next frame instead of skipping on a
    // stale signature.
    this.key = key;
  }

  /** Grow-only quantized (re)allocation of the two composite textures. The visible col/row count flaps
   *  N↔N+1 as a smooth pan crosses tile phase, so exact-size allocation would recreate GPU textures
   *  every half tile of travel. */
  private ensureTextures(w: number, h: number): void {
    const quantW = Math.ceil(w / TEXTURE_QUANT) * TEXTURE_QUANT;
    const quantH = Math.ceil(h / TEXTURE_QUANT) * TEXTURE_QUANT;
    const current = this.dimTexture;
    if (current !== null && current.width >= quantW && current.height >= quantH) return;
    const newW = Math.max(quantW, current?.width ?? 0);
    const newH = Math.max(quantH, current?.height ?? 0);
    this.dimTexture?.destroy(true);
    this.brightTexture?.destroy(true);
    // Linear (default) sampling upscales the half-res composite into the soft, grid-free edge.
    this.dimTexture = RenderTexture.create({ width: newW, height: newH });
    this.brightTexture = RenderTexture.create({ width: newW, height: newH });
  }

  destroy(): void {
    this.dimTexture?.destroy(true);
    this.brightTexture?.destroy(true);
    this.blockedG.destroy();
    this.buildableG.destroy();
    this.container.destroy({ children: true });
  }
}

/** Order-sensitive signature of a frame - equal frames hash equal because the caller emits blocked cells
 *  in a fixed tile-scan order. */
function signatureOf(frame: PlacementOverlayFrame): string {
  const h = hashCells(frame.blocked, frame.blocked.length);
  return `${frame.minCol},${frame.maxCol},${frame.minRow},${frame.maxRow}:${frame.blocked.length}:${h}`;
}
