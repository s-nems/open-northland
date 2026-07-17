import type { TextureSource } from 'pixi.js';
import type { CellTexture } from '../data/terrain/index.js';

/**
 * The plain-data textured-terrain GPU inputs (the GPU twin of the pure `data/terrain/tessellation.ts` geometry): the
 * decoded ground-texture pages + the typeId/name → UV lookups {@link import('./terrain/index.js')}
 * samples. Pure data; the atlas-page loading that produces the {@link TextureSource}s lives in
 * {@link import('./pixi-app.js')}, the settler-sheet twin in {@link import('./sprite-sheet.js')}.
 */

/**
 * The loaded textured-terrain inputs: the decoded ground-texture pages keyed by
 * {@link CellTexture.pageKey}, plus the approximated typeId→{@link CellTexture} lookup the app built from
 * the `TerrainPattern` IR. Optional input to the renderer: when present, each cell's two mesh triangles
 * sample their page; a triangle whose typeId has no {@link CellTexture}, or whose page failed to load,
 * falls back to a flat-colour triangle (the {@link CellTexture.fallbackColour} debug colour, else the
 * default). When absent, every cell draws the legacy flat tint — the reproducible default the committed
 * shot depends on.
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
  /**
   * The transition overlay by name — the join a decoded map's `transitions.types` names resolve
   * through (the `GfxPatternTransition` IR row's masked RGBA page + its six per-pair UV tuples).
   * Optional: a set built without the transition table (or a map without transition lanes) simply
   * draws no overlays.
   */
  transitionFor?(name: string): TransitionPattern | undefined;
}

/** One resolved 1:1 ground pattern: its texture page + the two triangles' 6-int UV pixel tuples. */
export interface GroundPattern {
  readonly pageKey: string;
  readonly coordsA: readonly number[];
  readonly coordsB: readonly number[];
}

/**
 * One resolved ground-transition overlay: its composed RGBA page (RGB texture + alpha mask — the
 * pipeline's `<stem>.masked.png`) + the six pair variants' 6-int UV pixel tuples per triangle
 * (a map lane's `value % 6` picks the pair, `data/terrain/transitions.ts` `transitionRef`).
 */
export interface TransitionPattern {
  readonly pageKey: string;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}
