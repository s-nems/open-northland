import {
  type AtlasFrame,
  createHumanPaletteColours,
  createHumanPaletteIdentity,
  type DrawableResource,
  type DrawItem,
  GLOW_PALETTE_INDEX,
  HUMAN_PALETTE_BYTES,
  HumanPaletteCache,
  type HumanPaletteColours,
  humanPaletteIdentity,
  isDrawableResource,
  type PaletteLut,
  type ResolvedLayer,
  readable2dContext,
  type SpriteSheet,
  vehicleLutRow,
  vehiclePalette,
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
/** A LUT's column count: one per palette index. */
const LUT_WIDTH = 256;
const CHANNELS = 4;
const RGB = 3;

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

/** A palette whose every index takes `source`'s glow colour ({@link GLOW_PALETTE_INDEX}), so a recolour
 *  through it keeps only the frame's coverage. */
export function flatGlowPalette(source: Uint8Array): Uint8Array {
  const colour = source.subarray(GLOW_PALETTE_INDEX * RGB, (GLOW_PALETTE_INDEX + 1) * RGB);
  const flat = new Uint8Array(HUMAN_PALETTE_BYTES);
  for (let at = 0; at < flat.length; at += RGB) flat.set(colour, at);
  return flat;
}

/**
 * The palette `layer` is recoloured through: `glow` for a hero glow copy, else the head or body palette,
 * or none for a baked look. Null leaves the layer out: a shadow, whose page holds a mask for the map's
 * shadow pass, and a glow copy of a look without palettes, which the map leaves out too.
 */
export function layerColours(
  layer: ResolvedLayer,
  palettes: HumanPaletteColours | undefined,
  glow: Uint8Array | undefined,
): Uint8Array | undefined | null {
  if (layer.shadow === true) return null;
  if (layer.glow !== undefined) return glow ?? null;
  if (palettes === undefined) return undefined;
  return layer.head === true ? palettes.head : palettes.body;
}

/**
 * The palettes a figure's layers are recoloured through: an indexed human's own composed palettes, the
 * ship LUT row of an indexed vehicle, or none for a baked look.
 */
class FigurePalettes {
  private readonly humans: HumanPaletteCache | undefined;
  private readonly identity = createHumanPaletteIdentity({ body: '', head: '', random: [] });
  private readonly lutRows = new Map<PaletteLut, LutRowColours>();
  private readonly teamGlows = new Map<number, Uint8Array>();
  private readonly ownGlows = new WeakMap<Uint8Array, Uint8Array>();

  constructor(private readonly sheet: SpriteSheet | undefined) {
    const book = sheet?.palette?.book;
    this.humans = book === undefined ? undefined : new HumanPaletteCache(book);
  }

  /** A hero glow's flat palette for `item`, whose own palettes are `colours`: a human reads its owner's
   *  team ramp, which its own rolled palettes may have recoloured, and any other look its own body
   *  palette, as the map's glow does. */
  glow(item: DrawItem, colours: HumanPaletteColours): Uint8Array {
    const book = this.sheet?.palette?.book;
    if (item.kind !== 'settler' || book === undefined) {
      let flat = this.ownGlows.get(colours.body);
      if (flat === undefined) {
        flat = flatGlowPalette(colours.body);
        this.ownGlows.set(colours.body, flat);
      }
      return flat;
    }
    const player = item.player ?? 0;
    let flat = this.teamGlows.get(player);
    if (flat === undefined) {
      const team = createHumanPaletteColours();
      book.composeTeam(player, team);
      flat = flatGlowPalette(team.body);
      this.teamGlows.set(player, flat);
    }
    return flat;
  }

  of(item: DrawItem): HumanPaletteColours | undefined {
    if (this.humans !== undefined && humanPaletteIdentity(this.sheet, item, this.identity)) {
      return this.humans.colours(item.ref, this.identity);
    }
    if (item.kind !== 'vehicle') return undefined;
    const palette = vehiclePalette(this.sheet, item);
    if (palette === undefined) return undefined;
    let rows = this.lutRows.get(palette);
    if (rows === undefined) {
      rows = new LutRowColours(palette);
      this.lutRows.set(palette, rows);
    }
    return rows.row(vehicleLutRow(palette, item.player)) ?? undefined;
  }
}

/** A served LUT texture's rows as palettes, read back once and kept per row. */
class LutRowColours {
  private pixels: ImageData | null | undefined;
  private readonly rows = new Map<number, HumanPaletteColours | null>();

  constructor(private readonly palette: PaletteLut) {}

  row(row: number): HumanPaletteColours | null {
    const held = this.rows.get(row);
    if (held !== undefined) return held;
    const pixels = this.read();
    let colours: HumanPaletteColours | null = null;
    if (pixels !== null) {
      const rgb = new Uint8Array(HUMAN_PALETTE_BYTES);
      const start = Math.min(Math.max(row, 0), pixels.height - 1) * LUT_WIDTH * CHANNELS;
      for (let i = 0; i < LUT_WIDTH; i++) {
        rgb[i * RGB] = pixels.data[start + i * CHANNELS] ?? 0;
        rgb[i * RGB + 1] = pixels.data[start + i * CHANNELS + 1] ?? 0;
        rgb[i * RGB + 2] = pixels.data[start + i * CHANNELS + 2] ?? 0;
      }
      colours = { body: rgb, head: rgb };
    }
    this.rows.set(row, colours);
    return colours;
  }

  private read(): ImageData | null {
    if (this.pixels !== undefined) return this.pixels;
    this.pixels = null;
    const resource: unknown = this.palette.source.resource;
    if (!isDrawableResource(resource)) return null;
    const ctx = readable2dContext(LUT_WIDTH, this.palette.colours);
    if (ctx === null) return null;
    ctx.drawImage(resource, 0, 0);
    this.pixels = ctx.getImageData(0, 0, LUT_WIDTH, this.palette.colours);
    return this.pixels;
  }
}

/**
 * Settler or vehicle frames for 2d canvases. A baked look's frame is its atlas image; an indexed look's
 * frame is recoloured on the CPU through its palette, as the paletted shader does on the GPU, and cached
 * per (frame, palette) on one shared page. Nothing here needs the GPU, so a DOM element can draw the
 * figure the map draws.
 */
export class FigureFrames {
  private readonly recoloured = new WeakMap<AtlasFrame, Map<Uint8Array, FigureFrameImage | null>>();
  /** Every frame with a cached recolour, so the cache can be emptied wholesale: a WeakMap cannot be
   *  cleared, but dropping the per-frame maps lets the frames be rebuilt. */
  private readonly cachedFrames = new Set<AtlasFrame>();
  private readonly packer = new ShelfPacker(PAGE_SIZE, PAGE_SIZE, PAGE_GUTTER);
  private readonly palettes: FigurePalettes;
  private page: CanvasRenderingContext2D | null | undefined;

  constructor(sheet: SpriteSheet | undefined) {
    this.palettes = new FigurePalettes(sheet);
  }

  /** `colours` is the RGB palette the layer reads; undefined draws the atlas as it is. Null when the
   *  source cannot be drawn (a GPU-only resource). */
  frame(layer: ResolvedLayer, colours: Uint8Array | undefined): FigureFrameImage | null {
    const { frame } = layer;
    const resource: unknown = layer.source.resource;
    if (!isDrawableResource(resource)) return null;
    if (colours === undefined) {
      return { image: resource, x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    }
    const cached = this.recoloured.get(frame)?.get(colours);
    if (cached !== undefined) return cached;
    // Looked up again: a recolour that fills the page empties the cache.
    const image = this.recolour(resource, frame, colours);
    let perFrame = this.recoloured.get(frame);
    if (perFrame === undefined) {
      perFrame = new Map();
      this.recoloured.set(frame, perFrame);
      this.cachedFrames.add(frame);
    }
    perFrame.set(colours, image);
    return image;
  }

  /** Draw `item`'s resolved layers with its feet at (`feetX`, `feetY`), `zoom` canvas px per map px, a
   *  hero glow copy at its own opacity. */
  draw(
    ctx: CanvasRenderingContext2D,
    layers: readonly ResolvedLayer[],
    item: DrawItem,
    zoom: number,
    feetX: number,
    feetY: number,
  ): void {
    const palettes = this.palettes.of(item);
    for (const layer of layers) {
      const glow =
        layer.glow === undefined || palettes === undefined ? undefined : this.palettes.glow(item, palettes);
      const colours = layerColours(layer, palettes, glow);
      if (colours === null) continue;
      const image = this.frame(layer, colours);
      if (image === null) continue;
      const s = zoom * layer.scale;
      ctx.imageSmoothingEnabled = layer.source.scaleMode !== 'nearest';
      ctx.globalAlpha = layer.glow ?? 1;
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
    ctx.globalAlpha = 1;
  }

  private recolour(
    source: DrawableResource,
    frame: AtlasFrame,
    colours: Uint8Array,
  ): FigureFrameImage | null {
    const page = this.readPage();
    if (page === null || frame.width === 0 || frame.height === 0) return null;
    const scratch = readable2dContext(frame.width, frame.height);
    if (scratch === null) return null;
    scratch.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
    const indexed = scratch.getImageData(0, 0, frame.width, frame.height);
    const out = new ImageData(frame.width, frame.height);
    for (let i = 0; i < indexed.data.length; i += CHANNELS) {
      // Red carries the palette index, alpha the coverage; an unwritten pixel stays clear. The canvas
      // round trip premultiplies, so a partly covered pixel's index is approximate; the shipped atlases
      // carry only full or empty coverage.
      const coverage = indexed.data[i + 3] ?? 0;
      if (coverage === 0) continue;
      const at = (indexed.data[i] ?? 0) * RGB;
      out.data[i] = colours[at] ?? 0;
      out.data[i + 1] = colours[at + 1] ?? 0;
      out.data[i + 2] = colours[at + 2] ?? 0;
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
}
