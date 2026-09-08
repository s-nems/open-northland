import { seatColourOf } from '@open-northland/lockstep';
import { createWindowPixiApp, makeElevationField, type TerrainTextureSet } from '@open-northland/render';
import { buildCollisionTerrain } from '../content/collision.js';
import { buildingFootprints } from '../content/ir/joins.js';
import { loadIr } from '../content/ir/load.js';
import { loadMapScript, loadTerrainMap } from '../content/map-loader.js';
import { loadMapObjects } from '../content/objects.js';
import { resolveSpriteSheet } from '../content/sprite-sheet/index.js';
import { loadRealTerrain } from '../content/terrain.js';
import { diag } from '../diag/index.js';
import { mapStartFocus } from '../game/map-start.js';
import { sandboxGoods } from '../game/sandbox/index.js';
import { mapSession } from '../game/session-url.js';
import { runAuthoredMap, runBareMap, terrainSceneFor } from '../game/world/index.js';
import { worldTribes } from '../game/world-tribes.js';
import { cameraCenteredOnTile } from '../view/camera/index.js';
import { floatParam, intParam, postFxParam } from '../view/params.js';
import { createWorldRenderer, loadLocalizedRealContent } from '../view/runtime/world-bootstrap.js';

/**
 * `?backdrop=<mapId>` captures a menu backdrop: boot a decoded map as a calm ambient settlement with no
 * HUD and no RAF loop, draw one frame, then raise the ready flag the `?shot` harness waits on.
 *
 * Dev-only: a missing map or `content/` throws instead of degrading, because a capture harness must
 * never silently screenshot a blank canvas.
 */

/** Close enough to read as a settlement rather than a map overview. */
const BACKDROP_ZOOM = 1.25;
/** Ambient seed; captures never replay, so any fixed seed serves. */
const BACKDROP_SEED = 7;

export async function renderBackdrop(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const mapId = params.get('backdrop');
  if (mapId === null || mapId === '') throw new Error('backdrop: pass ?backdrop=<mapId>');

  const loaded = await loadTerrainMap(mapId);
  if (loaded === null) throw new Error(`backdrop: map "${mapId}" unavailable (content/ missing?)`);
  const script = await loadMapScript(mapId);
  const { goodNames, realContent } = await loadLocalizedRealContent(params);
  const ir = await loadIr();
  if (ir === null) throw new Error('backdrop: ir.json unavailable (content/ missing?)');
  const tribes = worldTribes(script, loaded.entities, ir);
  const sheet = await resolveSpriteSheet(realContent?.content.goods ?? sandboxGoods(), tribes);
  const terrain: TerrainTextureSet = await loadRealTerrain(ir);

  // Deliberately no stored render scale, and post-fx pinned on unless the URL overrides it: a
  // capture's pixel output must not vary with machine settings.
  const app = await createWindowPixiApp(canvas);
  if (postFxParam(params) === null) params.set('postfx', 'on');
  const session = mapSession(params, script?.players ?? []);
  const renderer = createWorldRenderer(app, params, sheet, seatColourOf(session));
  const terrainGrid = terrainSceneFor(loaded);
  renderer.setTerrain(terrainGrid, terrain);
  const elevation = makeElevationField(loaded.elevation, loaded.width, loaded.height);
  if (loaded.objects !== undefined) {
    try {
      const objects = await loadMapObjects(loaded.objects, ir, elevation, renderer.brightnessField());
      renderer.setMapObjects(objects.sprites);
    } catch (err) {
      diag.warn('content', `backdrop objects unavailable, bare ground: ${String(err)}`);
    }
  }

  // The map's authored cast idling on the real collision grid: no AI seats, no fog, and harvestables
  // left in the static collision grid.
  const simMap = buildCollisionTerrain(loaded, ir);
  const contentOptions = {
    footprints: buildingFootprints(ir),
    goodNames,
    ...(realContent !== null ? { content: realContent.content } : {}),
  };
  // One tick applies the authored placements (queued commands land on the first step). The script's
  // diplomacy rows ride along, so an ambient coop cast idles instead of fighting its allies.
  const diplomacy = script?.diplomacy ?? [];
  const sim =
    (loaded.entities !== undefined
      ? runAuthoredMap(BACKDROP_SEED, 1, simMap, loaded.entities, ir, contentOptions, diplomacy)
      : null) ?? runBareMap(BACKDROP_SEED, simMap, contentOptions, diplomacy);
  // A pre-roll turns needs off, like scene worlds: a foodless ambient world would otherwise starve its
  // cast while the extra ticks run.
  const ticks = intParam(params, 'ticks', 1);
  if (ticks > 1) {
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    for (let tick = ticks; tick > 1; tick -= 1) sim.step();
  }

  const focus = focusParam(params) ?? mapStartFocus(sim.snapshot(), terrainGrid.width, terrainGrid.height);
  const zoom = floatParam(params, 'zoom', BACKDROP_ZOOM);
  const snap = sim.snapshot();
  renderer.update({
    snapshot: snap,
    camera: cameraCenteredOnTile(focus.x, focus.y, zoom, app.screen.width, app.screen.height),
    tick: snap.tick,
    alpha: 1,
  });

  window.__opennorthlandShotReady = true;
}

/** `?focus=x,y` in tile coordinates; absent or malformed reads as no override. */
function focusParam(params: URLSearchParams): { x: number; y: number } | null {
  const raw = params.get('focus');
  if (raw === null) return null;
  const [x, y] = raw.split(',').map((part) => Number.parseInt(part, 10));
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return null;
  return { x, y };
}
