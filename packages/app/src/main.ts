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
import { cameraFor, floatParam } from './camera.js';
import { loadHumanSpriteSheet } from './real-sprites.js';
import { loadRealTerrain } from './real-terrain.js';
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
  const terrainGrid = sliceTerrain(loaded ?? undefined);
  // `?atlas` binds a sprite atlas so sprites draw as textured atlas frames; absent, they draw as
  // placeholder geometry. `?atlas=real` binds the REAL decoded human-body atlas (settlers only; gitignored
  // content over the /bobs server — see real-sprites.ts); any other `?atlas` value binds the free synthetic
  // atlas (the reproducible default texture, no copyrighted data).
  let sheet: SpriteSheet | undefined;
  if (params.get('atlas') === 'real') {
    sheet = await loadHumanSpriteSheet();
  } else if (params.has('atlas')) {
    sheet = {
      source: createSyntheticAtlasSource(),
      atlas: syntheticAtlasFrames(),
      bindings: SYNTHETIC_BINDINGS,
    };
  }
  // `?terrain` draws the ground from REAL decoded `text_*.pcx` textures (the approximated typeId→pattern
  // map) instead of the flat 4-colour tint; gitignored content over the /ir.json + /textures server
  // (see real-terrain.ts). Absent, terrain stays the reproducible flat-tint default.
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;
  // `?zoom=N` magnifies + re-centres on the sprites (the same knob the shot uses) so a decoded bob is
  // big enough to inspect in the live view; absent, scale 1.
  const zoom = floatParam(params, 'zoom', 1);
  // `?speed=` scales wall-clock fed to the fixed-timestep loop, so the sim (and the tick-driven sprite
  // animation, which advances one frame per tick) run slower/faster than the 20Hz default — a human
  // knob to watch a walk/chop cycle at a pace they can judge against the original. Default 0.5 (calm
  // enough to evaluate); `?speed=1` is the full sim rate, higher values fast-forward.
  const speed = floatParam(params, 'speed', 0.5);
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
    timestep.advance(elapsed * speed, () => sim.step());
    const snap = sim.snapshot();
    const scene = buildScene(snap, terrainGrid);
    renderScene(app, scene, cameraFor(scene, zoom, CANVAS_W, CANVAS_H), sheet, snap.tick, terrain);
    // HUD overlay on top of the scene (renderScene cleared the stage; this adds to it).
    renderHud(app, placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', screen));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log('Vinland shell up: vertical slice rendering. See docs/ROADMAP.md.');
}

void main();
