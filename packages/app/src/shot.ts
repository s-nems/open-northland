import { buildScene, createPixiApp, renderScene } from '@vinland/render';
import { runSlice, sliceTerrain } from './vertical-slice.js';

/**
 * The deterministic, headless render entry the screenshot harness waits on (docs/TESTING.md
 * "Visual validation via Playwright"): *render scenario X at seed S, advance N ticks, draw ONE
 * frame, then signal ready* — explicitly NOT the wall-clock `requestAnimationFrame` loop. The
 * harness boots the page with `?shot`, polls `window.__vinlandShotReady`, and screenshots the canvas.
 *
 * Because the sim is seed-deterministic and `buildScene` is pure, the same `?shot&seed=…&ticks=…`
 * always produces the same draw list — so the *only* source of frame variance is the GPU rasteriser,
 * which is why the harness output is eyeballed for gross correctness, never byte-compared.
 */

/** Set on `window` once the single frame has been drawn, so Playwright can wait deterministically. */
declare global {
  interface Window {
    __vinlandShotReady?: boolean;
  }
}

const CANVAS_W = 960;
const CANVAS_H = 540;

function intParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Run the slice, draw a single deterministic frame to `canvas`, and flag readiness. The camera pans
 * the iso world into view (the slice's leftmost tiles project to negative screen-x, so we offset to
 * roughly centre it). Returns once the frame is on the GPU and the ready flag is set.
 */
export async function renderShot(canvas: HTMLCanvasElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const seed = intParam(params, 'seed', 7);
  const ticks = intParam(params, 'ticks', 20);

  const sim = runSlice(seed, ticks);
  const scene = buildScene(sim.snapshot(), sliceTerrain());

  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  // Pan the iso strip into the centre of the canvas (its tiles span screen-x roughly [-row, +cols]).
  renderScene(app, scene, { offsetX: CANVAS_W / 2, offsetY: CANVAS_H / 3 });

  window.__vinlandShotReady = true;
}
