import {
  SYNTHETIC_BINDINGS,
  type SpriteSheet,
  buildHud,
  buildScene,
  createPixiApp,
  createSyntheticAtlasSource,
  layoutHud,
  placeHud,
  renderHud,
  renderScene,
  syntheticAtlasFrames,
} from '@vinland/render';
import { FixedTimestep } from '@vinland/sim';
import { renderShot } from './shot.js';
import { loadTerrainMap, runSlice, sliceTerrain } from './vertical-slice.js';

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

  const params = new URLSearchParams(window.location.search);
  if (params.has('shot')) {
    await renderShot(canvas);
    return;
  }

  // Live mode: a deterministic slice driven by the fixed-timestep loop, drawn every frame.
  // `?map=<id>` draws an actual decoded `content/maps/<id>.json` grid as the terrain; absent or
  // unloadable, it falls back to the synthetic grass strip (the maps are gitignored).
  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  const terrain = sliceTerrain(loaded ?? undefined);
  // `?atlas` binds the free synthetic atlas so sprites draw as textured atlas frames; absent, they
  // draw as placeholder geometry (real bobs are gitignored — see shot.ts).
  const sheet: SpriteSheet | undefined = params.has('atlas')
    ? {
        source: createSyntheticAtlasSource(),
        atlas: syntheticAtlasFrames(),
        bindings: SYNTHETIC_BINDINGS,
      }
    : undefined;
  const camera = { offsetX: CANVAS_W / 2, offsetY: CANVAS_H / 3 };
  // The slice sim, kept live and stepped one tick per fixed interval below. When a map loaded, the sim
  // navigates that real grid (placement on its walkable cells); else the synthetic strip.
  const sim = runSlice(7, 0, loaded ?? undefined);
  // The slice is single-tribe (viking, tribe 1); draw its HUD panel each frame.
  const HUD_TRIBE = 1;
  const screen = { width: CANVAS_W, height: CANVAS_H };

  const timestep = new FixedTimestep();
  let lastMs = performance.now();

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    timestep.advance(elapsed, () => sim.step());
    const snap = sim.snapshot();
    renderScene(app, buildScene(snap, terrain), camera, sheet);
    // HUD overlay on top of the scene (renderScene cleared the stage; this adds to it).
    renderHud(app, placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', screen));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log('Vinland shell up: vertical slice rendering. See docs/ROADMAP.md.');
}

void main();
