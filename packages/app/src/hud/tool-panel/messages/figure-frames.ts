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

/** The side of the one page every recoloured frame is packed into (px). A full page is emptied whole and
 *  refilled. Chrome gives every 2d canvas its own GPU surface until garbage collection, so a canvas per
 *  frame piled up thousands of them, exhausted macOS surfaces and cost the map its WebGL context. */
const PAGE_SIZE = 1024;
/** Clear px between packed frames, so a smoothed draw never samples a neighbour. */
const PAGE_GUTTER = 1;
/** The LUT's column count: one per palette index. */
const LUT_WIDTH = 256;
const CHANNELS = 4;

/** Row-by-row placement of rectangles on a fixed page; `null` once the page cannot take one more. */
export class ShelfPacker {
  private shelfY = 0;
  private shelfHeight = 0;
  private cursorX = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly gutter: number,
  ) {}

  place(width: number, height: number): { readonly x: number; readonly y: number } | null {
    if (width > this.width) return null;
    if (this.cursorX + width > this.width) {
      this.shelfY += this.shelfHeight + this.gutter;
      this.shelfHeight = 0;
      this.cursorX = 0;
    }
    if (this.shelfY + height > this.height) return null;
    const at = { x: this.cursorX, y: this.shelfY };
    this.cursorX += width + this.gutter;
    this.shelfHeight = Math.max(this.shelfHeight, height);
    return at;
  }

  reset(): void {
    this.shelfY = 0;
    this.shelfHeight = 0;
    this.cursorX = 0;
  }
}

/**
 * Settler frames for 2d canvases. A baked sheet's frame is its atlas image; an indexed sheet's frame is
 * recoloured on the CPU through the player LUT row, as the paletted shader does on the GPU, and cached
 * per (frame, row) on one shared page. Nothing here needs the GPU, so a DOM element can draw the figure
 * the map draws.
 */
export class FigureFrames {
  private readonly recoloured = new WeakMap<AtlasFrame, Map<number, FigureFrameImage | null>>();
  /** Every frame with a cached recolour, so the cache can be emptied wholesale: a WeakMap cannot be
   *  cleared, but dropping the per-frame maps lets the frames be rebuilt. */
  private readonly cachedFrames = new Set<AtlasFrame>();
  private readonly packer = new ShelfPacker(PAGE_SIZE, PAGE_SIZE, PAGE_GUTTER);
  private page: CanvasRenderingContext2D | null | undefined;
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
    const cached = this.recoloured.get(frame)?.get(row);
    if (cached !== undefined) return cached;
    // Looked up again: a recolour that fills the page empties the cache.
    const image = this.recolour(resource, frame, row);
    let perFrame = this.recoloured.get(frame);
    if (perFrame === undefined) {
      perFrame = new Map();
      this.recoloured.set(frame, perFrame);
      this.cachedFrames.add(frame);
    }
    perFrame.set(row, image);
    return image;
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

  private recolour(source: DrawableResource, frame: AtlasFrame, row: number): FigureFrameImage | null {
    const lut = this.readLut();
    const page = this.readPage();
    if (lut === null || page === null || frame.width === 0 || frame.height === 0) return null;
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
    let at = this.packer.place(frame.width, frame.height);
    if (at === null) {
      this.emptyPage(page);
      at = this.packer.place(frame.width, frame.height);
      if (at === null) return null;
    }
    page.putImageData(out, at.x, at.y);
    return { image: page.canvas, x: at.x, y: at.y, width: frame.width, height: frame.height };
  }

  /** Drop every cached recolour with the pixels they point at; the frames are rebuilt on demand. */
  private emptyPage(page: CanvasRenderingContext2D): void {
    for (const frame of this.cachedFrames) this.recoloured.delete(frame);
    this.cachedFrames.clear();
    this.packer.reset();
    page.clearRect(0, 0, PAGE_SIZE, PAGE_SIZE);
  }

  private readPage(): CanvasRenderingContext2D | null {
    if (this.page !== undefined) return this.page;
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_SIZE;
    canvas.height = PAGE_SIZE;
    this.page = canvas.getContext('2d');
    return this.page;
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
