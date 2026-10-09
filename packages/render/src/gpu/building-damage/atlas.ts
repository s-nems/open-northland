import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { readable2dContext } from '../drawable-resource.js';
import { isMagnifiedTexture, markMagnifiedTexture, markPixelArtSource } from '../pixel-art-registry.js';
import { invalidateAlphaMask } from '../sprite-pool/alpha-mask.js';

const SIDE = 1024;
const CELL = 32;
const GRID = SIDE / CELL;
const MAX_PAGES = 4;
const PAD = 2;

export interface DamageTile {
  readonly texture: Texture;
  readonly page: DamagePage;
  readonly x: number;
  readonly y: number;
  readonly cols: number;
  readonly rows: number;
}

interface DamagePage {
  readonly context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  readonly source: CanvasSource;
  readonly occupied: Uint8Array;
  dirty: boolean;
}

/** Four shared pages at most (16 MiB RGBA). Damage leases colour tiles and demolition leases removal
 * masks in its own instance. Each owner returns slots at the end of its effect and handles saturation;
 * no per-house canvas. */
export class DamageAtlas {
  private readonly pages: DamagePage[] = [];
  private unavailable = false;

  allocate(width: number, height: number, original: Texture): DamageTile | null {
    const cols = Math.ceil((width + 2 * PAD) / CELL);
    const rows = Math.ceil((height + 2 * PAD) / CELL);
    if (cols > GRID || rows > GRID || width <= 0 || height <= 0 || this.unavailable) return null;
    for (let i = 0; i <= this.pages.length && i < MAX_PAGES; i++) {
      let page = this.pages[i];
      if (page === undefined) {
        const context = readable2dContext(SIDE, SIDE);
        if (context === null) {
          this.unavailable = true;
          return null;
        }
        page = {
          context,
          source: new CanvasSource({ resource: context.canvas, scaleMode: 'linear' }),
          occupied: new Uint8Array(GRID * GRID),
          dirty: false,
        };
        this.pages.push(page);
      }
      const cell = freeRectangle(page.occupied, cols, rows);
      if (cell === null) continue;
      const x = cell.x * CELL;
      const y = cell.y * CELL;
      fillCells(page.occupied, cell.x, cell.y, cols, rows, 1);
      const texture = new Texture({
        source: page.source,
        frame: new Rectangle(x + PAD, y + PAD, width, height),
      });
      if (isMagnifiedTexture(original)) {
        markPixelArtSource(page.source);
        markMagnifiedTexture(texture);
      }
      return { texture, page, x, y, cols, rows };
    }
    return null;
  }

  write(tile: DamageTile, data: Uint8ClampedArray, width: number, height: number): void {
    const ctx = tile.page.context;
    ctx.clearRect(tile.x, tile.y, tile.cols * CELL, tile.rows * CELL);
    const image = ctx.createImageData(width, height);
    image.data.set(data);
    ctx.putImageData(image, tile.x + PAD, tile.y + PAD);
    tile.page.dirty = true;
  }

  release(tile: DamageTile): void {
    fillCells(tile.page.occupied, tile.x / CELL, tile.y / CELL, tile.cols, tile.rows, 0);
    tile.texture.destroy();
  }

  flush(smooth: boolean): void {
    for (const page of this.pages) {
      page.source.scaleMode = smooth ? 'linear' : 'nearest';
      if (!page.dirty) continue;
      page.source.update();
      invalidateAlphaMask(page.source);
      page.dirty = false;
    }
  }

  destroy(): void {
    for (const page of this.pages) page.source.destroy();
    this.pages.length = 0;
  }
}

function freeRectangle(cells: Uint8Array, cols: number, rows: number): { x: number; y: number } | null {
  for (let y = 0; y <= GRID - rows; y++) {
    next: for (let x = 0; x <= GRID - cols; x++) {
      for (let dy = 0; dy < rows; dy++) {
        for (let dx = 0; dx < cols; dx++) if (cells[(y + dy) * GRID + x + dx] !== 0) continue next;
      }
      return { x, y };
    }
  }
  return null;
}

function fillCells(cells: Uint8Array, x: number, y: number, cols: number, rows: number, value: number): void {
  for (let dy = 0; dy < rows; dy++) cells.fill(value, (y + dy) * GRID + x, (y + dy) * GRID + x + cols);
}
