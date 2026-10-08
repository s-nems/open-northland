import { clamp } from './math.js';
import { oneShotBus } from './mixer.js';
import type { OneShot } from './types.js';

/**
 * Zoom as a listening perspective. The listener stays on the ground under the screen centre; zooming
 * out only re-balances whole layers of the mix: fine world detail fades first, combat and big events
 * hold, and the ambient beds become the macro layer. Music and the `ui` bus never follow the
 * camera. The original has no zoom, so every curve here is an approximation to tune by ear.
 */

/** A world one-shot's layer: `detail` is work, chatter and small action sounds; `impact` is combat
 *  impacts, screams and big events that must still read from far out. */
export type ShotLayer = 'detail' | 'impact';

/** A zoom-following layer of the mix: the two world layers and the ambient `bed` (terrain beds and
 *  weather). */
export type PerspectiveLayer = ShotLayer | 'bed';

/** Every world one-shot layer. */
export const SHOT_LAYERS: readonly ShotLayer[] = ['detail', 'impact'];

/** How one layer answers a zoom-out. */
export interface PerspectiveCurve {
  /** Gain in dB at {@link FAR_ZOOM_SCALE}; 0 dB at 1:1 and closer, linear in dB between. */
  readonly farGainDb: number;
}

/**
 * Per-layer zoom curves. Approximation in the shape strategic-zoom games document: unit detail fades
 * fastest, impacts fade slowest, the beds rise a little as they take over.
 */
export const PERSPECTIVE_CURVES: Readonly<Record<PerspectiveLayer, PerspectiveCurve>> = {
  detail: { farGainDb: -12 },
  impact: { farGainDb: -4 },
  bed: { farGainDb: 2 },
};

/** The camera scale the perspective counts as nearest: 1:1, where the art is drawn. Zooming in further
 *  adds nothing, so a close camera never boosts. */
export const NEAR_ZOOM_SCALE = 1;
/** The camera scale the perspective counts as farthest: the interactive camera's widest zoom
 *  (`MIN_ZOOM` in the app's camera bounds). A debug zoom past it holds the far mix. */
export const FAR_ZOOM_SCALE = 0.35;

/**
 * How far out the camera is, 0 at {@link NEAR_ZOOM_SCALE} or closer to 1 at {@link FAR_ZOOM_SCALE} or
 * wider, linear in log scale so each zoom step moves the mix alike. A missing or non-positive scale is
 * read as 1:1.
 */
export function zoomDistance(scale: number | undefined): number {
  const s = scale === undefined || !(scale > 0) ? NEAR_ZOOM_SCALE : scale;
  return clamp(Math.log(NEAR_ZOOM_SCALE / s) / Math.log(NEAR_ZOOM_SCALE / FAR_ZOOM_SCALE), 0, 1);
}

/** A layer's linear gain at zoom distance `zoom` ({@link zoomDistance}). */
export function perspectiveGain(layer: PerspectiveLayer, zoom: number): number {
  return 10 ** ((PERSPECTIVE_CURVES[layer].farGainDb * zoom) / 20);
}

/** The layer a one-shot plays in, or null for one that ignores the camera: a shot on the `ui` bus
 *  (GUI cues, order answers, jingles) keeps one level wherever the camera is. */
export function shotLayer(shot: OneShot): ShotLayer | null {
  return oneShotBus(shot) === 'ui' ? null : (shot.layer ?? 'detail');
}
