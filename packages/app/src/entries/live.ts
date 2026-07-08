import {
  CALIBRATED_HALF_H,
  CALIBRATED_HALF_W,
  type Camera,
  WorldRenderer,
  buildHud,
  buildSpriteScene,
  createWindowPixiApp,
  layoutHud,
  makeElevationField,
  placeHud,
  setTilePitch,
} from '@vinland/render';
import { FixedTimestep, type SimEvent } from '@vinland/sim';
import { createSoundDriver } from '../content/audio.js';
import { loadIr } from '../content/ir.js';
import { loadMapObjects } from '../content/objects.js';
import { HARVEST_ATOMIC } from '../content/settler-gfx.js';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { loadRealTerrain } from '../content/terrain.js';
import { HUD_TRIBE, HUMAN_PLAYER } from '../game/rules.js';
import { DEFAULT_UI_SCALE } from '../hud/tool-panel/layout.js';
import {
  loadTerrainMap,
  runAuthoredSlice,
  runSlice,
  sandboxGoods,
  sliceTerrain,
} from '../slice/vertical-slice.js';
import { cameraCenteredOnTile, cameraFor, createCameraController } from '../view/camera.js';
import {
  applyGameSpeed,
  menuEntriesFromContent,
  mountGameToolPanel,
  shiftHud,
} from '../view/game-tool-panel.js';
import { enableAudioOnGesture } from '../view/overlay.js';
import { mountPerfOverlay } from '../view/perf-overlay.js';
import { createUnitControls } from '../view/unit-controls.js';
import { professionsFromContent } from '../view/unit-panel.js';
import { floatParam, intParam } from './params.js';

/**
 * The default full tile-diamond width in px (`2 × CALIBRATED_HALF_W`) when `?pitch=` is absent — the
 * cell width MEASURED from the original game (see iso.ts / source basis "projection").
 */
const DEFAULT_TILE_WIDTH = 2 * CALIBRATED_HALF_W;

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

/** The slice sim's deterministic seed. */
const SLICE_SEED = 7;

/**
 * Parse `?center=x,y` (integer tile coords) into a camera centred on that tile (via
 * {@link cameraCenteredOnTile}), or `null` for an absent/malformed value so the caller falls back to the
 * default settler-centroid framing.
 */
function centerTile(raw: string | null, zoom: number, width: number, height: number): Camera | null {
  if (raw === null) return null;
  const parts = raw.split(',').map((s) => Number.parseInt(s, 10));
  const [tx, ty] = parts;
  if (parts.length !== 2 || tx === undefined || ty === undefined || Number.isNaN(tx) || Number.isNaN(ty)) {
    return null;
  }
  return cameraCenteredOnTile(tx, ty, zoom, width, height);
}

export async function renderLive(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const app = await createWindowPixiApp(canvas);
  // `?pitch=<fullTileWidth>` — the live verification knob for the master sprite-vs-terrain scale (the
  // whole look; a human dials it, an agent can't self-judge pixels — see `iso.ts`/source basis).
  // Applied BEFORE any projection (scene build, terrain mesh, object lattice) so every layer picks it up.
  // The height follows the MEASURED ratio (CALIBRATED_HALF_H/CALIBRATED_HALF_W ≈ 1.12 — the original's
  // cells are near-square on screen, not iso 2:1); `?pitchy=<cellDiamondHeight>` overrides it separately.
  // NOTE `?pitchy` is the full DIAMOND height (2× the row step): the measured 68×38 metric is
  // `?pitch=68&pitchy=76` — passing the row step (38) squashes the world 2× (the aliasing failure the
  // recalibration fixed).
  const tileWidth = floatParam(params, 'pitch', DEFAULT_TILE_WIDTH);
  const halfW = tileWidth / 2;
  const cellDown = floatParam(params, 'pitchy', 2 * halfW * (CALIBRATED_HALF_H / CALIBRATED_HALF_W));
  setTilePitch(halfW, cellDown / 2);
  const mapId = params.get('map');
  const loaded = mapId !== null ? await loadTerrainMap(mapId) : null;
  const terrainGrid = sliceTerrain(loaded ?? undefined);
  // The decoded map's terrain-height field (flat when the map carries no `lmhe` lane). The renderer
  // builds its own from the terrain grid for the ground mesh + entity lift; this shared instance lifts
  // the map objects at load and drives elevation-aware picking (worldToTile) below.
  const elevation = makeElevationField(loaded?.elevation, loaded?.width ?? 0, loaded?.height ?? 0);
  // Real decoded graphics are the DEFAULT (see resolveSpriteSheet): absent or `?atlas=real` draws the real
  // atlases (gitignored content over the /bobs server), degrading to synthetic markers when content/ is
  // missing. `?atlas=synthetic` forces the free markers; `?atlas=none` draws placeholder geometry. Shared
  // with the `?scene=` entry.
  const sheet = await resolveSpriteSheet(params, sandboxGoods());
  // Real ground textures + map objects are the DEFAULT (like the sprite atlases), each behind its
  // own opt-out (`?terrain=off` → flat tint, `?objects=off` → bare ground) and each degrading
  // gracefully when content/ is absent — the shared multi-MB ir.json is fetched once for everything
  // (the memoized loadIr; the sprite-sheet resolution above already paid it).
  let ir = null;
  const wantTerrain = params.get('terrain') !== 'off';
  const wantObjects = loaded?.objects !== undefined && params.get('objects') !== 'off';
  const wantEntities = loaded?.entities !== undefined;
  if (wantTerrain || wantObjects || wantEntities) {
    ir = await loadIr();
    if (ir === null) console.warn('content/ir.json unavailable, placeholder graphics fallback');
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
      renderer.setMapObjects(await loadMapObjects(loaded.objects, ir, elevation));
    } catch (err) {
      console.warn(`map objects unavailable, bare ground fallback: ${String(err)}`);
    }
  }
  // `?zoom=N` magnifies + re-centres on the sprites (the same knob the shot uses) so a decoded bob is
  // big enough to inspect in the live view; absent, scale 1.
  const zoom = floatParam(params, 'zoom', 1);
  // Playback control. `?speed=` seeds the initial wall-clock multiplier (default ×1; pass e.g.
  // `?live&speed=0.5` for a calm, sub-1× pace the panel's discrete speed button can't reach). The tool
  // panel's game-speed button (mounted below) then drives it live — cycling ×1 → ×2 → ×3 → pause — without
  // clobbering this seed at mount.
  const control = { paused: false, speed: floatParam(params, 'speed', 1) };
  // The slice sim, kept live and stepped one tick per fixed interval below. A map that carries
  // AUTHORED entities (map.cif StaticObjects) places those buildings/settlers at their authored
  // cells; else the demo slice — on a loaded map's walkable cells, or the synthetic strip. The
  // demo's units are owned by the human player so they can be selected + ordered.
  const sim =
    (wantEntities && loaded?.entities !== undefined && ir !== null
      ? runAuthoredSlice(SLICE_SEED, 0, loaded, loaded.entities, ir)
      : null) ?? runSlice(SLICE_SEED, 0, loaded ?? undefined, HUMAN_PLAYER);

  // Interactive camera: `?zoom` (+ the settler-centroid framing) is the STARTING frame; from there a
  // human pans (middle-mouse drag / arrow keys) and zooms (scroll wheel). The HUD is drawn outside the
  // camera layer below, so it stays pinned while the world moves.
  // `?center=x,y` overrides the starting frame to centre a given tile (a decoded map's feature — a
  // bridge, a coastline — the settler-centroid framing would never land on); a human inspection knob
  // like `?zoom`, degrading to the default framing on a malformed value.
  const initialCamera =
    centerTile(params.get('center'), zoom, app.screen.width, app.screen.height) ??
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height);
  const cameraCtl = createCameraController(canvas, initialCamera);

  // Original decoded sounds, played positionally: action SFX + terrain ambient viewport-culled +
  // attenuated + panned by the camera, plus non-spatial life-event jingles (see @vinland/audio). Real
  // sounds are default-on (like the atlases/textures); `?sound=off` opts out, and a checkout without
  // `content/` (no sound bank) degrades to silence via createSoundDriver → null. Browser autoplay policy
  // keeps audio suspended until a user gesture; the enable-sound prompt persists until the context is
  // confirmed running, so the gesture can't be dropped while the slice is still loading.
  const wantSound = params.get('sound') !== 'off';
  const soundDriver = wantSound ? createSoundDriver(await loadIr(), { chopAtomicId: HARVEST_ATOMIC }) : null;
  if (soundDriver !== null) enableAudioOnGesture(soundDriver);

  // On-canvas FPS + entity/drawn/pooled readout (bottom-left) so a human can judge whether the map holds
  // a frame rate and whether culling is biting (`drawn` ≪ `entities` zoomed in) — the same instrument the
  // `?scene=` entry mounts. Real-GPU only: headless Chromium is software-GL, ~50× low (docs/AGENTS).
  const perf = mountPerfOverlay();

  // The original LEFT tool panel — the standard game HUD, mounted here in the live sandbox exactly as it is
  // over every scene (via the shared helper). Its game-speed button drives `control`, the building menu
  // enqueues `placeBuilding` on a map click, and it claims its own clicks so the HUD never falls through to
  // world picking.
  const toolPanel = await mountGameToolPanel({
    app,
    canvas,
    params,
    camera: () => cameraCtl.camera(),
    enqueue: (command) => sim.enqueue(command),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // a placement click on a lifted hill resolves to the tile drawn there
    buildings: menuEntriesFromContent(sim.content),
    tribe: HUD_TRIBE,
    owner: HUMAN_PLAYER,
    onSpeed: (spec) => applyGameSpeed(control, spec),
  });

  // RTS unit control: left-click / drag-box to select the human's units, right-click to send them,
  // Space to open the selected-unit panel (profession change). The professions the panel offers are the
  // slice content's jobs (minus idle). Reads the camera + snapshot through closures, issues commands
  // into the sim.
  const controls = await createUnitControls({
    app,
    canvas,
    uiscale: intParam(params, 'uiscale', DEFAULT_UI_SCALE, 1),
    camera: () => cameraCtl.camera(),
    snapshot: () => sim.snapshot(),
    mapSize: { width: terrainGrid.width, height: terrainGrid.height },
    elevation, // right-click on a lifted hill resolves to the tile drawn there
    humanPlayer: HUMAN_PLAYER,
    professions: professionsFromContent(sim.content),
    enqueue: (command) => sim.enqueue(command),
    boundsOf: (ref) => renderer.entityBounds(ref), // pixel-accurate picking against the real sprite
    claimPointer: (x: number, y: number) => toolPanel.claimPointer(x, y),
  });

  const timestep = new FixedTimestep();
  let lastMs = performance.now();
  // The fixed-timestep interpolation fraction the renderer lerps entity anchors by — refreshed each
  // un-paused frame from `advance` (a pause freezes it, so units hold their drawn spot mid-leg).
  let renderAlpha = 1;

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Collect events from EVERY sim step this frame (not just the last tick): the fixed-timestep loop
    // may advance several ticks between rendered frames, and each step clears the buffer — so an audio
    // trigger on an intermediate tick would otherwise be lost.
    const frameEvents: SimEvent[] = [];
    if (!control.paused) {
      renderAlpha = timestep.advance(elapsed * control.speed, () => {
        sim.step();
        frameEvents.push(...sim.events.current());
      });
    }
    cameraCtl.update(elapsed);
    const snap = sim.snapshot();
    // Build the tribe HUD read-view ONCE and share it between the always-on stocks panel and the tool
    // panel's statistics window (so the stats window adds no second O(entities) scan).
    const hud = layoutHud(buildHud(snap, HUD_TRIBE));
    // Re-place the tool panel's screen-space sprites BEFORE the renderer's render, and refresh an open stats window.
    toolPanel.controller.update(hud);
    // One retained update: reconcile the pooled sprites, draw the selection rings, refresh the pinned
    // HUD (shifted right to clear the left strip), render once. `app.screen` tracks window resizes.
    renderer.update(
      snap,
      cameraCtl.camera(),
      snap.tick,
      { placement: shiftHud(placeHud(hud, 'top-left', app.screen), toolPanel.hudShift) },
      controls.selectedIds(),
      renderAlpha,
    );
    controls.tick(snap); // reuse the frame's snapshot — don't rebuild a second one
    // Sound is a pure consumer of the same snapshot + events render reads: fire this frame's one-shots
    // and refresh the ambient beds under the (moving) camera. No-op until the gesture resumes audio.
    if (soundDriver !== null) {
      soundDriver.update({
        events: frameEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: terrainGrid,
        dtMs: elapsed,
      });
    }
    perf.update(elapsed, { entities: snap.entities.length, ...renderer.stats() });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log(
    'Vinland live slice up: LPM zaznacz / przeciągnij ramką, PPM wyślij, Spacja panel; middle-drag / arrows pan, wheel zoom.',
  );
}
