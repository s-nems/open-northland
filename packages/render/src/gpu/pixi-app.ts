import { Application, Assets, type Texture, type TextureSource } from 'pixi.js';

/**
 * The one-time Pixi GPU boot the renderer's async setup runs once ({@link createPixiApp},
 * {@link createWindowPixiApp}, {@link loadAtlasSource}); the per-frame drawing moved to the retained
 * {@link import('./world-renderer.js').WorldRenderer} (persistent scene graph, pooled sprites, terrain
 * meshed once), and the plain-data input SHAPES the renderer consumes moved out to
 * {@link import('./sprite-sheet.js')} (settler {@link import('./sprite-sheet.js').SpriteSheet}) and
 * {@link import('./terrain-textures.js')} (the {@link import('./terrain-textures.js').TerrainTextureSet}).
 * The {@link import('../data/iso.js').Camera} transform lives alongside the projection math it inverts.
 *
 * The atlas *image* comes from a free / synthetic atlas (real bobs are decoded from a copyrighted game
 * copy and gitignored — see AGENTS.md "Legal guardrails"); the frame *geometry* + *bindings* are plain
 * data. Floats everywhere are fine: this is `render`, never read back into the deterministic sim.
 */

/**
 * The shared one-time GPU options. WebGL preference + antialias-off are deliberate: they cut the
 * cross-machine pixel variance that would otherwise make even an eyeball-the-PNG comparison noisy
 * (golden-image diffs stay out of scope — see docs/TESTING.md). `resolution: 1` + `autoDensity: false`
 * keep the backing store in CSS pixels, so one world pixel is one CSS pixel at camera scale 1 — the
 * DETERMINISTIC default the fixed-size `?shot` capture depends on (its PNG bytes can't vary with the
 * machine's devicePixelRatio). The interactive window variant overrides these to render at DEVICE
 * resolution — see {@link createWindowPixiApp}.
 */
const APP_OPTIONS = {
  // Pure black, like the original's void beyond the map edge: the `embr` border fade runs the ground
  // to (0,0,0), and any other clear colour re-exposes the edge diamonds as a sawtooth silhouette
  // (observed against the reference corpus — its off-map area is exactly #000).
  background: 0x000000,
  antialias: false,
  preference: 'webgl',
  autoDensity: false,
  resolution: 1,
  // No Pixi auto-render ticker: EVERY consumer (WorldRenderer.update, animationGallery.update, the shot
  // entry) drives its own RAF loop and calls `app.render()` explicitly with the camera already applied.
  // Left on (the default), Pixi's shared ticker renders the stage the instant a layer is populated —
  // BEFORE the first frame sets the camera transform — so the world flashes at the identity transform
  // (tile 0,0 pinned to screen origin) and then JUMPS to the start focus. Off, the canvas stays black
  // through loading and the first pixels the user sees are already framed on the start (no screen jerk).
  autoStart: false,
} as const;

/**
 * Initialise a Pixi {@link Application} bound to an existing canvas at a FIXED backing-store size.
 * Separated from drawing so the (async) GPU init runs once; the renderer's `update` is then a cheap
 * synchronous redraw. This is the deterministic-capture variant (the `?shot` PNG must be
 * byte-reproducible, so its dimensions can never track a window) — an interactive entry wants
 * {@link createWindowPixiApp} instead.
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
 * Initialise a Pixi {@link Application} whose backing store TRACKS the window. Pixi's resize plugin
 * (`resizeTo: window`) re-sizes the renderer on every window resize, so with the canvas CSS-sized to
 * the viewport the world never stretches — resizing the window only grows/shrinks the visible field,
 * exactly like an RTS at native resolution. Interactive entries (live slice, scenes, gallery) boot
 * through this; read the live size from `app.screen` per frame, never from a captured constant.
 *
 * Renders at DEVICE resolution (`resolution: devicePixelRatio` + `autoDensity`): `app.screen`, the
 * camera, and every layout stay in CSS px, but the backing store holds one texel per device pixel, so
 * screen-space UI (the supersampled tool panel, text, rings) rasterizes crisp on HiDPI instead of
 * being nearest-upscaled by the browser. The nearest-sampled world pixel art is unaffected at integer
 * zooms (the same duplication moves from the browser's canvas upscale into GPU sampling). The
 * deterministic `?shot` capture keeps {@link createPixiApp}'s fixed `resolution: 1`, so its PNG never
 * varies with the machine's DPR. The DPR is read once at boot — a mid-session monitor/zoom change
 * keeps working, just at the boot density. Input handlers read `app.renderer.resolution` to map
 * client px → screen px (`view/camera.ts` `screenScale` in the app).
 */
export async function createWindowPixiApp(canvas: HTMLCanvasElement): Promise<Application> {
  const app = new Application();
  await app.init({
    canvas,
    // The plugin's `resizeTo` setter already sizes the renderer to the window during init; the
    // explicit dimensions only guard against that init-time resize ever becoming deferred.
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
 * Load a decoded atlas PNG (a `<name>.png` the `.bmd`→atlas build emits) as a Pixi {@link TextureSource}
 * ready to bind as a {@link import('./sprite-sheet.js').SpriteSheet.source}. The GPU/pixel twin of the pure
 * {@link import('../data/sprites/index.js').atlasFromManifest} — together they turn a decoded `<name>.{png,atlas.json}`
 * pair into a {@link import('./sprite-sheet.js').SpriteSheet}. The default `nearest` scaling keeps the pixel-art bobs crisp and cuts
 * the cross-machine sampling variance (matching {@link createPixiApp}'s antialias-off), so an
 * eyeball-the-PNG check stays meaningful; the GROUND texture pages pass `linear` instead — the original
 * samples its terrain pages bilinearly (source basis, docs/SOURCES.md "terrain tessellation"), which is
 * what melts the transition masks into smooth seams. Real bob atlases are decoded from a copyrighted
 * game copy and gitignored (see AGENTS.md "Legal guardrails"); this only takes a URL, so the *bytes*
 * never live in the repo — the app serves them from the gitignored `content/` over the dev/shot server,
 * exactly as `?map=` serves grids.
 */
export async function loadAtlasSource(
  url: string,
  scaleMode: 'nearest' | 'linear' = 'nearest',
): Promise<TextureSource> {
  const texture = (await Assets.load(url)) as Texture;
  texture.source.scaleMode = scaleMode;
  return texture.source;
}
