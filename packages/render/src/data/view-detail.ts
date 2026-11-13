/**
 * What the world draws at a camera scale. Each tier below `full` drops what the one above it did plus
 * more, least visible first. The thresholds and what each tier drops are our choice, not the original's:
 * a thing leaves the picture once it is a few screen pixels, judged against a settler about 40 world px
 * tall.
 */
export type DetailTier = 'full' | 'reduced' | 'sparse' | 'minimal';

/** `automatic` picks the tier by camera scale; `full` draws everything at every scale. */
export type DetailMode = 'automatic' | 'full';

/** What one tier draws; `true` draws the kind as the player's other settings allow. A tier only
 *  narrows: a kind a setting turned off stays off whatever its flag says. */
export interface ViewDetail {
  readonly tier: DetailTier;
  /** The cast shadows and foot blobs of settlers and animals. */
  readonly figureShadows: boolean;
  /** Footprints and the dust of a step. */
  readonly footfalls: boolean;
  /** The landscape's own motion: the frame loops of trees and bushes, the sway of vegetation and the
   *  breeze on it, and smoothed fish. Without it shore waves step every {@link WAVE_STEP_TICKS} ticks.
   *  One-shot clips, flat decor's GPU-played loops and the wind in sails are not part of it. */
  readonly motion: boolean;
  /** Thought bubbles, life hearts and experience stars over settlers. */
  readonly overheadIcons: boolean;
  /** The arcs of light round an amulet's carrier. */
  readonly amuletArcs: boolean;
  /** The cast shadows of trees, bushes, stumps, goods piles and flat decor. */
  readonly landscapeShadows: boolean;
  /** Sign chains at doors and construction stands. Garrison flags stay: they tell who holds a tower. */
  readonly buildingSigns: boolean;
}

/** Sim ticks one shore-wave frame holds while a tier stills the environment. */
export const WAVE_STEP_TICKS = 4;

/** Camera scales below which each tier starts: a settler is about 30, 22 and 17 screen px tall there. */
export const REDUCED_DETAIL_BELOW = 0.75;
export const SPARSE_DETAIL_BELOW = 0.55;
export const MINIMAL_DETAIL_BELOW = 0.42;
/** How far past a threshold the scale must rise before the view takes the richer tier back, so a view
 *  resting on a threshold does not flicker between two tiers. */
export const DETAIL_HYSTERESIS = 0.03;

const TIER_ORDER: readonly DetailTier[] = ['full', 'reduced', 'sparse', 'minimal'];
/** The scale each tier starts below, by its place in {@link TIER_ORDER}; `full` has none. */
const TIER_STARTS_BELOW: readonly number[] = [
  Number.POSITIVE_INFINITY,
  REDUCED_DETAIL_BELOW,
  SPARSE_DETAIL_BELOW,
  MINIMAL_DETAIL_BELOW,
];

/** One object per tier, so a consumer compares identities to see a tier change. */
export const VIEW_DETAILS: Readonly<Record<DetailTier, ViewDetail>> = {
  full: {
    tier: 'full',
    figureShadows: true,
    footfalls: true,
    motion: true,
    overheadIcons: true,
    amuletArcs: true,
    landscapeShadows: true,
    buildingSigns: true,
  },
  reduced: {
    tier: 'reduced',
    figureShadows: false,
    footfalls: false,
    motion: false,
    overheadIcons: true,
    amuletArcs: true,
    landscapeShadows: true,
    buildingSigns: true,
  },
  sparse: {
    tier: 'sparse',
    figureShadows: false,
    footfalls: false,
    motion: false,
    overheadIcons: false,
    amuletArcs: false,
    landscapeShadows: false,
    buildingSigns: true,
  },
  minimal: {
    tier: 'minimal',
    figureShadows: false,
    footfalls: false,
    motion: false,
    overheadIcons: false,
    amuletArcs: false,
    landscapeShadows: false,
    buildingSigns: false,
  },
};

export const FULL_DETAIL: ViewDetail = VIEW_DETAILS.full;

function tierBelow(scale: number): number {
  let index = 0;
  for (let i = 1; i < TIER_STARTS_BELOW.length; i++) {
    const start = TIER_STARTS_BELOW[i];
    if (start !== undefined && scale < start) index = i;
  }
  return index;
}

/**
 * The tier a view at camera `scale` draws in, given the tier it drew in last: it drops to a sparser
 * tier as soon as the scale falls below that tier's threshold, and takes a richer one back only once
 * the scale clears the threshold by {@link DETAIL_HYSTERESIS}.
 */
export function detailTierAt(scale: number, mode: DetailMode, previous: DetailTier = 'full'): DetailTier {
  if (mode === 'full') return 'full';
  const plain = tierBelow(scale);
  const held = TIER_ORDER.indexOf(previous);
  if (plain >= held) return TIER_ORDER[plain] ?? 'full';
  // Rising: keep the sparser of the previous tier and what the scale lowered by the margin asks for.
  const cautious = tierBelow(scale - DETAIL_HYSTERESIS);
  return TIER_ORDER[Math.min(held, cautious)] ?? 'full';
}

/** The detail a view at camera `scale` draws, as {@link detailTierAt} picks its tier. */
export function viewDetailAt(
  scale: number,
  mode: DetailMode,
  previous: ViewDetail = FULL_DETAIL,
): ViewDetail {
  return VIEW_DETAILS[detailTierAt(scale, mode, previous.tier)];
}

/** The shore waves' frame step under `detail`: the water clock's own, or held for
 *  {@link WAVE_STEP_TICKS} at a time once a tier stills the environment. */
export function waveStepOf(step: number, detail: ViewDetail): number {
  return detail.motion ? step : step - (step % WAVE_STEP_TICKS);
}
