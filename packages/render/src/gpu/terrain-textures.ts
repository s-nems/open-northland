import type { TextureSource } from 'pixi.js';
import type { CellTexture } from '../data/terrain/index.js';

/**
 * The loaded textured-terrain inputs. Optional to the renderer: when present, each cell's two mesh
 * triangles sample their page; a triangle whose typeId has no {@link CellTexture}, or whose page failed
 * to load, falls back to a flat-colour triangle. When absent, every cell draws the flat tint - the
 * reproducible default the committed shot depends on.
 */
export interface TerrainTextureSet {
  /** Decoded `text_NNN` ground pages as GPU sources, keyed by {@link CellTexture.pageKey}. */
  readonly pages: ReadonlyMap<string, TextureSource>;
  /** The approximated per-landscape-typeId ground binding, or `undefined` when a typeId has no representative. */
  cellFor(typeId: number): CellTexture | undefined;
  /**
   * The 1:1 per-triangle pattern by `EditName`, the join a decoded map's `ground.patterns` names resolve
   * through. Absent for a set built without the full pattern table, which falls back to {@link cellFor}.
   */
  groundFor?(name: string): GroundPattern | undefined;
  /**
   * The transition overlay by name, the join a decoded map's `transitions.types` names resolve through.
   * Absent for a set built without the transition table, which simply draws no overlays.
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
 * One resolved ground-transition overlay: its composed RGBA page (the pipeline's `<stem>.masked.png`,
 * RGB texture + alpha mask) plus the six pair variants' 6-int UV pixel tuples per triangle. A map lane's
 * `value % 6` picks the pair.
 */
export interface TransitionPattern {
  readonly pageKey: string;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}
