import { Application, Assets, type Texture, type TextureSource } from 'pixi.js';

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
  preference: 'webgl',
  autoDensity: false,
  resolution: 1,
  // Left on, the shared ticker would render the stage before the first frame sets the camera transform.
  autoStart: false,
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
  const app = new Application();
  await app.init({ canvas, width, height, ...APP_OPTIONS });
  return app;
}

/** Match physical display pixels so the compositor does not resample the entire HUD. */
export function backingResolutionFor(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * The window renderer resolution: the device-pixel ratio times the caller's scale.
 * A scale below 1 trades crispness for fill-rate (the browser upscales the smaller backing store);
 * above 1 supersamples. A degenerate scale falls back to 1.
 */
export function windowResolutionFor(dpr: number, resolutionScale: number): number {
  const scale = Number.isFinite(resolutionScale) && resolutionScale > 0 ? resolutionScale : 1;
  return backingResolutionFor(dpr) * scale;
}

/**
 * Re-apply {@link backingResolutionFor} whenever the effective DPR changes (browser zoom, a move to a
 * differently scaled monitor). The matchMedia query only matches the current DPR, so each fire
 * re-subscribes at the new value; the resize listener backstops browsers without `resolution` queries,
 * where zooming still fires a window resize. The listeners live for the page: a window Application is
 * never destroyed before navigation.
 */
function watchBackingResolution(app: Application, resolutionScale: number): void {
  const apply = (): void => {
    const next = windowResolutionFor(window.devicePixelRatio || 1, resolutionScale);
    if (next !== app.renderer.resolution) {
      app.renderer.resize(window.innerWidth, window.innerHeight, next);
    }
  };
  window.addEventListener('resize', apply);
  if (typeof window.matchMedia !== 'function') return;
  const subscribe = (): void => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        apply();
        subscribe();
      },
      { once: true },
    );
  };
  subscribe();
}

export interface WindowPixiAppOptions {
  /** Multiplier over the DPR-derived backing resolution; see {@link windowResolutionFor}. */
  readonly resolutionScale?: number;
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
  const app = new Application();
  await app.init({
    canvas,
    // `resizeTo` already sizes the renderer during init; these guard against that ever becoming deferred.
    width: window.innerWidth,
    height: window.innerHeight,
    resizeTo: window,
    ...APP_OPTIONS,
    resolution: windowResolutionFor(window.devicePixelRatio || 1, resolutionScale),
    autoDensity: true, // CSS-size the canvas to the logical size, so client px stay 1:1 with screen px
  });
  watchBackingResolution(app, resolutionScale);
  return app;
}

/**
 * Load a decoded atlas PNG as a Pixi {@link TextureSource}. The default `nearest` keeps pixel-art bobs
 * crisp; ground texture pages pass `linear`.
 *
 * `alpha: 'straight'` is required for palette-indexed sheets (`<stem>.indexed`): their red channel is a
 * palette index, not colour, so Pixi's default premultiply-on-upload would scale the index by the frame's
 * graded coverage and every feathered pixel would look up the wrong LUT entry. `data.alphaMode:
 * 'premultiplied-alpha'` is Pixi's only hook that decodes the bitmap with `premultiplyAlpha: 'none'`;
 * relabelling the source `no-premultiply-alpha` then keeps the bytes raw through upload. The
 * `PalettedSprite` shader premultiplies its own output; RGB atlases keep Pixi's premultiplied default.
 */
export async function loadAtlasSource(
  url: string,
  scaleMode: 'nearest' | 'linear' = 'nearest',
  alpha: 'premultiplied' | 'straight' = 'premultiplied',
): Promise<TextureSource> {
  const texture =
    alpha === 'straight'
      ? ((await Assets.load({ src: url, data: { alphaMode: 'premultiplied-alpha' } })) as Texture)
      : ((await Assets.load(url)) as Texture);
  if (alpha === 'straight') texture.source.alphaMode = 'no-premultiply-alpha';
  texture.source.scaleMode = scaleMode;
  return texture.source;
}
