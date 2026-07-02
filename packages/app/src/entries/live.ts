import {
  WorldRenderer,
  buildHud,
  buildSpriteScene,
  createWindowPixiApp,
  layoutHud,
  placeHud,
} from '@vinland/render';
import { FixedTimestep } from '@vinland/sim';
import { loadMapObjects } from '../content/objects.js';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { fetchTerrainIr, loadRealTerrain } from '../content/terrain.js';
import { demoGoods, loadTerrainMap, runSlice, sliceTerrain } from '../slice/vertical-slice.js';
import { cameraFor, createCameraController } from '../view/camera.js';
import { floatParam } from './params.js';

/**
 * The live sandbox entry (`?live`, and the target of `?map=<id>`): a deterministic vertical slice driven
 * by the fixed-timestep loop, drawn every frame so `npm run dev` is watchable. The default landing is the
 * MENU ({@link import('./menu.js')}); this is the "just show me the world moving" view it links to.
 *
 * The backing store tracks the window at 1:1 pixels (`createWindowPixiApp`), so resizing the browser
 * changes the visible field, never the scale — read live dimensions from `app.screen`. `?map=<id>` draws
 * an actual decoded `content/maps/<id>.json` grid as the terrain; absent or unloadable, it falls back to
 * the synthetic grass strip (the maps are gitignored).
 */

/** The slice is single-tribe (viking, tribe 1); draw its HUD panel each frame. */
const HUD_TRIBE = 1;
/** The slice sim's deterministic seed. */
const SLICE_SEED = 7;

export async function renderLive(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
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
  const sim = runSlice(SLICE_SEED, 0, loaded ?? undefined);

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

  console.log('Vinland live slice up: drag (middle mouse) / arrows pan, wheel zooms.');
}
