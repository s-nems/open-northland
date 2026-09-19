import {
  type AtlasFrame,
  type DrawableResource,
  isDrawableResource,
  layerLutRow,
  type PlayerColourLut,
  type ResolvedLayer,
  readable2dContext,
} from '@open-northland/render';

/** One atlas frame as a 2d canvas can draw it: the image and the rect to take from it. */
export interface FigureFrameImage {
  readonly image: DrawableResource;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Cached recoloured frames past this count are dropped together; a crowd of trades and colours refills it. */
const MAX_CACHED_FRAMES = 1024;
/** The LUT's column count: one per palette index. */
const LUT_WIDTH = 256;
const CHANNELS = 4;

/**
 * Settler frames for 2d canvases. A baked sheet's frame is its atlas image; an indexed sheet's frame is
 * recoloured on the CPU through the player LUT row, as the paletted shader does on the GPU, and cached
 * per (frame, row). Nothing here needs the GPU, so a DOM element can draw the figure the map draws.
 */
export class FigureFrames {
  private readonly recoloured = new WeakMap<AtlasFrame, Map<number, HTMLCanvasElement | null>>();
  /** Every frame with a cached recolour, so the cache can be emptied wholesale: a WeakMap cannot be
   *  cleared, but dropping the per-frame maps lets the frames be rebuilt. */
  private readonly cachedFrames = new Set<AtlasFrame>();
  private cached = 0;
  private lut: ImageData | null | undefined;

  constructor(private readonly palette: PlayerColourLut | undefined) {}

  /** `row` is the LUT row the layer reads; ignored by a baked sheet. Null when the source cannot be
   *  drawn (a GPU-only resource) or the palette cannot be read. */
  frame(layer: ResolvedLayer, row: number): FigureFrameImage | null {
    const { frame } = layer;
    const resource: unknown = layer.source.resource;
    if (!isDrawableResource(resource)) return null;
    if (this.palette === undefined) {
      return { image: resource, x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    }
    let rows = this.recoloured.get(frame);
    let image = rows?.get(row);
    if (image === undefined) {
      if (this.cached >= MAX_CACHED_FRAMES) {
        for (const other of this.cachedFrames) this.recoloured.delete(other);
        this.cachedFrames.clear();
        this.cached = 0;
        rows = undefined;
      }
      if (rows === undefined) {
        rows = new Map();
        this.recoloured.set(frame, rows);
        this.cachedFrames.add(frame);
      }
      image = this.recolour(resource, frame, row);
      rows.set(row, image);
      this.cached += 1;
    }
    return image === null ? null : { image, x: 0, y: 0, width: frame.width, height: frame.height };
  }

  /** Draw a figure's resolved layers with its feet at (`feetX`, `feetY`), `zoom` canvas px per map
   *  px. `bodyRow` is the settler's own LUT row, which a layer may override. */
  draw(
    ctx: CanvasRenderingContext2D,
    layers: readonly ResolvedLayer[],
    bodyRow: number,
    zoom: number,
    feetX: number,
    feetY: number,
  ): void {
    for (const layer of layers) {
      const row = this.palette === undefined ? bodyRow : layerLutRow(this.palette, layer, bodyRow);
      const image = this.frame(layer, row);
      if (image === null) continue;
      const s = zoom * layer.scale;
      ctx.imageSmoothingEnabled = layer.source.scaleMode !== 'nearest';
      ctx.drawImage(
        image.image,
        image.x,
        image.y,
        image.width,
        image.height,
        feetX + (layer.dx ?? 0) * zoom + layer.frame.offsetX * s,
        feetY + (layer.dy ?? 0) * zoom + layer.frame.offsetY * s,
        image.width * s,
        image.height * s,
      );
    }
  }

  private recolour(source: DrawableResource, frame: AtlasFrame, row: number): HTMLCanvasElement | null {
    const lut = this.readLut();
    if (lut === null || frame.width === 0 || frame.height === 0) return null;
    const scratch = readable2dContext(frame.width, frame.height);
    if (scratch === null) return null;
    scratch.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    const indexed = scratch.getImageData(0, 0, frame.width, frame.height);
    const out = new ImageData(frame.width, frame.height);
    const lutRow = Math.min(Math.max(row, 0), lut.height - 1) * LUT_WIDTH * CHANNELS;
    for (let i = 0; i < indexed.data.length; i += CHANNELS) {
      // Red carries the palette index, alpha the coverage; an unwritten pixel stays clear. The canvas
      // round trip premultiplies, so a partly covered pixel's index is approximate; the shipped atlases
      // carry only full or empty coverage.
      const coverage = indexed.data[i + 3] ?? 0;
      if (coverage === 0) continue;
      const at = lutRow + (indexed.data[i] ?? 0) * CHANNELS;
      out.data[i] = lut.data[at] ?? 0;
      out.data[i + 1] = lut.data[at + 1] ?? 0;
      out.data[i + 2] = lut.data[at + 2] ?? 0;
      out.data[i + 3] = coverage;
    }
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  private readLut(): ImageData | null {
    if (this.lut !== undefined) return this.lut;
    const palette = this.palette;
    const resource: unknown = palette?.source.resource;
    if (palette === undefined || !isDrawableResource(resource)) {
      this.lut = null;
      return null;
    }
    const ctx = readable2dContext(LUT_WIDTH, palette.colours);
    if (ctx === null) {
      this.lut = null;
      return null;
    }
    ctx.drawImage(resource, 0, 0);
    const lut = ctx.getImageData(0, 0, LUT_WIDTH, palette.colours);
    this.lut = lut;
    return lut;
  }
}
