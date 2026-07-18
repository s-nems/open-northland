import type { WorldSnapshot } from '@open-northland/sim';
import type { Camera } from '../../data/projection/index.js';
import type { DoorBadge, HudFrame, SettlerBubble } from '../overlays/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';

/**
 * The world renderer's public data contract: what the app constructs it with, what it hands it per
 * frame, and the shared defaults the no-op cases fall back to.
 */

/** One candidate building's workplace-assignment verdict: its entity id and whether the selected settler
 *  can be assigned there (green) or not (red). Fed to {@link import('./world-renderer.js').WorldRenderer.setBuildingHighlight}. */
export interface BuildingHighlightItem {
  readonly id: number;
  readonly ok: boolean;
}

/** Construction options of a {@link import('./world-renderer.js').WorldRenderer}. */
export interface WorldRendererOptions {
  /** The loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity. */
  readonly sheet?: SpriteSheet | undefined;
  /**
   * Interactive view smoothing: snap the camera pan to whole device pixels (nearest-sampled art
   * shimmer-crawls on fractional-pixel pans) and switch the world atlases to linear minification while
   * zoomed out below 1 (nearest minification sparkles). For the live entries only — the deterministic
   * `?shot` capture must stay byte-stable, so it never enables this.
   */
  readonly viewSmoothing?: boolean | undefined;
  /**
   * The world post pass (`gpu/post-fx.ts`): a warm-graded vignette multiply over the world, under the
   * HUD. An OpenNorthland enhancement for the live entries; the deterministic `?shot` capture never
   * enables it (`?postfx=off` disables it live).
   */
  readonly postFx?: boolean | undefined;
  /**
   * Owner slot → team-colour slot, when a map's roster recolours players away from the slot-id
   * default (see {@link import('../../data/scene/index.js').SpriteSceneOptions.playerColourOf}).
   * Absent = identity.
   */
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** Shared empty highlight so clearing the assign-mode tint allocates nothing. */
export const EMPTY_HIGHLIGHT: ReadonlyMap<number, boolean> = new Map();

/** Shared empty ref set so the common no-selection / no-flagged `update` allocates nothing. */
export const NO_REFS: ReadonlySet<number> = new Set();
export const NO_BADGES: readonly DoorBadge[] = [];
export const NO_BUBBLES: readonly SettlerBubble[] = [];

/**
 * The per-frame inputs of {@link import('./world-renderer.js').WorldRenderer.update}, named rather than
 * positional so the same-typed `selection`/`flagged` sets cannot be swapped silently. Mirrors the
 * {@link import('../sprite-pool/index.js').SpritePool}'s `PoolFrame`: only `snapshot` + `camera` are
 * required, everything else falls back to its transient-view default.
 */
export interface WorldFrame {
  readonly snapshot: WorldSnapshot;
  /** The world layer's own transform (screen = world*scale + offset). */
  readonly camera: Camera;
  /** The integer sim tick the snapshot is at — the animation clock for gaits/rotors/decor (default 0). */
  readonly tick?: number | undefined;
  /** The HUD text frame to repaint, or absent to leave the HUD unchanged. */
  readonly hud?: HudFrame | undefined;
  /** The app's currently-selected entity ids, projected to feet rings (default none). Transient view state. */
  readonly selection?: ReadonlySet<number> | undefined;
  /** The fixed-timestep interpolation fraction (the loop's `FixedTimestep.advance` return): each entity
   *  draws `alpha` of the way from its previous tick anchor to its current one (default 1 = raw tick). */
  readonly alpha?: number | undefined;
  /** Per-building door-badge tallies to stack over each door (default none). */
  readonly doorBadges?: readonly DoorBadge[] | undefined;
  /** Per-settler thought bubbles to float over a settler's head (make-child / wedding; default none). */
  readonly settlerBubbles?: readonly SettlerBubble[] | undefined;
  /** The work-flagged gatherer ids whose feet rings read as flagged (default none). */
  readonly flagged?: ReadonlySet<number> | undefined;
}

/**
 * World-space slack (px) the sprite cull box is grown by on every side, so a tall sprite whose feet are
 * just off-screen but whose body pokes into view still draws (culling is by the feet anchor). Covers the
 * tallest scaled building or map object; still small next to a real map (≈8 tiles), so culling bites.
 */
export const SPRITE_CULL_MARGIN = 512;
