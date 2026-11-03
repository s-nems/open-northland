import { Application, Assets, ImageSource, type Texture, type TextureSource } from 'pixi.js';
import { type AtlasSheetLayout, markIndexedSource, markPixelArtSource } from '../pixel-art/registry.js';
import { keepAtlasPageResident, registerAtlasPageUploader } from '../textures/atlas-residency.js';
import { registerHumanPaletteUploader } from '../textures/human-palette-lut.js';
import { registerRecolouredPageUploader } from '../textures/recoloured-pages.js';
import { registerWrittenPageUploader } from '../textures/written-page-source.js';
import { inheritParentGroupUniforms } from './inherited-group-uniforms.js';

/**
 * The shared one-time GPU options. WebGL preference and antialias-off cut cross-machine pixel variance.
 * `resolution: 1` + `autoDensity: false` keep the backing store in CSS pixels, so one world pixel is one
 * CSS pixel at camera scale 1, so a fixed-size `?shot` capture frames the same world box whatever the
 * machine's devicePixelRatio. {@link createWindowPixiApp} overrides these to render at the
 * native device resolution.
 */
const APP_OPTIONS = {
  // Pure black, like the original's void beyond the map edge (observed: its off-map area is exactly
  // #000). The `embr` border fade runs the ground to (0,0,0); any other clear colour re-exposes the
  // edge diamonds as a sawtooth silhouette.
  background: 0x000000,
  antialias: false,
  // A request for a dual-GPU machine's discrete adapter; Chrome on Windows decides by its own rules.
  powerPreference: 'high-performance',
  preference: 'webgl',
  autoDensity: false,
  resolution: 1,
  // Left on, the shared ticker would render the stage before the first frame sets the camera transform.
  autoStart: false,
  // The game takes input from DOM listeners and picks sprites itself; nothing listens to Pixi's
  // federated events. Left on, every pointer move walked the whole scene graph for a hit test, and a
  // handled event wrote an inline canvas cursor that outranks the stylesheet's world cursors.
  eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
} as const;

/**
 * Initialise a Pixi {@link Application} on an existing canvas at a fixed backing-store size, whose
 * dimensions can never track a window. Interactive entries want {@link createWindowPixiApp}.
 */
export async function createPixiApp(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<Application> {
  registerHumanPaletteUploader();
  registerWrittenPageUploader();
  registerAtlasPageUploader();
  registerRecolouredPageUploader();
  const app = new Application();
  await app.init({ canvas, width, height, ...APP_OPTIONS });
  inheritParentGroupUniforms(app.renderer);
  return app;
}

/** Match physical display pixels so the compositor does not resample the entire HUD. */
export function backingResolutionFor(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * How a window draws on a display denser than its CSS pixels. `native` draws every device pixel.
 * `whole` divides the backing store's ratio by its whole part, so a ratio of 2 or 3 draws one texel per CSS
 * pixel and 2.5 draws 1.25, and the canvas's nearest upscale (`image-rendering: pixelated`) repeats each
 * texel into an exact square of device pixels; a ratio under 2 has no whole factor and stays native, and
 * so does any render scale but 1, which no whole divisor turns into squares.
 * `sharp` and `xbr` keep the backing store native and draw only the world at one texel per CSS pixel
 * (times the render scale), which one pass then upscales with that magnifier; the rest of the stage
 * draws natively over it (see `OffscreenWorld`).
 */
export type BackingDensity = 'native' | 'whole' | 'sharp' | 'xbr';

const BACKING_DENSITIES: readonly BackingDensity[] = ['native', 'whole', 'sharp', 'xbr'];

/**
 * The stored choice: a {@link BackingDensity}, or `auto`, which draws natively on an ordinary display and
 * upscales the world on a dense one, keeping the player's filter choice (`xbr` with enhanced sampling on,
 * `sharp` with it off). Resolved once per window by {@link resolveBackingDensity}.
 */
export type BackingDensitySetting = BackingDensity | 'auto';

const BACKING_DENSITY_SETTINGS: readonly BackingDensitySetting[] = [...BACKING_DENSITIES, 'auto'];

/** A stored value as a {@link BackingDensitySetting}; null for anything else. */
export function parseBackingDensitySetting(value: unknown): BackingDensitySetting | null {
  return BACKING_DENSITY_SETTINGS.find((density) => density === value) ?? null;
}

/**
 * Device pixels per CSS pixel, times the render scale, from which `auto` stops drawing the world natively.
 * From 1.5 on the native world costs 3.5 to 7 times the 1:1 frame (docs/GRAPHICS.md, cost basis) and the
 * upscale enlarges evenly; below it a 1.25 display gains little and would upscale unevenly.
 */
export const AUTO_UPSCALE_RATIO = 1.5;

/** The density a window draws at under `setting`, given its device-pixel ratio, the render scale and
 *  whether enhanced sampling (the pixel-art filter) is on. */
export function resolveBackingDensity(
  setting: BackingDensitySetting,
  dpr: number,
  resolutionScale: number,
  filtered: boolean,
): BackingDensity {
  if (setting !== 'auto') return setting;
  if (windowResolutionFor(dpr, resolutionScale) < AUTO_UPSCALE_RATIO) return 'native';
  return filtered ? 'xbr' : 'sharp';
}

/** The world's own resolution and magnifier under an upscaling {@link BackingDensity}. */
export interface WorldUpscaleSetting {
  readonly filter: 'sharp' | 'xbr';
  /** World texels per CSS pixel. */
  readonly resolution: number;
}

const worldUpscales = new WeakMap<Application, WorldUpscaleSetting>();

/** What {@link createWindowPixiApp} asked of `app`'s world; null draws it at the backing resolution. */
export function worldUpscaleOf(app: Application): WorldUpscaleSetting | null {
  return worldUpscales.get(app) ?? null;
}

/** Whether `density` draws the world into a texture and upscales it. */
export function upscalesWorld(density: BackingDensity): density is 'sharp' | 'xbr' {
  return density === 'sharp' || density === 'xbr';
}

/** The world's upscale under `density` at a render scale; null for a density that draws it natively. */
export function worldUpscaleFor(
  density: BackingDensity,
  resolutionScale: number,
): WorldUpscaleSetting | null {
  if (!upscalesWorld(density)) return null;
  return { filter: density, resolution: windowResolutionFor(1, resolutionScale) };
}

/** A ratio this close under a whole number counts as it: a zoomed browser reports 1.9999999. */
const WHOLE_RATIO_TOLERANCE = 1e-4;

/**
 * The window renderer resolution: the device-pixel ratio, divided under `whole` density (see
 * {@link BackingDensity}), times the caller's scale. A scale below 1 trades crispness for fill-rate (the
 * browser upscales the smaller backing store); above 1 supersamples. A degenerate scale falls back to 1.
 */
export function windowResolutionFor(
  dpr: number,
  resolutionScale: number,
  density: BackingDensity = 'native',
): number {
  const scale = Number.isFinite(resolutionScale) && resolutionScale > 0 ? resolutionScale : 1;
  const ratio = backingResolutionFor(dpr);
  // Only an unscaled ratio divides into exact squares: at scale 1.5 the nearest upscale would be 4:3.
  const divisor =
    density === 'whole' && scale === 1 ? Math.max(1, Math.floor(ratio + WHOLE_RATIO_TOLERANCE)) : 1;
  return (ratio / divisor) * scale;
}

/**
 * Re-apply {@link backingResolutionFor} whenever the effective DPR changes (browser zoom, a move to a
 * differently scaled monitor). The matchMedia query only matches the current DPR, so each fire
 * re-subscribes at the new value; the resize listener backstops browsers without `resolution` queries,
 * where zooming still fires a window resize. Destroying the renderer releases every listener before
 * its context and screen disappear.
 */
function watchBackingResolution(app: Application, resolutionScale: number, density: BackingDensity): void {
  const scope = new AbortController();
  app.renderer.runners.destroy.add({ destroy: () => scope.abort() });
  const apply = (): void => {
    const next = windowResolutionFor(window.devicePixelRatio || 1, resolutionScale, density);
    if (next !== app.renderer.resolution) {
      app.renderer.resize(window.innerWidth, window.innerHeight, next);
    }
  };
  window.addEventListener('resize', apply, { signal: scope.signal });
  if (typeof window.matchMedia !== 'function') return;
  const subscribe = (): void => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        apply();
        subscribe();
      },
      { once: true, signal: scope.signal },
    );
  };
  subscribe();
}

export interface WindowPixiAppOptions {
  /** Multiplier over the DPR-derived backing resolution; see {@link windowResolutionFor}. */
  readonly resolutionScale?: number;
  /** `native` unless given; see {@link BackingDensity}. */
  readonly density?: BackingDensity;
}

/**
 * Initialise a Pixi {@link Application} whose backing store tracks the window (`resizeTo: window`), so
 * resizing grows or shrinks the visible field instead of stretching the world. Callers must read the
 * live size from `app.screen` per frame, never from a captured constant.
 *
 * Renders at {@link windowResolutionFor} texels per CSS px: `app.screen`, the camera, and every
 * layout stay in CSS px. At scale 1 the UI rasterizes at native display density.
 * The resolution follows live DPR changes; consumers that bake at a resolution must re-bake
 * when `app.renderer.resolution` moves.
 */
export async function createWindowPixiApp(
  canvas: HTMLCanvasElement,
  options?: WindowPixiAppOptions,
): Promise<Application> {
  const resolutionScale = options?.resolutionScale ?? 1;
  const density = options?.density ?? 'native';
  registerHumanPaletteUploader();
  registerWrittenPageUploader();
  registerAtlasPageUploader();
  registerRecolouredPageUploader();
  const app = new Application();
  await app.init({
    canvas,
    // `resizeTo` already sizes the renderer during init; these guard against that ever becoming deferred.
    width: window.innerWidth,
    height: window.innerHeight,
    resizeTo: window,
    ...APP_OPTIONS,
    resolution: windowResolutionFor(window.devicePixelRatio || 1, resolutionScale, density),
    autoDensity: true, // CSS-size the canvas to the logical size, so client px stay 1:1 with screen px
  });
  inheritParentGroupUniforms(app.renderer);
  const upscale = worldUpscaleFor(density, resolutionScale);
  if (upscale !== null) worldUpscales.set(app, upscale);
  watchBackingResolution(app, resolutionScale, density);
  return app;
}

/**
 * Load a decoded atlas sheet as a Pixi {@link TextureSource}. The default `nearest` keeps pixel-art bobs
 * crisp; ground texture pages pass `linear`. An `indexed` sheet (palette index in red, coverage in
 * green, opaque, blue 0) decodes like any other, since premultiplying an opaque image changes nothing;
 * its source is marked so the world batch reads coverage from green. It uploads as RG8, half the
 * memory of RGBA8, and samples as (r, g, 0, 1) exactly as the RGBA8 page did; CPU readers still read
 * the decoded RGBA bitmap.
 *
 * A `displacement` sheet holds values in red under a graded mask in alpha, which premultiplying would
 * scale. `data.alphaMode: 'premultiplied-alpha'` is Pixi's only hook that decodes the bitmap with
 * `premultiplyAlpha: 'none'`, and that label also uploads the bytes raw, so the shader reads them as
 * stored.
 */
export async function loadAtlasSource(
  url: string,
  scaleMode: 'nearest' | 'linear' = 'nearest',
  layout: AtlasSheetLayout = 'rgba',
): Promise<TextureSource> {
  // Blob URLs have no file extension, so Pixi cannot infer the texture parser from the URL.
  // Select it explicitly for every atlas source; keep displacement's decode option on that parser.
  const texture =
    layout === 'displacement'
      ? ((await Assets.load({
          src: url,
          parser: 'texture',
          data: { alphaMode: 'premultiplied-alpha' },
        })) as Texture)
      : ((await Assets.load({ src: url, parser: 'texture' })) as Texture);
  texture.source.scaleMode = scaleMode;
  // A nearest-loaded page is authored pixel art and may magnify edge-aware; ground pages stay linear.
  if (scaleMode === 'nearest') markPixelArtSource(texture.source);
  if (layout === 'indexed') {
    markIndexedSource(texture.source);
    texture.source.format = 'rg8unorm';
  }
  keepAtlasPageResident(texture.source);
  return texture.source;
}

/**
 * A pixel-art atlas page over a bitmap decoded with the platform defaults, set up as
 * {@link loadAtlasSource} sets up a premultiplied sheet it fetched: the source owns the bitmap.
 */
export function atlasSourceFromBitmap(bitmap: ImageBitmap): TextureSource {
  const source = new ImageSource({ resource: bitmap, alphaMode: 'premultiply-alpha-on-upload' });
  source.scaleMode = 'nearest';
  markPixelArtSource(source);
  keepAtlasPageResident(source);
  return source;
}
