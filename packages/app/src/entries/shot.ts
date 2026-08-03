import {
  buildHud,
  buildSpriteScene,
  createPixiApp,
  layoutHud,
  placeHud,
  WorldRenderer,
} from '@open-northland/render';
import { halfCellMapFromCells } from '@open-northland/sim';
import { loadTerrainMap } from '../content/map-loader.js';
import { loadHumanSpriteSheet, syntheticSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain } from '../content/terrain.js';
import { HUD_TRIBE } from '../game/rules.js';
import { runDemoWorld, terrainSceneFor } from '../game/world/index.js';
import { cameraFor } from '../view/camera/index.js';
import { floatParam, intParam } from '../view/params.js';
import { hudLabels } from '../view/projections/index.js';

/**
 * The deterministic headless render entry the screenshot harness waits on: advance N ticks at seed S,
 * draw one frame, then signal ready, with no `requestAnimationFrame` loop.
 *
 * The same `?shot&seed=…&ticks=…` produces the same draw list, but the GPU rasteriser still varies the
 * pixels, so the output is eyeballed for gross correctness and never byte-compared.
 */

/** Set on `window` once the single frame has been drawn, so Playwright can wait deterministically. */
declare global {
  interface Window {
    __opennorthlandShotReady?: boolean;
  }
}

const CANVAS_W = 960;
const CANVAS_H = 540;

/** Returns once the frame is on the GPU and the ready flag is set. */
export async function renderShot(canvas: HTMLCanvasElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const seed = intParam(params, 'seed', 7);
  const ticks = intParam(params, 'ticks', 20);

  // `?map=<id>` runs and draws a decoded map. Absent or unloadable, both fall back to the synthetic
  // grass strip, so the default `npm run shot` stays reproducible without the gitignored maps.
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;

  const sim = runDemoWorld(seed, ticks, loaded !== null ? halfCellMapFromCells(loaded) : undefined);
  const snap = sim.snapshot();
  const terrainGrid = terrainSceneFor(loaded ?? undefined);

  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  // `?atlas=real` binds the decoded human-body atlas; `?atlas` or `?atlas=synthetic` exercises the
  // textured-sprite path without copyrighted data. Absent, sprites draw as placeholder geometry, the
  // byte-reproducible default the committed shot PNG depends on.
  const sheet =
    params.get('atlas') === 'real'
      ? await loadHumanSpriteSheet()
      : wantsSyntheticAtlas(params)
        ? syntheticSpriteSheet()
        : undefined;
  // `?zoom=N` magnifies and re-centres on the sprites, so a human can judge a decoded bob's pixels.
  const camera = cameraFor(buildSpriteScene(snap), floatParam(params, 'zoom', 1), CANVAS_W, CANVAS_H);
  // `?terrain` draws the ground from decoded `text_*.pcx` textures through the approximated
  // typeId-to-pattern map. Absent, terrain stays the flat-tint default the committed PNG depends on.
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;

  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // `?hud=0` gives a clean sprite-inspection frame. The sim's tick draws the tick-driven animation for
  // this exact step.
  const hud =
    params.get('hud') !== '0'
      ? {
          placement: placeHud(layoutHud(buildHud(snap, HUD_TRIBE), hudLabels()), 'top-left', {
            width: CANVAS_W,
            height: CANVAS_H,
          }),
        }
      : undefined;
  renderer.update({ snapshot: snap, camera, tick: snap.tick, hud });

  window.__opennorthlandShotReady = true;
}

function wantsSyntheticAtlas(params: URLSearchParams): boolean {
  if (!params.has('atlas')) return false;
  const v = params.get('atlas');
  return v === '' || v === 'synthetic' || v === '1' || v === 'true';
}
