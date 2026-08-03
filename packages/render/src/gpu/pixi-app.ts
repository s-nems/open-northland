import { Application, Assets, type Texture, type TextureSource } from 'pixi.js';

/**
 * The shared one-time GPU options. WebGL preference and antialias-off cut cross-machine pixel variance.
 * `resolution: 1` + `autoDensity: false` keep the backing store in CSS pixels, so one world pixel is one
 * CSS pixel at camera scale 1 - the fixed-size `?shot` capture's PNG bytes must not vary with the
 * machine's devicePixelRatio. {@link createWindowPixiApp} overrides these to render at device resolution.
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
  // Every consumer drives its own RAF loop and calls `app.render()` with the camera already applied.
  // Left on, the shared ticker would render the stage before the first frame sets the camera transform.
  autoStart: false,
} as const;

/**
 * Initialise a Pixi {@link Application} on an existing canvas at a fixed backing-store size: the `?shot`
 * PNG must be byte-reproducible, so its dimensions can never track a window. Interactive entries want
 * {@link createWindowPixiApp}.
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

/**
 * Initialise a Pixi {@link Application} whose backing store tracks the window (`resizeTo: window`), so
 * resizing grows or shrinks the visible field instead of stretching the world. Callers must read the
 * live size from `app.screen` per frame, never from a captured constant.
 *
 * Renders at device resolution: `app.screen`, the camera, and every layout stay in CSS px while the
 * backing store holds one texel per device pixel, so screen-space UI rasterizes crisp on HiDPI. The DPR
 * is read once at boot, so a mid-session monitor or zoom change keeps working at the boot density.
 */
export async function createWindowPixiApp(canvas: HTMLCanvasElement): Promise<Application> {
  const app = new Application();
  await app.init({
    canvas,
    // `resizeTo` already sizes the renderer during init; these guard against that ever becoming deferred.
    width: window.innerWidth,
    height: window.innerHeight,
    resizeTo: window,
    ...APP_OPTIONS,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true, // CSS-size the canvas to the logical size, so client px stay 1:1 with screen px
  });
  return app;
}

/**
 * Load a decoded atlas PNG as a Pixi {@link TextureSource}. The default `nearest` keeps pixel-art bobs
 * crisp; ground texture pages pass `linear` because the original samples its terrain pages bilinearly
 * (source basis: docs/SOURCES.md "terrain tessellation"), which melts the transition masks into seams.
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
