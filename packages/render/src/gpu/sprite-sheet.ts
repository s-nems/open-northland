import type { TextureSource } from 'pixi.js';
import type {
  BuildTimeSheet,
  ByJobTable,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteBindings,
  SpriteKind,
} from '../data/sprites/index.js';

/**
 * The plain-data GPU-input shapes the renderer draws a settler world from — the loaded-atlas contract
 * between the app's content loader and {@link import('./sprite-pool/index.js').SpritePool}: frame
 * geometry + bindings + decoded `TextureSource`s. The one-time GPU boot that produces the sources lives
 * in {@link import('./pixi-app.js')}, the terrain twin in {@link import('./terrain-textures.js')}.
 *
 * The atlas *image* comes from a free / synthetic atlas (real bobs are decoded from a copyrighted game
 * copy and gitignored — see AGENTS.md "Legal guardrails"). Floats are fine: this is `render`, never read
 * back into the deterministic sim.
 */

/**
 * One drawable atlas layer: a GPU {@link TextureSource} paired with its {@link SpriteAtlas} frame
 * geometry. Overlay layers ({@link SpriteSheet.overlays}) share the body's resolved bob id, so a
 * settler's head bob (same id, a separate `cr_hum_head` atlas) draws on top of the body bob — the
 * original composes a human from layered body + head bob sets, not one sprite.
 */
export interface SpriteLayer {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  /**
   * CPU copy of the atlas's build-progress time sheet (the house atlases' sibling `.build.png`) —
   * present only when the manifest announced one. Feeds the per-pixel construction reveal
   * ({@link import('./texture-cache.js').TextureCache.revealed}); absent, an under-construction
   * building falls back to the bottom-up crop approximation.
   */
  readonly times?: BuildTimeSheet;
}

/**
 * One composited settler look — the original's `[jobbasegraphics]` record: a body bob set, the head
 * looks that overlay it, and the per-state animation binding played from that body's own `[bobseq]`
 * ranges. Several jobs may share one character (the whole soldier family is the armoured
 * `cr_hum_body_05`; every unmapped trade is the generic man), and each body's sequences live in its own
 * frame-id space, so the binding travels with the layers instead of staying a sheet-global.
 */
export interface SettlerCharacter {
  /** The body bob atlas — the base layer, whose `[bobseq]` ranges the {@link SettlerCharacter.binding} indexes. */
  readonly body: SpriteLayer;
  /**
   * The head looks that can overlay this body (the `gfxbobmanagerhead` slots), drawn at the same bob id
   * as the body frame. The renderer picks one per individual — stable by entity id — so a crowd shows
   * varied faces the way the original's per-individual random head does. Empty/omitted for a body-only
   * character (the baby, whose head is baked into the body bob).
   */
  readonly heads?: readonly SpriteLayer[];
  /** The per-state animation binding resolved against this body's own `[bobseq]` frame ranges. */
  readonly binding: SettlerStateBinding;
  /**
   * The binding the head overlay resolves through when it must differ from {@link binding} — the
   * head-borrow case: most carry-walk variants ship empty head bobs (the head is authored once, on the
   * base walk), so their head plays the walk range at the same (facing, frame) offset while the body
   * carries the load. Absent, heads resolve at the body's own bob id (the usual case).
   */
  readonly headBinding?: SettlerStateBinding;
}

/**
 * The per-job settler character table ({@link ByJobTable} of {@link SettlerCharacter}) — the render-side
 * `[jobbasegraphics]` join: an item's `jobType` (+ its young flag, see {@link ByJobTable}) picks which
 * body/heads/binding compose the settler. When a sheet carries one, settlers draw through it instead of
 * the sheet-global `bindings.settler` + `source`/`overlays` pair, which stays the fallback for a sheet
 * without characters (the synthetic atlas).
 */
export type SettlerCharacterSet = ByJobTable<SettlerCharacter>;

/**
 * A loaded bob atlas ready for the GPU: the atlas image as a Pixi {@link TextureSource} plus the pure
 * {@link SpriteAtlas} frame geometry and per-kind {@link SpriteBindings} the frame lookup needs. Optional
 * input to the renderer: when present, bound sprite kinds draw their atlas frame; when absent (or a
 * kind/frame doesn't resolve) the placeholder geometry draws instead.
 *
 * `overlays` are extra layers drawn on top of the body in order, each indexed by the same resolved bob
 * id (the head bob shares the body's frame numbering). A layer that lacks the id (or has a 0×0 frame
 * there) is skipped for that bob.
 */
export interface SpriteSheet {
  readonly source: TextureSource;
  readonly atlas: SpriteAtlas;
  readonly bindings: SpriteBindings;
  readonly overlays?: readonly SpriteLayer[];
  /**
   * Per-kind dedicated atlas layers. The base `source`/`atlas` (+ `overlays`) is the human body+head
   * set, whose bob-id space is the human bobs. A `resource` (a tree from `ls_trees.bmd`) or a `building`
   * (its own house `.bmd`) has a different decoded atlas with its own frame-id space, so it cannot share
   * that id space. When a kind has an entry here, its resolved bob id ({@link SpriteBindings}) is blitted
   * from this layer's own `source`+`atlas` instead of the shared body atlas — one feet-anchored sprite,
   * no head overlay. A kind with no entry falls back to the shared body+overlays path (the settler), and
   * an unresolved/empty frame falls back to placeholder geometry.
   */
  readonly kindLayers?: Partial<Record<SpriteKind, SpriteLayer>>;
  /**
   * Per-kind render scale (default 1 = native bob pixels). A decoded bob is blitted 1:1, but the source
   * art for different kinds was authored at different scales relative to the settler — the `ls_houses_*`
   * building bobs draw ~6–10× the settler's height at native size, larger than the original showed them
   * relative to a person. A kind listed here is drawn at that factor about its feet anchor, an
   * approximation that brings the building back into proportion with the native-scale settler + tree. A
   * kind with no entry draws native (scale 1).
   */
  readonly kindScales?: Partial<Record<SpriteKind, number>>;
  /**
   * Named building-family atlas layers — the multi-`.bmd` building case. A viking settlement draws its
   * buildings from many `.bmd`s × palettes (`ls_houses_viking`, `ls_houses_viking4`, …), each a separate
   * decoded atlas with its own frame-id space, so the single {@link kindLayers}.`building` layer can't
   * address them all. A {@link import('../data/sprites/index.js').BuildingTypeBinding} entry may be
   * layer-qualified (`{ layer, bob }`); when it names a `layer` present here, the GPU blits its `bob` from
   * that family's own `source`+`atlas` (one feet-anchored sprite) instead of {@link kindLayers}.`building`.
   * A plain-number / unqualified building binding (and every non-`building` kind) ignores this map and
   * uses the {@link kindLayers} path.
   */
  readonly families?: Readonly<Record<string, SpriteLayer>>;
  /**
   * Per-family render scale (default {@link kindScales}'s `building`, else 1) — the {@link families} twin
   * of {@link kindScales}, since each building `.bmd` was authored at its own size relative to the
   * settler. A family drawn from {@link families} scales about its feet anchor by this factor; a family
   * with no entry inherits the `building` kind scale.
   */
  readonly familyScales?: Readonly<Record<string, number>>;
  /**
   * Per-job settler characters (the `[jobbasegraphics]` job → body/head/animation join). When present, a
   * settler draws its job's {@link SettlerCharacter} — the armoured soldier body for the soldier family,
   * the woman/child bodies for theirs, the generic man for every unmapped job — instead of the
   * sheet-global body (`source`/`overlays`) + `bindings.settler`. Absent (the synthetic sheet), the
   * sheet-global path draws.
   */
  readonly characters?: SettlerCharacterSet;
  /**
   * The player-colour LUT for team colours: the `256 × colours` palette texture the {@link characters}
   * are drawn through when their atlases are the recolourable indexed variant (palette index in red). When
   * present, {@link import('./sprite-pool/index.js').SpritePool} draws each settler with a {@link
   * import('./paletted-sprite/index.js').PalettedSprite} at its `DrawItem.player` LUT row; when absent (no LUT
   * decoded, or the baked-palette characters) it falls back to a plain tinted-atlas {@link import('pixi.js').Sprite}.
   * One indexed atlas + one LUT serve all `colours` players.
   */
  readonly palette?: { readonly source: TextureSource; readonly colours: number };
}
