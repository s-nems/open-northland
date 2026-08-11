import type { WorldSnapshot } from '@open-northland/sim';
import type { TextureSource } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { ConstructionSign, DoorBadge, HudFrame, LifeHeart, SettlerBubble } from '../overlays/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';

/** One candidate building's workplace-assignment verdict: `ok` = the selected settler can take a slot there. */
export interface BuildingHighlightItem {
  readonly id: number;
  readonly ok: boolean;
}

export interface WorldRendererOptions {
  /** The loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity. */
  readonly sheet?: SpriteSheet | undefined;
  /**
   * Snap the camera pan and the self-placing sprite origins to whole device pixels, and minify the world
   * atlases linear below zoom 1, killing the shimmer of nearest-sampled art. The `?shot` entry omits it,
   * so its capture stays comparable across machines.
   */
  readonly viewSmoothing?: boolean | undefined;
  /** The world post pass: a warm-graded vignette multiply over the world, under the HUD. An enhancement
   *  over the original. */
  readonly postFx?: boolean | undefined;
  /** Owner slot → team-colour slot when a map's roster recolours players; absent means identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** `scale` defaults to the native landscape-object scale of 1. */
export interface CombatBonesGfx {
  readonly source: TextureSource;
  readonly frames: readonly AtlasFrame[];
  readonly scale?: number | undefined;
}

/** Shared empty defaults, so a cleared list or highlight allocates nothing. */
export const EMPTY_HIGHLIGHT: ReadonlyMap<number, boolean> = new Map();
export const NO_REFS: ReadonlySet<number> = new Set();
export const NO_BADGES: readonly DoorBadge[] = [];
export const NO_SIGNS: readonly ConstructionSign[] = [];
export const NO_BUBBLES: readonly SettlerBubble[] = [];
export const NO_HEARTS: readonly LifeHeart[] = [];

export interface WorldFrame {
  readonly snapshot: WorldSnapshot;
  readonly camera: Camera;
  /** The snapshot's integer sim tick, used as the animation clock for gaits, rotors and decor (default 0). */
  readonly tick?: number | undefined;
  /** The HUD text frame to repaint; absent leaves the HUD unchanged. */
  readonly hud?: HudFrame | undefined;
  /** Selected entity ids, drawn as feet rings (default none). Transient view state, never sim state. */
  readonly selection?: ReadonlySet<number> | undefined;
  /** Fixed-timestep interpolation fraction: each entity draws `alpha` of the way from its previous tick
   *  anchor to its current one (default 1 draws raw tick positions). */
  readonly alpha?: number | undefined;
  readonly doorBadges?: readonly DoorBadge[] | undefined;
  readonly constructionSigns?: readonly ConstructionSign[] | undefined;
  readonly settlerBubbles?: readonly SettlerBubble[] | undefined;
  readonly lifeHearts?: readonly LifeHeart[] | undefined;
  /** Ids of gatherers carrying a work flag; their feet rings draw the flagged variant (default none). */
  readonly flagged?: ReadonlySet<number> | undefined;
}

/**
 * World-space slack in px added to every side of the sprite cull box, since culling is by the feet anchor
 * and a tall sprite standing just off-screen still pokes into view. Covers the tallest scaled building or
 * map object, and stays around seven tile widths, so culling still bites.
 */
export const SPRITE_CULL_MARGIN = 512;
