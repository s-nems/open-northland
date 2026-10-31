import { createHumanPaletteColours, type HumanPaletteBook } from '@open-northland/render';
import { type PalettedSheetRef, palettedSheetBitmap } from '../../../content/atlas-sheet/index.js';
import type { ContentIr } from '../../../content/ir/rows.js';
import { servedAtlas } from '../../../content/sprite-good-icons.js';
import { humanPaletteBook } from '../../../content/sprite-sheet/human-palettes.js';
import { diag } from '../../../diag/index.js';
import { type FilmLayer, type KnowledgeFilm, knowledgeFilm } from '../../knowledge/film.js';
import type { KnowledgeClip, KnowledgeMotion } from './context.js';

/** Css px per bob px: a figure reads at the size of the entry's stat sheet. */
const FILM_DISPLAY_SCALE = 1.6;
/** A coloured page nobody draws is closed this long after its last film, so a tab flicked back and forth
 *  decodes once and a closed window holds none. */
const IDLE_SHEET_MS = 20_000;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One bob placed on the film's canvas. */
export interface FilmPart extends Rect {
  /** Index of the page it is cut from. */
  readonly page: number;
  readonly sx: number;
  readonly sy: number;
}

/** The step a looping clip shows `elapsedMs` after it started. */
export function filmStep(elapsedMs: number, stepMs: number, steps: number): number {
  return Math.floor(elapsedMs / stepMs) % steps;
}

/** A frame as the served manifest lists it. */
interface SheetFrame {
  readonly bobId: number;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The canvas size and each step's parts, on one origin over the whole clip so the figure stays put. A step
 *  without its body is left out; a head with no bob at a step is left off that step. */
export function layoutFilm(stepsOfLayers: readonly (readonly (SheetFrame | undefined)[])[]): {
  readonly width: number;
  readonly height: number;
  readonly steps: readonly (readonly FilmPart[])[];
} {
  const drawn = (frame: SheetFrame | undefined): frame is SheetFrame =>
    frame !== undefined && frame.rect.width > 0 && frame.rect.height > 0;
  const kept = (stepsOfLayers[0] ?? []).flatMap((body, step) => (drawn(body) ? [step] : []));
  const frames = kept.flatMap((step) => stepsOfLayers.map((layer) => layer[step]).filter(drawn));
  const left = Math.min(...frames.map((f) => f.offsetX));
  const top = Math.min(...frames.map((f) => f.offsetY));
  const right = Math.max(...frames.map((f) => f.offsetX + f.rect.width));
  const bottom = Math.max(...frames.map((f) => f.offsetY + f.rect.height));
  const steps = kept.map((step) =>
    stepsOfLayers.flatMap((layer, page) => {
      const frame = layer[step];
      if (!drawn(frame)) return [];
      const { x: sx, y: sy, width, height } = frame.rect;
      return [{ page, sx, sy, width, height, x: frame.offsetX - left, y: frame.offsetY - top }];
    }),
  );
  return frames.length === 0
    ? { width: 0, height: 0, steps: [] }
    : { width: right - left, height: bottom - top, steps };
}

/** A palette as the sheet workers take it. */
function paletteBase64(palette: Uint8Array): string {
  return btoa(String.fromCharCode(...palette));
}

interface HeldPage {
  readonly bitmap: Promise<ImageBitmap>;
  users: number;
  closeTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Coloured pages by sheet and palette, shared by whoever draws them, so one trade's three clips colour
 *  one page. */
export class ColouredPages {
  private readonly pages = new Map<string, HeldPage>();

  acquire(sheet: PalettedSheetRef): { readonly key: string; readonly bitmap: Promise<ImageBitmap> } {
    const key = `${sheet.image}:${sheet.palette}`;
    let page = this.pages.get(key);
    if (page === undefined) {
      page = { bitmap: palettedSheetBitmap(sheet), users: 0, closeTimer: undefined };
      this.pages.set(key, page);
      page.bitmap.catch(() => this.pages.delete(key));
    }
    clearTimeout(page.closeTimer);
    page.users += 1;
    return { key, bitmap: page.bitmap };
  }

  release(key: string): void {
    const page = this.pages.get(key);
    if (page === undefined) return;
    page.users -= 1;
    if (page.users > 0) return;
    page.closeTimer = setTimeout(() => {
      this.pages.delete(key);
      page.bitmap.then((bitmap) => bitmap.close()).catch(() => undefined);
    }, IDLE_SHEET_MS);
  }
}

/** The first of `stems` that serves a paletted sheet. */
async function servedLayer(layer: FilmLayer) {
  for (const stem of layer.stems) {
    const atlas = await servedAtlas(stem);
    if (atlas?.palette !== undefined) return { atlas, palette: atlas.palette };
  }
  return null;
}

/** Runs `step` once per display frame while `canvas` is on screen. The observer also reports a canvas
 *  taken out of the document or hidden with its window, so a closed window runs nothing. */
function runWhileVisible(canvas: HTMLCanvasElement, step: (now: number) => void): () => void {
  let frame: number | undefined;
  const halt = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick);
    step(now);
  };
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.at(-1)?.isIntersecting === true;
    if (!visible) halt();
    else frame ??= requestAnimationFrame(tick);
  });
  observer.observe(canvas);
  return () => {
    observer.disconnect();
    halt();
  };
}

/** The canvas of a film, ready to run; null when the sheets draw it nothing. */
async function loadFilm(
  film: KnowledgeFilm,
  book: HumanPaletteBook | undefined,
  pages: ColouredPages,
  held: string[],
): Promise<{ readonly canvas: HTMLCanvasElement; readonly run: (now: number) => void } | null> {
  const served = await Promise.all(film.layers.map(servedLayer));
  const colours = createHumanPaletteColours();
  if (film.identity !== undefined) book?.compose(film.identity, colours);
  const sheets = film.layers.flatMap((layer, index) => {
    const found = served[index];
    if (found === null || found === undefined) return [];
    const palette = layer.palette === undefined ? found.palette : paletteBase64(colours[layer.palette]);
    return [{ layer, atlas: found.atlas, sheet: { ...found.atlas, palette } }];
  });
  if (sheets.length === 0 || served[0] === null) return null;
  const layout = layoutFilm(
    sheets.map(({ layer, atlas }) => {
      const byBob = new Map(atlas.frames.map((frame) => [frame.bobId, frame]));
      return layer.bobs.map((bob) => byBob.get(bob));
    }),
  );
  if (layout.steps.length === 0) return null;
  const bitmaps = await Promise.all(
    sheets.map(({ sheet }) => {
      const page = pages.acquire(sheet);
      held.push(page.key);
      return page.bitmap;
    }),
  );
  const canvas = document.createElement('canvas');
  canvas.className = 'kn-film';
  canvas.width = layout.width;
  canvas.height = layout.height;
  canvas.style.width = `${layout.width * FILM_DISPLAY_SCALE}px`;
  canvas.style.height = `${layout.height * FILM_DISPLAY_SCALE}px`;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  let shown = -1;
  let started: number | undefined;
  const run = (now: number): void => {
    started ??= now;
    const step = filmStep(now - started, film.stepMs, layout.steps.length);
    if (step === shown) return;
    shown = step;
    ctx.clearRect(0, 0, layout.width, layout.height);
    for (const part of layout.steps[step] ?? []) {
      const page = bitmaps[part.page];
      if (page === undefined) continue;
      const { sx, sy, width, height, x, y } = part;
      ctx.drawImage(page, sx, sy, width, height, x, y, width, height);
    }
  };
  return { canvas, run };
}

/**
 * Looping previews on one canvas each, through the served sheets alone, so a film plays the same in the
 * main menu and for a tribe the running map does not field. Null in {@link KnowledgeArt} when the IR is
 * absent. A sheet is paletted: the composed palette colours its page in a worker, as the map's shader
 * colours it on the GPU.
 */
export function createKnowledgeMotion(ir: ContentIr): KnowledgeMotion {
  const book = humanPaletteBook(ir);
  const pages = new ColouredPages();
  return {
    play: (host, clip: KnowledgeClip) => {
      const film = knowledgeFilm(ir, book, clip);
      if (film === null) return null;
      const held: string[] = [];
      let halt: (() => void) | undefined;
      let stopped = false;
      const free = (): void => {
        for (const key of held) pages.release(key);
        held.length = 0;
      };
      loadFilm(film, book, pages, held)
        .then((loaded) => {
          if (stopped || loaded === null) {
            free();
            return;
          }
          host.append(loaded.canvas);
          const stopRunning = runWhileVisible(loaded.canvas, loaded.run);
          halt = () => {
            stopRunning();
            loaded.canvas.remove();
          };
        })
        .catch((error: unknown) => {
          free();
          diag.warn('hud', `knowledge film: ${String(error)}`);
        });
      return () => {
        stopped = true;
        halt?.();
        free();
      };
    },
  };
}
