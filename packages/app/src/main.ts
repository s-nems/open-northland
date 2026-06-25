import { buildScene, createPixiApp, renderScene } from '@vinland/render';
import { FixedTimestep } from '@vinland/sim';
import { renderShot } from './shot.js';
import { runSlice, sliceTerrain } from './vertical-slice.js';

/**
 * App shell entry point. Wires input -> sim commands, runs the fixed-timestep loop, and asks the
 * renderer to draw. This is the ONLY package that depends on both `sim` and `render`.
 *
 * Two modes, dispatched by the URL:
 *  - `?shot` → the deterministic, headless **screenshot entry** (see shot.ts): step a fixed N ticks,
 *    draw ONE frame, set `window.__vinlandShotReady`. No RAF — the harness waits on the flag.
 *  - otherwise → the live, wall-clock fixed-timestep loop, drawing the vertical slice each frame so
 *    `npm run dev` is watchable. (Real content/map loading + input still come in later Phase-2/3 steps.)
 */
const CANVAS_W = 960;
const CANVAS_H = 540;

async function main(): Promise<void> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

  if (new URLSearchParams(window.location.search).has('shot')) {
    await renderShot(canvas);
    return;
  }

  // Live mode: a deterministic slice driven by the fixed-timestep loop, drawn every frame.
  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  const terrain = sliceTerrain();
  const camera = { offsetX: CANVAS_W / 2, offsetY: CANVAS_H / 3 };
  // The slice sim, kept live and stepped one tick per fixed interval below.
  const sim = runSlice(7, 0);

  const timestep = new FixedTimestep();
  let lastMs = performance.now();

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    timestep.advance(elapsed, () => sim.step());
    renderScene(app, buildScene(sim.snapshot(), terrain), camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // eslint-disable-next-line no-console
  console.log('Vinland shell up: vertical slice rendering. See docs/ROADMAP.md.');
}

void main();
