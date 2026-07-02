import {
  WorldRenderer,
  buildHud,
  buildSpriteScene,
  createWindowPixiApp,
  layoutHud,
  placeHud,
} from '@vinland/render';
import { FixedTimestep } from '@vinland/sim';
import { renderAnimationGallery } from './anim-mode.js';
import { cameraFor, createCameraController, floatParam } from './camera.js';
import { loadMapObjects } from './real-objects.js';
import { resolveSpriteSheet } from './real-sprites.js';
import { fetchTerrainIr, loadRealTerrain } from './real-terrain.js';
import { renderSceneMode } from './scene-mode.js';
import { renderShot } from './shot.js';
import { demoGoods, loadTerrainMap, runSlice, sliceTerrain } from './vertical-slice.js';

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
async function main(): Promise<void> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

  const params = new URLSearchParams(window.location.search);
  if (params.has('shot')) {
    await renderShot(canvas);
    return;
  }
  // `?scene=<id>` runs a registered acceptance scene with its checklist overlay (see scene-mode.ts +
  // docs/SCENES.md) — the human-facing twin of the headless scene test. Absent, the live slice below.
  const sceneId = params.get('scene');
  if (sceneId !== null) {
    await renderSceneMode(canvas, sceneId, params);
    return;
  }
  // `?anim` opens the character **animation gallery**: every extracted `[bobseq]` played from the atlas,
  // with a direction selector, so a human can validate all animations in all 8 facings (see anim-mode.ts).
  if (params.has('anim')) {
    await renderAnimationGallery(canvas, params);
    return;
  }

  // Live mode: a deterministic slice driven by the fixed-timestep loop, drawn every frame. The
  // backing store tracks the window at 1:1 pixels (createWindowPixiApp), so resizing the browser
  // changes the visible field, never the scale — read live dimensions from `app.screen`.
  // `?map=<id>` draws an actual decoded `content/maps/<id>.json` grid as the terrain; absent or
  // unloadable, it falls back to the synthetic grass strip (the maps are gitignored).
  const app = await createWindowPixiApp(canvas);
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  const terrainGrid = sliceTerrain(loaded ?? undefined);
  // Real decoded graphics are the DEFAULT (see resolveSpriteSheet): absent or `?atlas=real` draws the real
  // atlases (gitignored content over the /bobs server), degrading to synthetic markers when content/ is
  // missing. `?atlas=synthetic` forces the free markers; `?atlas=none` draws placeholder geometry. Shared
  // with the `?scene=` entry.
  const sheet = await resolveSpriteSheet(params, demoGoods());
  // Real ground textures + map objects are the DEFAULT (like the sprite atlases), each behind its
  // own opt-out (`?terrain=off` → flat tint, `?objects=off` → bare ground) and each degrading
  // gracefully when content/ is absent — the shared multi-MB ir.json is fetched once for both.
  let ir = null;
  const wantTerrain = params.get('terrain') !== 'off';
  const wantObjects = loaded?.objects !== undefined && params.get('objects') !== 'off';
  if (wantTerrain || wantObjects) {
    try {
      ir = await fetchTerrainIr();
    } catch (err) {
      console.warn(`content/ir.json unavailable, placeholder graphics fallback: ${String(err)}`);
    }
  }
  let terrain: Awaited<ReturnType<typeof loadRealTerrain>> | undefined;
  if (wantTerrain && ir !== null) {
    try {
      terrain = await loadRealTerrain(ir);
    } catch (err) {
      console.warn(`real terrain unavailable, flat tint fallback: ${String(err)}`);
    }
  }
  // Retained renderer: mesh the terrain ONCE, reuse a pooled sprite graph each frame (no per-frame
  // object churn) so large maps + deep zoom-out stay within the GPU budget.
  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // A decoded map's placed landscape objects (trees/stones/mine decals + the animated wave fx that
  // ARE the original's water surface) — resolved through the landscapeGfx IR + the /bobs atlases.
  // The catch keeps a partial content/ (e.g. a missing atlas PNG) a degradation, not an app crash.
  if (wantObjects && loaded?.objects !== undefined && ir !== null) {
    try {
      renderer.setMapObjects(await loadMapObjects(loaded.objects, ir));
    } catch (err) {
      console.warn(`map objects unavailable, bare ground fallback: ${String(err)}`);
    }
  }
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

  // Interactive camera: `?zoom` (+ the settler-centroid framing) is the STARTING frame; from there a
  // human pans (middle-mouse drag / arrow keys) and zooms (scroll wheel). The HUD is drawn outside the
  // camera layer below, so it stays pinned while the world moves.
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height),
  );

  const timestep = new FixedTimestep();
  let lastMs = performance.now();

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    timestep.advance(elapsed * speed, () => sim.step());
    cameraCtl.update(elapsed);
    const snap = sim.snapshot();
    // One retained update: reconcile the pooled sprites, refresh the pinned HUD, render once.
    // `app.screen` is the LIVE renderer size (it tracks window resizes), so the HUD stays pinned.
    renderer.update(snap, cameraCtl.camera(), snap.tick, {
      placement: placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', app.screen),
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log('Vinland shell up: vertical slice rendering. Drag (middle mouse) / arrows pan, wheel zooms.');
}

void main();
