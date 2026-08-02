import { createWindowPixiApp, makeElevationField, type TerrainTextureSet } from '@open-northland/render';
import { FixedTimestep } from '@open-northland/sim';
import { buildCollisionTerrain } from '../../content/collision.js';
import { buildingFootprints } from '../../content/ir/joins.js';
import { loadIr } from '../../content/ir/load.js';
import { loadMapObjects } from '../../content/objects.js';
import { resolveSpriteSheet } from '../../content/sprite-sheet/index.js';
import { loadRealTerrain, MissingTerrainError } from '../../content/terrain.js';
import { diag } from '../../diag/index.js';
import { mapStartFocus } from '../../game/map-start.js';
import { colorOverridesParam, playerColourMap } from '../../game/player-session.js';
import { sandboxGoods } from '../../game/sandbox/index.js';
import { loadMapScript, loadTerrainMap } from '../../slice/map-loader.js';
import { runAuthoredSlice, runBareMap, sliceTerrain } from '../../slice/vertical-slice.js';
import { cameraCenteredOnTile } from '../../view/camera/index.js';
import { startRafLoop } from '../../view/runtime/raf-loop.js';
import { createWorldRenderer, loadLocalizedRealContent } from '../../view/runtime/world-bootstrap.js';
import { cameraDrift } from './model.js';

/**
 * The live settlement behind the menu (docs/design/main-menu/README.md "Background stack" layer 1):
 * the decoded PROLOG map run by the ambient sim and drawn under the CSS grade, with the slow camera
 * drift from {@link cameraDrift}.
 */

/** The decoded map behind the menu: CULTURESNATION's intro map ("CULTURESNATION: PROLOG"). */
const MENU_SCENE_MAP = 'demo_mainmenu_10';
/** Ambient sim seed; the menu never replays, so any fixed seed serves. */
const MENU_SCENE_SEED = 7;
/** Framing zoom: closer than the play default so the backdrop reads as a scene, not a map overview. */
const MENU_SCENE_ZOOM = 1.25;
/** Per-frame ceiling on drift-clock advance; caps a hidden tab's gap at one slow frame's worth. */
const MAX_DRIFT_STEP_MS = 100;

/**
 * Boot the scene into `canvas` (already parented inside the graded scene layer) and start its
 * render loop. On success `host` gets `is-live`, which crossfades the canvas in over the static
 * art. Never throws: every degrade path (missing `content/`, a failed loader) logs one bounded
 * diagnostic and leaves the static backdrop standing.
 */
export async function startMenuScene(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
): Promise<void> {
  try {
    if (await boot(host, canvas, params)) return;
    diag.warn('content', 'menu scene unavailable, static backdrop stands');
  } catch (err) {
    diag.warn('content', `menu scene failed, static backdrop stands: ${String(err)}`);
  }
}

/** The fallible assembly behind {@link startMenuScene}; false = degrade to the static backdrop. */
async function boot(host: HTMLElement, canvas: HTMLCanvasElement, params: URLSearchParams): Promise<boolean> {
  // Content first, GL context after: a bare checkout should not pay for a WebGL context it won't use.
  const loaded = await loadTerrainMap(MENU_SCENE_MAP);
  if (loaded === null) return false;
  const script = await loadMapScript(MENU_SCENE_MAP);
  const { goodNames, realContent } = await loadLocalizedRealContent(params);
  const sheet = await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods());
  const ir = await loadIr();
  if (ir === null) return false;
  let terrain: TerrainTextureSet;
  try {
    terrain = await loadRealTerrain(ir);
  } catch (err) {
    if (!(err instanceof MissingTerrainError)) throw err;
    return false;
  }

  const app = await createWindowPixiApp(canvas);
  const renderer = createWorldRenderer(
    app,
    params,
    sheet,
    playerColourMap(script, colorOverridesParam(params)),
  );
  const terrainGrid = sliceTerrain(loaded);
  renderer.setTerrain(terrainGrid, terrain);
  const elevation = makeElevationField(loaded.elevation, loaded.width, loaded.height);
  if (loaded.objects !== undefined) {
    try {
      const objects = await loadMapObjects(loaded.objects, ir, elevation, renderer.brightnessField());
      renderer.setMapObjects(objects.sprites);
    } catch (err) {
      diag.warn('content', `menu scene objects unavailable, bare ground: ${String(err)}`);
    }
  }

  // The ambient sim: the map's authored settlers idling on the real collision grid. No AI seats, no
  // fog, no resource spawns - the backdrop stays a calm settlement, not a running match. Unlike the
  // map entry, harvestables stay in the static collision grid: nothing works them here, and the
  // render-only trees must still block a wandering settler.
  const simMap = buildCollisionTerrain(loaded, ir);
  const contentOptions = {
    footprints: buildingFootprints(ir),
    goodNames,
    ...(realContent !== null ? { content: realContent.content } : {}),
  };
  // One tick applies the authored placements (queued commands land on the first step).
  const sim =
    (loaded.entities !== undefined
      ? runAuthoredSlice(MENU_SCENE_SEED, 1, simMap, loaded.entities, ir, contentOptions)
      : null) ?? runBareMap(MENU_SCENE_SEED, simMap, contentOptions);
  // Needs off, like scene worlds (scenes/runtime.ts): a foodless backdrop world would otherwise
  // starve its whole cast dead within minutes of the menu sitting open.
  sim.enqueue({ kind: 'setNeedsEnabled', enabled: false });

  const focus = mapStartFocus(sim.snapshot(), terrainGrid.width, terrainGrid.height);
  // Base framing recomputed per draw, so both the animated path (every RAF) and the frozen path
  // (the resize listener below) re-centre on the live viewport.
  const frame = (driftMs: number, alpha: number): void => {
    const base = cameraCenteredOnTile(focus.x, focus.y, MENU_SCENE_ZOOM, app.screen.width, app.screen.height);
    const { dx, dy } = cameraDrift(driftMs);
    const snap = sim.snapshot();
    renderer.update({
      snapshot: snap,
      camera: { ...base, offsetX: base.offsetX + dx, offsetY: base.offsetY + dy },
      tick: snap.tick,
      alpha,
    });
  };

  frame(0, 1);
  host.classList.add('is-live');
  // The design's reduced-motion behavior: freeze on the authored frame, keep the grade. Pixi's
  // resize plugin re-renders the retained stage on resize with the old framing and culling, so the
  // frozen frame must be redrawn for the new viewport.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // One frame late, after the plugin's own queued resize has applied the new screen size.
    window.addEventListener('resize', () => requestAnimationFrame(() => frame(0, 1)));
    return true;
  }

  const timestep = new FixedTimestep();
  let lastMs: number | null = null;
  let driftMs = 0;
  // The stop handle is deliberately dropped: every way out of the menu is a URL navigation (full
  // reload), so the page teardown is the loop's lifetime. An in-page exit would need to keep it.
  startRafLoop((nowMs) => {
    const elapsed = lastMs === null ? 0 : nowMs - lastMs;
    lastMs = nowMs;
    // Clamped so a backgrounded tab resumes the drift where it left off instead of teleporting the
    // camera by the hidden time; the timestep's own step cap already drops the sim backlog.
    driftMs += Math.min(elapsed, MAX_DRIFT_STEP_MS);
    const alpha = timestep.advance(elapsed, () => sim.step());
    frame(driftMs, alpha);
  });
  return true;
}
