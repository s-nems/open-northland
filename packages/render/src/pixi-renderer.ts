import { Application, Assets, type Texture, type TextureSource } from 'pixi.js';
import type { ByJobTable, SettlerStateBinding, SpriteAtlas, SpriteBindings, SpriteKind } from './sprites.js';
import type { CellTexture } from './terrain.js';

/**
 * The Pixi boot + GPU-input types shared by the renderer. The per-frame drawing moved to the retained
 * {@link import('./world-renderer.js').WorldRenderer} (persistent scene graph, pooled sprites, terrain
 * meshed once) — this file keeps only the one-time GPU setup ({@link createPixiApp},
 * {@link loadAtlasSource}) and the plain-data input shapes the renderer consumes ({@link Camera},
 * {@link SpriteSheet}, {@link SpriteLayer}, {@link TerrainTextureSet}).
 *
 * The atlas *image* comes from a free / synthetic atlas (real bobs are decoded from a copyrighted game
 * copy and gitignored — see CLAUDE.md "Legal guardrails"); the frame *geometry* + *bindings* are plain
 * data. Floats everywhere are fine: this is `render`, never read back into the deterministic sim.
 */

/** A camera transform applied to every projected screen position before drawing. */
export interface Camera {
  /** Pixel offset added to every item's screen position (pan). */
  readonly offsetX: number;
  readonly offsetY: number;
  /**
   * Uniform zoom factor (1 = no scale). Magnifies the whole scene about the layer origin, so a small
   * pixel-art bob is large enough for a human to judge decode fidelity. Applied as the draw layer's
   * scale, with {@link offsetX}/{@link offsetY} as the layer position — so `screen = world*scale +
   * offset`. Defaults to 1.
   */
  readonly scale?: number;
}

/**
 * One drawable atlas layer: a GPU {@link TextureSource} paired with its {@link SpriteAtlas} frame
 * geometry. Overlay layers ({@link SpriteSheet.overlays}) share the body's resolved bob id, so a
 * settler's head bob (same id, a separate `cr_hum_head` atlas) draws on top of the body bob — the
 * original composes a human from layered body + head bob sets, not one sprite.
 */
export interface SpriteLayer {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
}

/**
 * One composited settler LOOK — the original's `[jobbasegraphics]` record: a body bob set, the head
 * looks that overlay it, and the per-state animation binding played from that body's own `[bobseq]`
 * ranges. Several jobs may share one character (the whole soldier family is the armoured
 * `cr_hum_body_05`; every unmapped trade is the generic man), and each body's sequences live in its OWN
 * frame-id space — which is why the binding travels WITH the layers instead of staying a sheet-global.
 */
export interface SettlerCharacter {
  /** The body bob atlas — the base layer, whose `[bobseq]` ranges the {@link SettlerCharacter.binding} indexes. */
  readonly body: SpriteLayer;
  /**
   * The head looks that can overlay this body (the `gfxbobmanagerhead` slots), drawn at the same bob id
   * as the body frame. The renderer picks ONE per individual — stable by entity id — so a crowd shows
   * varied faces the way the original's per-individual random head does. Empty/omitted for a body-only
   * character (the baby, whose head is baked into the body bob).
   */
  readonly heads?: readonly SpriteLayer[];
  /** The per-state animation binding resolved against this body's own `[bobseq]` frame ranges. */
  readonly binding: SettlerStateBinding;
  /**
   * The binding the HEAD overlay resolves through when it must differ from {@link binding} — the
   * head-borrow case: most carry-walk variants ship EMPTY head bobs (the head is authored once, on the
   * base walk), so their head plays the walk range at the same (facing, frame) offset while the body
   * carries the load. Absent, heads resolve at the body's own bob id (the usual case).
   */
  readonly headBinding?: SettlerStateBinding;
}

/**
 * The per-job settler character table ({@link ByJobTable} of {@link SettlerCharacter}) — the render-side
 * `[jobbasegraphics]` join: an item's `jobType` (+ its young flag, see {@link ByJobTable}) picks which
 * body/heads/binding compose the settler. When a sheet carries one, settlers draw through it INSTEAD of
 * the sheet-global `bindings.settler` + `source`/`overlays` pair (which remain the fallback shape for a
 * sheet without characters — the synthetic atlas — so old sheets draw byte-identically).
 */
export type SettlerCharacterSet = ByJobTable<SettlerCharacter>;

/**
 * A loaded bob atlas ready for the GPU: the atlas image as a Pixi {@link TextureSource} plus the pure
 * {@link SpriteAtlas} frame geometry and per-kind {@link SpriteBindings} the frame lookup needs. Optional
 * input to the renderer: when present, bound sprite kinds draw their atlas frame; when absent (or a
 * kind/frame doesn't resolve) the placeholder geometry draws instead. The atlas *image* comes from a
 * free / synthetic atlas (real bobs are gitignored); the frame *geometry* + *bindings* are plain data.
 *
 * `overlays` are extra layers drawn on top of the body in order, each indexed by the **same** resolved
 * bob id (the head bob shares the body's frame numbering) — this is how a layered body + head settler
 * is composed. A layer that lacks the id (or has a 0×0 frame there) is simply skipped for that bob.
 */
export interface SpriteSheet {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly bindings: SpriteBindings;
  readonly overlays?: readonly SpriteLayer[];
  /**
   * Per-kind **dedicated** atlas layers. The base `source`/`atlas` (+ `overlays`) is the human body+head
   * set, whose bob-id space is the human bobs; a settler draws from it. A `resource` (a tree from
   * `ls_trees.bmd`) or a `building` (its own house `.bmd`) has a **different** decoded atlas with its own
   * frame-id space, so it cannot share that id space. When a kind has an entry here, its resolved bob id
   * ({@link SpriteBindings}) is blitted from THIS layer's own `source`+`atlas` instead of the shared
   * body atlas — one feet-anchored sprite, no head overlay. A kind with no entry falls back to the shared
   * body+overlays path (the settler), and an unresolved/empty frame falls back to placeholder geometry.
   */
  readonly kindLayers?: Partial<Record<SpriteKind, SpriteLayer>>;
  /**
   * Per-kind **render scale** (default 1 = native bob pixels). A decoded bob is blitted 1:1, but the
   * source art for different kinds was authored at different scales relative to the settler — the
   * `ls_houses_*` building bobs draw ~6–10× the settler's height at native size, far larger than the
   * original showed them on-screen relative to a person. A kind listed here is drawn at that factor about
   * its FEET anchor (the anchor stays put, the sprite shrinks/grows around it), bringing the building back
   * into proportion with the native-scale settler + tree. A kind with no entry draws native (scale 1), so
   * the settler and the tree — whose proportion already reads right — are untouched.
   */
  readonly kindScales?: Partial<Record<SpriteKind, number>>;
  /**
   * Named **building family** atlas layers — the multi-`.bmd` building case. A viking settlement draws
   * its buildings from many `.bmd`s × palettes (`ls_houses_viking`, `ls_houses_viking4`, …), each a
   * separate decoded atlas with its OWN frame-id space, so the single {@link kindLayers}.`building` layer
   * can't address them all. A {@link import('./sprites.js').BuildingTypeBinding} entry may be
   * layer-qualified (`{ layer, bob }`); when it names a `layer` present here, the GPU blits its `bob` from
   * THIS family's own `source`+`atlas` (one feet-anchored sprite) instead of {@link kindLayers}.`building`.
   * A plain-number / unqualified building binding (and every non-`building` kind) ignores this map and
   * uses the {@link kindLayers} path, so a sheet without `families` draws byte-identically to before.
   */
  readonly families?: Readonly<Record<string, SpriteLayer>>;
  /**
   * Per-**family** render scale (default {@link kindScales}'s `building`, else 1) — the {@link families}
   * twin of {@link kindScales}, since each building `.bmd` was authored at its own size relative to the
   * settler. A family drawn from {@link families} shrinks/grows about its FEET anchor by this factor; a
   * family with no entry inherits the `building` kind scale, preserving the existing proportion.
   */
  readonly familyScales?: Readonly<Record<string, number>>;
  /**
   * Per-job settler **characters** (the `[jobbasegraphics]` job → body/head/animation join). When
   * present, a settler draws its job's {@link SettlerCharacter} — the armoured soldier body for the
   * soldier family, the woman/child bodies for theirs, the generic man for every unmapped job — instead
   * of the sheet-global body (`source`/`overlays`) + `bindings.settler`. Absent (the synthetic sheet, an
   * old caller), the sheet-global path draws exactly as before.
   */
  readonly characters?: SettlerCharacterSet;
}

/**
 * The loaded textured-terrain inputs (the GPU twin of the pure `terrain.ts` geometry): the decoded
 * ground-texture pages keyed by {@link CellTexture.pageKey}, plus the approximated typeId→{@link
 * CellTexture} lookup the app built from the `TerrainPattern` IR. Optional input to the renderer: when
 * present, terrain cells draw as textured diamonds sampling their page; a cell whose typeId has no
 * {@link CellTexture}, or whose page failed to load, falls back to a flat diamond (the
 * {@link CellTexture.fallbackColour} debug colour, else the default). When absent, every tile draws the
 * legacy flat diamond — the reproducible default the committed shot depends on.
 */
export interface TerrainTextureSet {
  /** Decoded `text_NNN` ground pages as GPU sources, keyed by {@link CellTexture.pageKey}. */
  readonly pages: ReadonlyMap<string, TextureSource>;
  /** The approximated per-landscape-typeId ground binding, or `undefined` when a typeId has no representative. */
  cellFor(typeId: number): CellTexture | undefined;
  /**
   * The 1:1 per-triangle pattern by `EditName` — the join a decoded map's `ground.patterns` names
   * resolve through (the `GfxPattern` IR row's page + the two triangles' pixel-coord UV tuples).
   * Optional: a set built without the full pattern table (or a map without ground lanes) falls back
   * to the approximated {@link cellFor} path.
   */
  groundFor?(name: string): GroundPattern | undefined;
}

/** One resolved 1:1 ground pattern: its texture page + the two triangles' 6-int UV pixel tuples. */
export interface GroundPattern {
  readonly pageKey: string;
  readonly coordsA: readonly number[];
  readonly coordsB: readonly number[];
}

/**
 * Initialise a Pixi {@link Application} bound to an existing canvas. Separated from drawing so the
 * (async) GPU init runs once; the renderer's `update` is then a cheap synchronous redraw. WebGL
 * preference + antialias-off are deliberate: they cut the cross-machine pixel variance that would
 * otherwise make even an eyeball-the-PNG comparison noisy (golden-image diffs stay out of scope — see
 * docs/TESTING.md).
 */
export async function createPixiApp(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<Application> {
  const app = new Application();
  await app.init({
    canvas,
    width,
    height,
    background: 0x1a1410,
    antialias: false,
    preference: 'webgl',
    autoDensity: false,
    resolution: 1,
  });
  return app;
}

/**
 * Load a decoded atlas PNG (a `<name>.png` the `.bmd`→atlas build emits) as a Pixi {@link TextureSource}
 * ready to bind as a {@link SpriteSheet.source}. The GPU/pixel twin of the pure
 * {@link import('./sprites.js').atlasFromManifest} — together they turn a decoded `<name>.{png,atlas.json}`
 * pair into a {@link SpriteSheet}. `nearest` scaling keeps the pixel-art bobs crisp and cuts the
 * cross-machine sampling variance (matching {@link createPixiApp}'s antialias-off), so an eyeball-the-PNG
 * check stays meaningful. Real bob atlases are decoded from a copyrighted game copy and gitignored (see
 * CLAUDE.md "Legal guardrails"); this only takes a URL, so the *bytes* never live in the repo — the app
 * serves them from the gitignored `content/` over the dev/shot server, exactly as `?map=` serves grids.
 */
export async function loadAtlasSource(url: string): Promise<TextureSource> {
  const texture = (await Assets.load(url)) as Texture;
  texture.source.scaleMode = 'nearest';
  return texture.source;
}
