import {
  buildHud,
  buildSpriteScene,
  createPixiApp,
  layoutHud,
  placeHud,
  WorldRenderer,
} from '@vinland/render';
import { halfCellMapFromCells } from '@vinland/sim';
import { loadHumanSpriteSheet, syntheticSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain } from '../content/terrain.js';
import { HUD_TRIBE } from '../game/rules.js';
import { loadTerrainMap } from '../slice/map-loader.js';
import { runSlice, sliceTerrain } from '../slice/vertical-slice.js';
import { cameraFor } from '../view/camera.js';
import { floatParam, intParam } from '../view/params.js';

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

/**
 * Run the slice, draw a single deterministic frame to `canvas`, and flag readiness. The camera pans
 * the iso world into view (the slice's leftmost tiles project to negative screen-x, so we offset to
 * roughly centre it). Returns once the frame is on the GPU and the ready flag is set.
 */
export async function renderShot(canvas: HTMLCanvasElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const seed = intParam(params, 'seed', 7);
  const ticks = intParam(params, 'ticks', 20);

  // `?map=<id>` runs + draws an actual decoded `content/maps/<id>.json` grid: the sim navigates the
  // real grid (settlers/buildings placed on its first walkable cells) and the renderer draws it as the
  // terrain (loaded over the dev/shot vite server). Absent or unloadable, both fall back to the
  // synthetic grass strip — so the default `npm run shot` stays reproducible without the gitignored maps.
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;

  const sim = runSlice(seed, ticks, loaded !== null ? halfCellMapFromCells(loaded) : undefined);
  const snap = sim.snapshot();
  const terrainGrid = sliceTerrain(loaded ?? undefined);

  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  // `?atlas=real` binds the REAL decoded human-body atlas (settlers draw actual decoded pixels — the
  // human-gated decoder/render check; gitignored content over the /bobs server, see content/sprite-sheet.ts).
  // `?atlas` (or `?atlas=synthetic`) binds the FREE synthetic atlas so the textured-sprite draw path is
  // exercised without copyrighted data. Absent, sprites draw as placeholder geometry — the
  // byte-reproducible default the committed shot PNG depends on.
  const sheet =
    params.get('atlas') === 'real'
      ? await loadHumanSpriteSheet()
      : wantsSyntheticAtlas(params)
        ? syntheticSpriteSheet()
        : undefined;
  // `?zoom=N` magnifies + re-centres on the sprites so a human can judge a decoded bob's pixels (a
  // ~30px settler is otherwise lost on the canvas); absent, the historical centre-ish pan at scale 1.
  const camera = cameraFor(buildSpriteScene(snap), floatParam(params, 'zoom', 1), CANVAS_W, CANVAS_H);
  // `?terrain` draws the ground from REAL decoded `text_*.pcx` textures (the approximated typeId→pattern
  // map) for the human pixel-check; gitignored content over the /ir.json + /textures server (see
  // content/terrain.ts). Absent, terrain stays the reproducible flat-tint default the committed PNG depends on.
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;

  // The retained renderer draws the single deterministic frame: terrain meshed once, sprites pooled, one
  // render pass. The default frame closely matches the old immediate-mode shot, but is NOT pixel-identical:
  // the flat-tint ground drops the old per-cell grid outline (`buildFlatTerrain`), same as the textured path.
  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // Overlay the single-tribe (viking) HUD panel unless `?hud=0` (a clean sprite-inspection
  // frame). Pass the sim's tick so the tick-driven animation draws the frame for this exact step.
  const hud =
    params.get('hud') !== '0'
      ? {
          placement: placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', {
            width: CANVAS_W,
            height: CANVAS_H,
          }),
        }
      : undefined;
  renderer.update({ snapshot: snap, camera, tick: snap.tick, hud });

  window.__vinlandShotReady = true;
}

/** True when the URL opts into the synthetic atlas (`?atlas`, `?atlas=synthetic`, `?atlas=1`). */
function wantsSyntheticAtlas(params: URLSearchParams): boolean {
  if (!params.has('atlas')) return false;
  const v = params.get('atlas');
  return v === '' || v === 'synthetic' || v === '1' || v === 'true';
}
