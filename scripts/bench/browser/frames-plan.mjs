/** The windows and settings of `npm run bench:browser`; pure, so it unit-tests. */
import { MAGNIFIERS } from './gpu-plan.mjs';

/** The views a window frames, all on the densest building cluster but `empty`. */
export const CAMERA_NAMES = ['dense', 'zoom07', 'zoom05', 'wide', 'empty'];

/**
 * Every window `ON_BENCH_BROWSER_WINDOWS` can name: a camera, plus a moving pointer (`pointer`) or a
 * camera pan from the restore on (`pan`). The camera names measure with the pointer at rest.
 */
export const WINDOWS = {
  ...Object.fromEntries(CAMERA_NAMES.map((name) => [name, { camera: name, pointer: 'rest', pan: false }])),
  'dense-move': { camera: 'dense', pointer: 'move', pan: false },
  'wide-move': { camera: 'wide', pointer: 'move', pan: false },
  'first-pan': { camera: 'dense', pointer: 'rest', pan: true },
};

/** A moving pointer's mean speed over the world, screen px per second. */
export const POINTER_SPEED_PX_PER_S = 60;
/** The first pan measures from the restore on, without warm-up, for this long whatever the window
 *  length: the first uploads and mask builds land in it. */
export const FIRST_PAN_SECONDS = 10;
/** The arrow keys' pan rate at scroll speed 1, screen px per second. */
const FIRST_PAN_PX_PER_S = 900;
/** The pan's ellipse: half as tall as wide, so it stays over the land around the town. */
const FIRST_PAN_ASPECT = 0.55;

/** `camera:speed` pairs, e.g. `dense:3,wide-move:3`; undefined when unset (the full baseline matrix). */
export function parseWindowSpec(text) {
  if (text === undefined) return undefined;
  return text.split(',').map((pair) => {
    const [cameraName, speedText] = pair.split(':');
    const speed = Number(speedText);
    if (!(cameraName in WINDOWS) || !Number.isInteger(speed) || speed < 0)
      throw new Error(`ON_BENCH_BROWSER_WINDOWS entry ${pair} is not window:speed (${Object.keys(WINDOWS)})`);
    return { cameraName, speed };
  });
}

const RENDER_SCALE_MIN = 0.5;
const RENDER_SCALE_MAX = 2;
const DEFAULT_FILTER = 'xbr';
const DEFAULT_RENDER_SCALE = 1;
const DETAIL_MODES = ['automatic', 'full'];
const DEFAULT_DETAIL = 'automatic';

/**
 * `ON_BENCH_BROWSER_FILTER` (a Graphics-menu magnifier, `off` for enhanced sampling disabled; default
 * xBR, the game's default), `ON_BENCH_BROWSER_RENDER_SCALE` (the backing multiplier, 0.5 to 2;
 * default 1) and `ON_BENCH_BROWSER_DETAIL` (`automatic`, the game's default, drops detail as the view
 * zooms out; `full` draws everything at every zoom), with the settings patch they load under. Every
 * other setting stays at its default.
 */
export function parseGraphicsKnobs(env = {}) {
  const filter = env.ON_BENCH_BROWSER_FILTER || DEFAULT_FILTER;
  if (!MAGNIFIERS.includes(filter))
    throw new Error(`ON_BENCH_BROWSER_FILTER must be one of ${MAGNIFIERS}, not '${filter}'`);
  const scaleText = env.ON_BENCH_BROWSER_RENDER_SCALE;
  const renderScale = scaleText === undefined || scaleText === '' ? DEFAULT_RENDER_SCALE : Number(scaleText);
  if (!Number.isFinite(renderScale) || renderScale < RENDER_SCALE_MIN || renderScale > RENDER_SCALE_MAX)
    throw new Error(`ON_BENCH_BROWSER_RENDER_SCALE must be ${RENDER_SCALE_MIN} to ${RENDER_SCALE_MAX}`);
  const detail = env.ON_BENCH_BROWSER_DETAIL || DEFAULT_DETAIL;
  if (!DETAIL_MODES.includes(detail))
    throw new Error(`ON_BENCH_BROWSER_DETAIL must be one of ${DETAIL_MODES}, not '${detail}'`);
  const settings = {
    enhancedSampling: filter !== 'off',
    ...(filter === 'off' ? {} : { pixelArtScaler: filter }),
    renderScale,
    adaptiveDetail: detail === 'automatic',
  };
  return { filter, renderScale, detail, settings };
}

/**
 * The first pan's path from world-screen `point`: an ellipse that leaves the point sideways and comes
 * back to it after one lap of {@link FIRST_PAN_SECONDS} at the arrow keys' rate. In-page code places the
 * view centre at `(cx - rx cos(w t), cy + ry sin(w t))` world px, `w` being `radiansPerSecond`.
 */
export function firstPanEllipse(point, scale) {
  const lap = (FIRST_PAN_PX_PER_S / scale) * FIRST_PAN_SECONDS;
  const ratio = FIRST_PAN_ASPECT;
  // Ramanujan's perimeter of an ellipse with semi-axes 1 and `ratio`.
  const unitPerimeter = Math.PI * (3 * (1 + ratio) - Math.sqrt((3 + ratio) * (1 + 3 * ratio)));
  const rx = lap / unitPerimeter;
  return {
    cx: point.x + rx,
    cy: point.y,
    rx,
    ry: rx * ratio,
    radiansPerSecond: (2 * Math.PI) / FIRST_PAN_SECONDS,
  };
}
