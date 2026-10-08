import type { WorldSnapshot } from '@open-northland/sim';
import type { TextureSource } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type {
  ConstructionSign,
  DoorBadge,
  HudFrame,
  LifeHeart,
  LostGoalMarker,
  OrderMarker,
  RangeRing,
  SettlerBubble,
} from '../overlays/index.js';
import { DEFAULT_PIXEL_ART_SCALER, type PixelArtScaler } from '../pixel-art-registry.js';
import type { PlanRoadTextures } from '../plan-road.js';
import type { PlanStakeTextures } from '../plan-stake.js';
import type { SpriteSheet } from '../sprite-sheet.js';

/** One candidate building's workplace-assignment verdict: `ok` = the selected settler can take a slot there. */
export interface BuildingHighlightItem {
  readonly id: number;
  readonly ok: boolean;
}

/** The player's graphics enhancements. Every one off draws the baseline renderer, save for the two
 *  authored silhouettes the world now draws either way: flat decor's cast shadow and the `_s` twin
 *  under settlers and animals. */
export interface WorldEnhancements {
  /** Filtered original art, subpixel placement, bounded terrain filtering and building detail. */
  readonly enhancedSampling: boolean;
  /** How original pixel art magnifies while `enhancedSampling` is on. */
  readonly pixelArtScaler: PixelArtScaler;
  readonly softShadows: boolean;
  /** Crossing swells, depth shading, colour grade and glint on the terrain water. */
  readonly enhancedWater: boolean;
  /** Interpolated fish, the smoothed breeze and the sway of trees authored as one still frame. */
  readonly environmentMotion: boolean;
  /** Buildings, palisades and built walls set into the ground they stand on instead of on it. */
  readonly groundedBuildings: boolean;
  /** Structural scars, fire, embers and impact debris on damaged buildings. */
  readonly buildingDamage: boolean;
}

/** The baseline renderer: every enhancement off. */
export const BASELINE_ENHANCEMENTS: WorldEnhancements = {
  enhancedSampling: false,
  pixelArtScaler: DEFAULT_PIXEL_ART_SCALER,
  softShadows: false,
  enhancedWater: false,
  environmentMotion: false,
  groundedBuildings: false,
  buildingDamage: false,
};

export interface WorldRendererOptions {
  /** Local presentation preference; enabled by default, independent of graphics quality. */
  readonly bloodEnabled?: boolean;
  readonly enhancements?: WorldEnhancements;
  /** The loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity. */
  readonly sheet?: SpriteSheet | undefined;
  /**
   * Snap the camera pan and the self-placing sprite origins to whole device pixels, and minify the world
   * atlases linear below zoom 1, reducing the shimmer of nearest-sampled art. Enhanced sampling
   * supersedes snapping with subpixel placement. The `?shot` entry omits both options.
   */
  readonly viewSmoothing?: boolean | undefined;
  /** The world post pass: a warm-graded vignette multiply over the world, under the HUD. An enhancement
   *  over the original. */
  readonly postFx?: boolean | undefined;
  /** Linear minification of world atlas pages; independent of screen-space UI. */
  readonly spriteSmoothing?: boolean | undefined;
  /** Owner slot → team-colour slot when a map's roster recolours players; absent means identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** The line tools' stake art; absent draws a flat stand-in. */
  readonly planStakes?: PlanStakeTextures | undefined;
  /** The road tool's plot art; absent draws a flat stand-in. */
  readonly planRoads?: PlanRoadTextures | undefined;
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
export const NO_GROUP_NUMBERS: ReadonlyMap<number, readonly string[]> = new Map();
export const NO_RANGE_RINGS: readonly RangeRing[] = [];
export const NO_ORDER_MARKERS: readonly OrderMarker[] = [];
export const NO_LOST_GOALS: readonly LostGoalMarker[] = [];

export interface WorldFrame {
  /** UI animation clock in seconds, independent of pause and simulation speed. Omitted in still captures. */
  readonly selectionTime?: number;
  readonly snapshot: WorldSnapshot;
  readonly camera: Camera;
  /** The snapshot's integer sim tick, used as the animation clock for gaits, rotors and decor (default 0). */
  readonly tick?: number | undefined;
  /** The HUD text frame to repaint; absent leaves the HUD unchanged. */
  readonly hud?: HudFrame | undefined;
  /** Selected entity ids, drawn in the chosen selection style (default none). Transient view state, never sim state. */
  readonly selection?: ReadonlySet<number> | undefined;
  /** Fixed-timestep interpolation fraction: each entity draws `alpha` of the way from its previous tick
   *  anchor to its current one (default 1 draws raw tick positions). */
  readonly alpha?: number | undefined;
  readonly doorBadges?: readonly DoorBadge[] | undefined;
  readonly constructionSigns?: readonly ConstructionSign[] | undefined;
  readonly settlerBubbles?: readonly SettlerBubble[] | undefined;
  readonly lifeHearts?: readonly LifeHeart[] | undefined;
  /** Entity id → the numbers of its control groups, drawn while the numbers are shown (default none). */
  readonly groupNumbers?: ReadonlyMap<number, readonly string[]> | undefined;
  /** Work flag entity ids belonging to selected gatherers; highlighted with an amber outline. */
  readonly flagged?: ReadonlySet<number> | undefined;
  /** Ids the HUD points at among the selection (a hovered group well); lateral marks indicate them (default none). */
  readonly focused?: ReadonlySet<number> | undefined;
  /** Ground range circles: where a worker works, where a defence-mode building shoots (default none). */
  readonly rangeRings?: readonly RangeRing[] | undefined;
  /** The ground acknowledgements of the player's latest walk and march orders (default none). */
  readonly orderMarkers?: readonly OrderMarker[] | undefined;
  /** The refused goals of the selected lost settlers, held while they stay lost (default none). */
  readonly lostGoals?: readonly LostGoalMarker[] | undefined;
  /** The refused goals' shared breathing phase, 0..1 and wrapping, off the app's wall clock (default 0). */
  readonly lostGoalPulse?: number | undefined;
}

/**
 * World-space slack in px added to every side of the sprite cull box, since culling is by the feet anchor
 * and a tall sprite standing just off-screen still pokes into view. Covers the tallest scaled building or
 * map object, and stays around seven tile widths, so culling still bites.
 */
export const SPRITE_CULL_MARGIN = 512;
