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
import { loadTerrainMap, runSlice, sliceTerrain } from './vertical-slice.js';

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

  // `?map=<id>` runs + draws an actual decoded `content/maps/<id>.json` grid: the sim navigates the
  // real grid (settlers/buildings placed on its first walkable cells) and the renderer draws it as the
  // terrain (loaded over the dev/shot vite server). Absent or unloadable, both fall back to the
  // synthetic grass strip — so the default `npm run shot` stays reproducible without the gitignored maps.
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;

  const sim = runSlice(seed, ticks, loaded ?? undefined);
  const snap = sim.snapshot();
  const scene = buildScene(snap, sliceTerrain(loaded ?? undefined));

  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  // `?atlas` (or `?atlas=synthetic`) binds the FREE synthetic atlas so the textured-sprite draw path
  // is exercised (a human eyeballs the textured branch). Absent, sprites draw as placeholder geometry
  // — the byte-reproducible default the committed shot PNG depends on (real bobs are gitignored).
  const sheet = wantsSyntheticAtlas(params) ? syntheticSpriteSheet() : undefined;
  // Pan the iso strip into the centre of the canvas (its tiles span screen-x roughly [-row, +cols]).
  renderScene(app, scene, { offsetX: CANVAS_W / 2, offsetY: CANVAS_H / 3 }, sheet);
  // Overlay the single-tribe (viking, tribe 1) HUD panel on top of the scene, so the human eyeballing
  // the shot also sees the on-screen panel's typography (the un-self-verifiable half of the HUD).
  renderHud(app, placeHud(layoutHud(buildHud(snap, 1)), 'top-left', { width: CANVAS_W, height: CANVAS_H }));

  window.__vinlandShotReady = true;
}

/** True when the URL opts into the synthetic atlas (`?atlas`, `?atlas=synthetic`, `?atlas=1`). */
function wantsSyntheticAtlas(params: URLSearchParams): boolean {
  if (!params.has('atlas')) return false;
  const v = params.get('atlas');
  return v === '' || v === 'synthetic' || v === '1' || v === 'true';
}

/** Build the {@link SpriteSheet} for the free synthetic atlas (geometry + bindings + GPU texture). */
function syntheticSpriteSheet(): SpriteSheet {
  return {
    source: createSyntheticAtlasSource(),
    atlas: syntheticAtlasFrames(),
    bindings: SYNTHETIC_BINDINGS,
  };
}
