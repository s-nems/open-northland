import { Container, Graphics, type Renderer, RenderTexture, Sprite } from 'pixi.js';
import type { ElevationField } from '../data/elevation.js';
import { halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../data/iso.js';

/**
 * The BUILD-PLACEMENT overlay — the original's build-mode read of the ground: a translucent dark wash
 * over everything the held building CANNOT anchor on, and a slight lift over the ground it CAN, so the
 * map reads "normal-bright where I may build, dimmed where I may not" with NO visible tile grid.
 * Which tiles are which is decided upstream by the sim's placement rule (`Simulation.placementProbe`)
 * and handed here as plain data; this layer is a pure projection of that set — it never calls back
 * into the sim.
 *
 * SEAMLESSNESS is the point (the original shows no cell lattice, and per-cell translucent diamond
 * fills leave AA seams between neighbours that read as a grid). So each side of the wash is
 * composited OFF-SCREEN first: its cells' diamonds — each grown by an overlap pad so neighbours
 * fuse — are rendered OPAQUE into a RenderTexture (overlap saturates instead of double-blending, so
 * interior cell boundaries vanish by construction), and only the finished texture is drawn
 * translucently into the scene: the blocked side tinted dark, the buildable side additive as the
 * slight contrast lift. Both textures render at half resolution and upscale with linear filtering,
 * which rounds the diamond boundary into the soft, free-form edge the original shows.
 *
 * Drawn in WORLD space (a child of the camera's `worldLayer`, BELOW the sprite layer) so the wash pans
 * and zooms with the ground and a house/tree sprite still draws over it. Diamonds ride the terrain
 * lift. RETAINED: the composite is rebuilt only when the frame (band + blocked set) changes — a still
 * camera re-renders nothing; a pan in build mode re-composites two half-resolution textures, a cost
 * bounded by the screen (golden rule 6).
 *
 * The alpha/softness constants below are TUNED BY EYE against the original's build-mode look
 * (screenshot comparison) — the original exposes no measurable overlay parameters (source basis
 * "observed original behavior"; a human signs off the final feel).
 */

/** One HALF-CELL node of the probed band (integer col,row on the `2W×2H` lattice). */
export interface PlacementOverlayCell {
  readonly col: number;
  readonly row: number;
}

/**
 * One build-mode frame of the overlay: the visible NODE band the app probed, plus which of its nodes
 * REJECTED the held building's anchor. The buildable side is the band's complement of `blocked`.
 */
export interface PlacementOverlayFrame {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
  readonly blocked: readonly PlacementOverlayCell[];
}

/** The dim wash: near-black at a moderate alpha — enough to read "blocked" without hiding the ground. */
const DIM_COLOR = 0x000000;
const DIM_ALPHA = 0.42;
/** The buildable-side lift: additive white, faint — the original's slight contrast boost. */
const BRIGHT_ALPHA = 0.08;
/** Half-resolution compositing: halves the fill cost and linear-upscales into a soft, grid-free edge. */
const COMPOSITE_RESOLUTION = 0.5;
/** World-px pad each diamond grows by, so adjacent same-side cells fuse without hairline seams.
 *  Must exceed 2 COMPOSITE pixels (= 2 / COMPOSITE_RESOLUTION world px): at half resolution a smaller
 *  pad is sub-pixel, and the AA edges of neighbouring diamonds leave a visible bright seam lattice. */
const CELL_OVERLAP = 5;
/** Composite-texture allocation step (texture px) — see {@link PlacementOverlayLayer.ensureTextures}. */
const TEXTURE_QUANT = 128;

/** The world-space box of a band's composite, padded for the border diamonds + the terrain lift. */
export interface OverlayBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The world-space bounds of a band's composite: the node centres' extent grown on every side by a
 * border node diamond's half-extents (`TILE_HALF_W` × `TILE_HALF_H/2` — the rectangular node
 * lattice has no stagger overhang) plus the {@link CELL_OVERLAP} fusing pad each diamond grows by,
 * and by the map's max terrain lift upward. Pure — unit-testable without a GL context.
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
  /** The dim wash sprite (the blocked cells' fused diamonds), tinted dark + translucent. */
  private readonly dim = new Sprite();
  /** The buildable-side brightening sprite (the buildable cells' fused diamonds), additive + faint. */
  private readonly bright = new Sprite();
  private dimTexture: RenderTexture | null = null;
  private brightTexture: RenderTexture | null = null;
  /** The two retained composite sources, cleared + refilled per recomposite (never re-allocated). */
  private readonly blockedG = new Graphics();
  private readonly buildableG = new Graphics();
  /** Signature of the frame last composited; skips the rebuild when nothing changed frame-to-frame. */
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

  /**
   * Recomposite the wash for a build-mode frame; `null` clears it (build mode ended). Diamonds are
   * lifted onto the terrain like every projected item.
   */
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

    // Split the band into its two cell sets and build each side's fused-diamond surface (opaque
    // white in composite-texture space; each diamond grown by the overlap pad so neighbours merge
    // without hairline seams — overlap saturates, it never double-blends).
    const blocked = new Set<string>();
    for (const c of frame.blocked) blocked.add(`${c.col},${c.row}`);
    const lifted = elevation.maxLift > 0;
    const blockedG = this.blockedG.clear();
    const buildableG = this.buildableG.clear();
    // Per-NODE diamonds: the node lattice is a (HALF_W, HALF_H/2)-pitch rectangle, and a diamond of
    // half-extents (HALF_W, HALF_H/2) centred on every node covers the plane with overlap (the worst
    // gap point between four nodes lands exactly on four diamond edges) — overlap saturates in the
    // opaque composite, so same-side neighbours still fuse seamlessly.
    const hw = (TILE_HALF_W + CELL_OVERLAP) * COMPOSITE_RESOLUTION;
    const hh = (TILE_HALF_H / 2 + CELL_OVERLAP) * COMPOSITE_RESOLUTION;
    for (let row = frame.minRow; row <= frame.maxRow; row++) {
      for (let col = frame.minCol; col <= frame.maxCol; col++) {
        const p = halfCellToScreen(col, row);
        const cy = (p.y - (lifted ? elevation.liftAtNode(col, row) : 0) - bounds.y) * COMPOSITE_RESOLUTION;
        const cx = (p.x - bounds.x) * COMPOSITE_RESOLUTION;
        const g = blocked.has(`${col},${row}`) ? blockedG : buildableG;
        g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]);
      }
    }
    blockedG.fill(0xffffff);
    buildableG.fill(0xffffff);

    // One standard render per side; the scene-side sprites apply the tint/alpha/blend. The textures
    // may be quantized LARGER than the band — clear:true blanks the margin, so the sprites just show
    // transparent slack past the band's edge.
    this.renderer.render({ container: blockedG, target: dimTexture, clear: true });
    this.renderer.render({ container: buildableG, target: brightTexture, clear: true });

    for (const spr of [this.dim, this.bright]) {
      spr.position.set(bounds.x, bounds.y);
      spr.scale.set(1 / COMPOSITE_RESOLUTION);
      spr.visible = true;
    }
    this.dim.texture = dimTexture;
    this.bright.texture = brightTexture;
    // Mark the frame composited only now — an exception above (lost GL context, a failed alloc)
    // leaves the key unset, so the next frame retries instead of skipping on a stale signature.
    this.key = key;
  }

  /**
   * (Re)allocate the two composite textures — GROW-ONLY, in {@link TEXTURE_QUANT} steps. The visible
   * col/row count flaps N↔N+1 as a smooth pan crosses tile phase (`visibleTileRange` floors/ceils),
   * so exact-size allocation would destroy + recreate GPU textures every half tile of travel;
   * quantized grow-only allocation makes a steady pan allocation-free after the first composite.
   */
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

/** A cheap order-sensitive signature of a frame (band + a rolling mix of the blocked cells) so an
 *  unchanged frame skips the recomposite. The caller emits blocked cells in a fixed tile-scan order,
 *  so equal frames hash equal; a collision between two different same-length sets is tolerated (a
 *  stale cosmetic wash for one frame, self-correcting on the next change) — this only gates a redraw,
 *  never correctness. */
function signatureOf(frame: PlacementOverlayFrame): string {
  let h = frame.blocked.length | 0;
  for (const c of frame.blocked) {
    h = (Math.imul(h, 31) + Math.imul(c.col, 73856093) + Math.imul(c.row, 19349663)) | 0;
  }
  return `${frame.minCol},${frame.maxCol},${frame.minRow},${frame.maxRow}:${frame.blocked.length}:${h}`;
}
