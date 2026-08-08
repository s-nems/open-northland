import type { TextureSource } from 'pixi.js';
import type { CellTexture } from '../data/terrain/index.js';

/**
 * The loaded textured-terrain inputs. Optional to the renderer: a triangle whose typeId has no
 * {@link CellTexture}, or whose page failed to load, falls back to a flat-colour triangle.
 */
export interface TerrainTextureSet {
  /** Decoded ground and composed transition pages as GPU sources, keyed by their pattern's `pageKey`. */
  readonly pages: ReadonlyMap<string, TextureSource>;
  /** The approximated per-landscape-typeId ground binding, or `undefined` when a typeId has no
   *  representative. */
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
 * One resolved ground-transition overlay: its composed RGBA page plus the six pair variants' 6-int UV
 * pixel tuples per triangle.
 */
export interface TransitionPattern {
  readonly pageKey: string;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}
