import {
  type HudPlacement,
  WorldRenderer,
  buildHud,
  buildSpriteScene,
  createWindowPixiApp,
  layoutHud,
  placeHud,
  terrainMapToScene,
} from '@vinland/render';
import { FixedTimestep, type SimEvent } from '@vinland/sim';
import { vikingBuildingByTypeId } from '../catalog/buildings.js';
import { createSoundDriver, fetchAudioIr } from '../content/audio.js';
import { HARVEST_ATOMIC } from '../content/settler-gfx.js';
import { resolveSpriteSheet } from '../content/sprite-sheet.js';
import { loadRealTerrain } from '../content/terrain.js';
import type { MenuBuildingEntry } from '../hud/building-menu.js';
import { DEFAULT_UI_SCALE, buildToolPanelLayout } from '../hud/tool-panel-layout.js';
import { mountToolPanel } from '../hud/tool-panel.js';
import { SCENES, createSceneSim, getScene } from '../scenes/index.js';
import { backingScale, cameraFor, createCameraController } from '../view/camera.js';
import { enableAudioOnGesture } from '../view/overlay.js';
import { mountPerfOverlay } from '../view/perf-overlay.js';
import { clampTile, screenToWorld, worldToTile } from '../view/picking.js';
import { mountSceneOverlay, mountUnknownSceneOverlay } from '../view/scene-overlay.js';
import { createUnitControls } from '../view/unit-controls.js';
import { professionsFromContent } from '../view/unit-panel.js';
import { floatParam, intParam } from './params.js';

/** The buildings the tool-panel menu lists: the scene's own building types, labelled via the viking catalog. */
function menuEntriesFromContent(content: {
  buildings: readonly { typeId: number; id: string; kind: string }[];
}): MenuBuildingEntry[] {
  return content.buildings.map((b) => ({
    typeId: b.typeId,
    label: vikingBuildingByTypeId(b.typeId)?.label ?? b.id,
    kind: b.kind,
  }));
}

/** Shift a HUD placement right by `dx` px (to clear the left tool-panel strip when it is mounted). */
function shiftHud(p: HudPlacement, dx: number): HudPlacement {
  if (dx === 0) return p;
  return { ...p, panelX: p.panelX + dx, rows: p.rows.map((r) => ({ ...r, x: r.x + dx })) };
}

/**
 * The `?scene=<id>` entry: render a registered **acceptance scene** live, with the checklist overlay,
 * so a human can watch the mechanic and sign off. The SAME `?atlas`/`?terrain`/`?zoom`/`?speed` flags
 * the live slice honours work here (e.g. `?scene=all-buildings&zoom=2` to magnify one building). Real
 * decoded graphics are the DEFAULT now (`resolveSpriteSheet`) — no `?atlas=real` needed; `?atlas=none`
 * opts out to placeholder geometry. The sim is the exact one the headless acceptance test runs —
 * determinism guarantees the human watches what the test proved (see docs/SCENES.md).
 */

/** The acceptance scenes are single-tribe viking (tribe 1); draw that tribe's HUD panel each frame. */
const HUD_TRIBE = 1;
/** Owned scene units belong to this player, so the interactive select/order controls apply to them. */
const HUMAN_PLAYER = 0;

export async function renderSceneMode(
  canvas: HTMLCanvasElement,
  sceneId: string,
  params: URLSearchParams,
): Promise<void> {
  const scene = getScene(sceneId);
  if (scene === undefined) {
    mountUnknownSceneOverlay(
      sceneId,
      SCENES.map((s) => s.id),
    );
    return;
  }

  // Window-sized 1:1 backing store: resizing the browser changes the visible field, never the scale.
  const app = await createWindowPixiApp(canvas);
  const terrainGrid = terrainMapToScene(scene.terrain);
  // The scene's own goods key the per-good carry looks (content-relative ids — the scene knows them).
  const sheet = await resolveSpriteSheet(params, scene.content.goods);
  const terrain = params.has('terrain') ? await loadRealTerrain() : undefined;
  const zoom = floatParam(params, 'zoom', scene.initialZoom ?? 1);
  // Integer UI scale for the tool panel (`?uiscale=1|2|3`); its pinned geometry is multiplied by this.
  const uiscale = intParam(params, 'uiscale', DEFAULT_UI_SCALE, 1);
  // How far the always-on stocks HUD is shifted right to sit beside the strip (0 when the panel is off).
  const hudShift = scene.toolPanel === true ? buildToolPanelLayout(uiscale).width + 6 : 0;

  // Retained renderer: mesh the terrain ONCE, then reuse a pooled sprite graph each frame (no per-frame
  // object churn), so a big scene renders + deep-zoom-outs without exhausting the GPU.
  const renderer = new WorldRenderer(app, { sheet });
  renderer.setTerrain(terrainGrid, terrain);
  // FPS / entity / drawn / pooled readout (bottom-left) so a human can judge render performance at scale
  // — the instrument the stress scene is watched with (and harmless on the small scenes).
  const perf = mountPerfOverlay();

  // Mutable playback control the overlay buttons drive. `sim` is reassigned on restart (a fresh
  // deterministic run), so the loop reads it through the closure each frame.
  const control = { paused: false, stepOnce: false, speed: floatParam(params, 'speed', 0.5) };
  let sim = createSceneSim(scene);

  const overlay = mountSceneOverlay(scene, {
    initialSpeed: control.speed,
    onTogglePause: () => {
      control.paused = !control.paused;
      return control.paused;
    },
    onStep: () => {
      control.stepOnce = true;
    },
    onRestart: () => {
      sim = createSceneSim(scene);
      timestep = new FixedTimestep(); // fresh accumulator so the replay starts on a clean tick boundary
      controls.clearSelection(); // the rebuilt sim mints new entity ids — drop the stale selection
    },
    onSpeed: (v) => {
      control.speed = v;
    },
  });

  // Interactive camera over the scene: `?zoom` is the starting frame, then the human pans (middle-mouse
  // drag / arrow keys) and zooms (scroll wheel). Survives an overlay restart (the sim is rebuilt, the
  // camera isn't), so the framing the human set up persists across replays.
  const cameraCtl = createCameraController(
    canvas,
    cameraFor(buildSpriteScene(sim.snapshot()), zoom, app.screen.width, app.screen.height),
  );

  // Original decoded sounds over the scene (default-on; `?sound=off` opts out): positional action SFX +
  // terrain ambient + non-spatial jingles + on-screen settler voice chatter — so a crowd scene murmurs.
  // Suspended until a user gesture (autoplay policy); silent without `content/`. The prompt persists until
  // the context is confirmed running, so the gesture can't be missed while the scene loads. See @vinland/audio.
  const wantSound = params.get('sound') !== 'off';
  const soundDriver = wantSound
    ? createSoundDriver(await fetchAudioIr(), { chopAtomicId: HARVEST_ATOMIC })
    : null;
  if (soundDriver !== null) enableAudioOnGesture(soundDriver);

  // The original LEFT tool panel (opt-in per scene): the toolbar strip + buttons + working game-speed
  // button, and the building/statistics windows, drawn screen-space over the world. It claims its own
  // clicks (`claimsPointer`) so a press on the HUD never reaches world picking, drives the loop's speed
  // through `onSpeedChange`, and enqueues `placeBuilding` for a menu selection dropped on a tile.
  const clientToTile = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const { sx, sy, rect } = backingScale(canvas);
    const w = screenToWorld(cameraCtl.camera(), (clientX - rect.left) * sx, (clientY - rect.top) * sy);
    const t = clampTile(worldToTile(w.x, w.y), scene.terrain.width, scene.terrain.height);
    return { col: t.col, row: t.row };
  };
  const toolPanel =
    scene.toolPanel === true
      ? await mountToolPanel({
          app,
          canvas,
          uiscale,
          buildings: menuEntriesFromContent(scene.content),
          lang: 'pol',
          tribe: HUD_TRIBE,
          owner: HUMAN_PLAYER,
          enqueue: (command) => sim.enqueue(command),
          screenToTile: clientToTile,
          onSpeedChange: (spec) => {
            control.paused = spec.state === 'paused';
            if (spec.state !== 'paused') control.speed = spec.tickMultiplier;
          },
          backingScale,
        })
      : null;

  // RTS unit control over the scene: left-click / drag-box to select the human's units, right-click to
  // send them, Space for the unit panel. Harmless on scenes with no owned units (nothing is pickable);
  // the unit-orders scene populates the human's vikings. `snapshot`/`enqueue` read the CURRENT `sim`
  // through the closure, so they follow an overlay restart (which also clears the selection above).
  const controls = createUnitControls({
    canvas,
    camera: () => cameraCtl.camera(),
    snapshot: () => sim.snapshot(),
    mapSize: { width: scene.terrain.width, height: scene.terrain.height },
    humanPlayer: HUMAN_PLAYER,
    professions: professionsFromContent(scene.content),
    enqueue: (command) => sim.enqueue(command),
    boundsOf: (ref) => renderer.entityBounds(ref), // pixel-accurate picking against the real sprite
    ...(toolPanel !== null ? { claimPointer: (x: number, y: number) => toolPanel.claimsPointer(x, y) } : {}),
  });

  let timestep = new FixedTimestep();
  let lastMs = performance.now();

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Time the CPU work (sim + snapshot + render-build/submit + audio) so the overlay can split the
    // frame into CPU vs GPU/compositor — the split that tells whether a slow frame is our code or the GPU.
    const cpu0 = performance.now();
    // Accumulate events from every step this frame (each step clears the buffer) for the audio layer.
    const frameEvents: SimEvent[] = [];
    const collect = (): void => {
      sim.step();
      frameEvents.push(...sim.events.current());
    };
    if (control.stepOnce) {
      collect(); // manual single-step (paused): advance one tick irrespective of the accumulator
      control.stepOnce = false;
    } else if (!control.paused) {
      timestep.advance(elapsed * control.speed, collect);
    }
    cameraCtl.update(elapsed);
    const snap = sim.snapshot();
    // Re-place the tool panel's screen-space sprites BEFORE the renderer's `app.render()` (they carry the
    // canvas resolution in their shader), and refresh an open statistics window from this frame's snapshot.
    toolPanel?.update(snap);
    // `app.screen` is the LIVE renderer size (it tracks window resizes), so the HUD stays pinned. When the
    // tool panel is mounted the always-on stocks HUD is shifted right to clear the left strip.
    renderer.update(
      snap,
      cameraCtl.camera(),
      snap.tick,
      {
        placement: shiftHud(placeHud(layoutHud(buildHud(snap, HUD_TRIBE)), 'top-left', app.screen), hudShift),
      },
      controls.selectedIds(),
    );
    controls.tick(snap); // reuse the frame's snapshot — don't rebuild a second one
    overlay.update(snap.tick);
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
    const cpuMs = performance.now() - cpu0;
    perf.update(elapsed, { entities: snap.entities.length, cpuMs, ...renderer.stats() });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log(`Vinland scene "${scene.id}" up. Watch the overlay checklist, then say if it looks OK.`);
}
