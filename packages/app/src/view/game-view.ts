import { indexById } from '@vinland/data';
import {
  type Camera,
  type ElevationField,
  type PlacementOverlayFrame,
  SPRITE_CULL_MARGIN,
  type SceneTerrain,
  type SpriteSheet,
  type WorldRenderer,
  buildHud,
  buildSpriteScene,
  cameraViewport,
  layoutHud,
  visibleTileRange,
} from '@vinland/render';
import { FixedTimestep, type SimEvent, type Simulation, type WorldSnapshot } from '@vinland/sim';
import type { Application } from 'pixi.js';
import { HARVEST_ATOMIC } from '../catalog/atomics.js';
import { pickerEntries } from '../catalog/professions.js';
import { createSoundDriver } from '../content/audio.js';
import { DEFAULT_UI_LANG } from '../content/gui-gfx.js';
import { loadIr } from '../content/ir.js';
import { HUD_TRIBE, HUMAN_PLAYER } from '../game/rules.js';
import { workerRoleOf } from '../game/sandbox/index.js';
import { DEFAULT_UI_SCALE, buildToolPanelLayout } from '../hud/tool-panel/layout.js';
import { mountAdminDebug } from './admin-debug/index.js';
import type { CameraController } from './camera.js';
import { screenScale } from './camera.js';
import { computeDoorBadges } from './door-badges.js';
import {
  applyGameSpeed,
  menuEntriesFromContent,
  menuGoodsFromContent,
  mountGameToolPanel,
} from './game-tool-panel.js';
import { mountSoundToggle } from './overlay.js';
import { floatParam } from './params.js';
import { mountPerfOverlay } from './perf-overlay.js';
import { type Pickable, nodeBandOfCells, pickTopAt, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';
import { createUnitControls } from './unit-controls.js';

/**
 * The SHARED in-game runtime both playable entries (`?map=` and `?scene=`) run on top of: the standard
 * HUD mounts (LEFT tool panel, RTS unit controls, perf overlay, positional sound) and the ONE
 * fixed-timestep RAF loop. The entries only assemble their world (terrain, sim, renderer, starting
 * camera) and hand it here — so the loop, the input wiring and the flag semantics (`?speed`, `?sound`,
 * `?uiscale`) cannot drift between the map view and the acceptance scenes (they did: only the scene
 * loop measured `cpuMs`, and the placement-banner inset differed per copy).
 *
 * Per-frame order matters and is pinned here: sim steps (collecting EVERY step's events for audio) →
 * camera glide → ONE snapshot + ONE `buildHud` scan feeding the tool panel's stats window →
 * tool-panel re-place BEFORE the renderer's render (screen-space meshes carry the canvas resolution) →
 * the retained `renderer.update` → unit-controls tick reusing the same snapshot → sound → perf readout.
 */
export interface GameViewDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  /** The retained world renderer, terrain already set. */
  readonly renderer: WorldRenderer;
  /** The loaded sprite sheet (the renderer's own), forwarded to the details panel's animated workers
   *  field. Optional: a bare checkout has none and the field stays empty. */
  readonly sheet?: SpriteSheet;
  /** The live sim this view steps and draws. */
  readonly sim: Simulation;
  /** The interactive camera (the entry picks the starting frame). */
  readonly cameraCtl: CameraController;
  /** The terrain grid the sound driver's ambient beds sample. */
  readonly terrainGrid: SceneTerrain;
  /** Map bounds in CELLS for placement/order clicks (a click outside is rejected, never clamped);
   *  grid-logic consumers derive the 2× node bounds from it. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** The map's terrain-height field so clicks on lifted hills resolve to the tile drawn there. */
  readonly elevation?: ElevationField;
  /** Extra per-frame hook after the standard updates (e.g. the scene checklist overlay's tick). */
  readonly onFrame?: (snapshot: WorldSnapshot) => void;
}

/** Tiles beyond the visible band the overlay also probes, so its edge never shows during a pan. */
const OVERLAY_BAND_MARGIN = 2;

/** px gap between the tool-panel strip's right edge and the debug overlay's left edge. */
const PERF_STRIP_GAP = 8;

/**
 * The build-mode overlay-frame builder: the visible band plus which of its HALF-CELL NODES reject
 * the held building's anchor — the SAME rule `placeBuilding` gates on (`Simulation.placementProbe`),
 * so the dimmed area is exactly where a click would be refused (blocked by terrain — trees/stones/
 * ore/water — or by another building's margin). The camera cull yields a CELL band
 * (`visibleTileRange`); the probe walks its 2× node band, since anchors live on the half-cell
 * lattice. Screen-bounded per golden rule 6 (per-frame cost scales with the screen): only the
 * visible band is probed, and only while placing — and the band probe is MEMOIZED on (type,
 * placement-blocker version, band). The version (`Simulation.placementBlockerVersion`) moves only
 * when a building/resource is added or removed, NOT every tick — so a still camera over a RUNNING sim
 * reuses last frame's blocked set instead of re-probing the whole node band per RAF (keying on the
 * tick instead makes the O(4×visible×footprint) loop re-run 20×/s while the game plays). Returns null
 * for a mapless sim (no placement rule → no wash).
 */
function makeOverlayFrameSource(
  sim: Simulation,
  mapSize: { readonly width: number; readonly height: number },
): (buildingType: number, camera: Camera, screenW: number, screenH: number) => PlacementOverlayFrame | null {
  let key = '';
  let frame: PlacementOverlayFrame | null = null;
  return (buildingType, camera, screenW, screenH) => {
    const cells = visibleTileRange(
      cameraViewport(camera, screenW, screenH),
      mapSize.width,
      mapSize.height,
      OVERLAY_BAND_MARGIN,
    );
    // The node band covering the visible cells.
    const range = nodeBandOfCells(cells);
    const nextKey = `${buildingType}:${sim.placementBlockerVersion()}:${range.minCol},${range.maxCol},${range.minRow},${range.maxRow}`;
    // Nothing that moves the blocked set changed (same type, same blockers, same camera band): reuse
    // last frame's result and skip both the probe build and the whole-band re-probe.
    if (nextKey === key && frame !== null) return frame;
    const probe = sim.placementProbe(buildingType);
    if (probe === null) return null;
    const blocked: { col: number; row: number }[] = [];
    for (let row = range.minRow; row <= range.maxRow; row++) {
      for (let col = range.minCol; col <= range.maxCol; col++) {
        if (!probe.canPlace(col, row)) blocked.push({ col, row });
      }
    }
    key = nextKey;
    frame = { ...range, blocked };
    return frame;
  };
}

/**
 * Mount the standard in-game HUD over the assembled world and start the fixed-timestep loop.
 * Resolves once the loop is running (the RAF chain keeps itself alive from there).
 */
export async function startGameView(deps: GameViewDeps): Promise<void> {
  const { app, canvas, params, renderer, sim, cameraCtl } = deps;

  // `?uiscale=` — parsed ONCE, shared by the tool panel and the action ring. Fractional allowed (the
  // default is 1.4×); the consumers clamp it to ≥1.
  const uiscale = floatParam(params, 'uiscale', DEFAULT_UI_SCALE);

  // `?lang=` — the UI-string + building-name language (defaults to Polish). Shared by the building menu's
  // localized names and the tool panel's decoded UI strings so the two can't drift.
  const lang = params.get('lang') ?? DEFAULT_UI_LANG;
  // Playback control. `?speed=` seeds the initial wall-clock multiplier (default ×1; e.g. `&speed=0.5`
  // for a calm, sub-1× pace the panel's discrete speed button can't reach). The tool panel's game-speed
  // button then drives it live (×1 → ×2 → ×3 → ×1; `P` toggles pause) without clobbering this seed at mount.
  const control = { paused: false, speed: floatParam(params, 'speed', 1) };

  // Original decoded sounds, played positionally: action SFX + terrain ambient (viewport-culled,
  // attenuated, panned) + non-spatial life-event jingles + settler voice chatter — a pure consumer of
  // the same snapshot + events render reads. Default-MUTED: the driver is built (unless `?sound=off`
  // skips it entirely) but starts disabled, so the game is silent until the user clicks the bottom
  // sound toggle — that click both unmutes and satisfies the browser autoplay gesture. A checkout
  // without `content/` (no sound bank) degrades to silence (no driver, no button).
  const wantSound = params.get('sound') !== 'off';
  const soundDriver = wantSound ? createSoundDriver(await loadIr(), { chopAtomicId: HARVEST_ATOMIC }) : null;
  if (soundDriver !== null) {
    soundDriver.setEnabled(false);
    mountSoundToggle(soundDriver);
  }

  // On-canvas debug readout (top-left, just clear of the tool-panel strip): tick / speed / steps /
  // entity counts + the FPS and the sim/snap/draw CPU split, so a human can judge whether the view holds
  // a frame rate, whether culling is biting, and whether a slow frame is the sim or the draw. Real-GPU
  // only: headless Chromium is software-GL. The left inset is the strip's right edge + a small gap; the
  // build menu drops BELOW it (from the buildings button), so the two never overlap.
  const perf = mountPerfOverlay(buildToolPanelLayout(uiscale).width + PERF_STRIP_GAP);

  // The original LEFT tool panel — the standard game HUD. Its game-speed button drives `control`, the
  // building menu enqueues `placeBuilding` on a map click, and it claims its own clicks so the HUD
  // never falls through to world picking.
  // The ONE live placement rule the click gate and the cursor ghost share (they must never drift —
  // the ghost previews exactly what a click will do); a mapless sim (no probe) places freely,
  // matching the command gate's stance.
  const canPlaceAt = (typeId: number, col: number, row: number): boolean =>
    sim.placementProbe(typeId)?.canPlace(col, row) ?? true;

  const toolPanel = await mountGameToolPanel({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    enqueue: (command) => sim.enqueue(command),
    canPlaceAt,
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    buildings: menuEntriesFromContent(sim.content, lang),
    goods: menuGoodsFromContent(sim.content),
    lang,
    tribe: HUD_TRIBE,
    owner: HUMAN_PLAYER,
    onSpeed: (spec, cause) => applyGameSpeed(control, spec, cause),
  });

  // Scrolling an open HUD window (the build menu / stats list) must NOT also zoom the world behind it —
  // the camera skips the wheel while the pointer is over such a window.
  cameraCtl.setPointerGuard((clientX, clientY) => toolPanel.claimsWheel(clientX, clientY));

  // The cursor position for the build-mode ghost (client coords; null when the pointer left the
  // canvas). Tracked persistently — the ghost must follow the mouse between clicks, and reading it in
  // the frame loop keeps ALL per-frame work in the one RAF (no per-mousemove sim probing).
  let pointer: { clientX: number; clientY: number } | null = null;
  const onPointerMove = (e: MouseEvent): void => {
    pointer = { clientX: e.clientX, clientY: e.clientY };
  };
  const onPointerLeave = (): void => {
    pointer = null;
  };
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mouseleave', onPointerLeave);

  // RTS unit control: left-click / drag-box to select the human's units, right-click to send them,
  // Space for the action menu. Reads the camera + snapshot through closures, issues commands into the
  // sim. Harmless on scenes with no owned units (nothing is pickable).
  const controls = await createUnitControls({
    app,
    canvas,
    uiscale,
    camera: () => cameraCtl.camera(),
    snapshot: () => sim.snapshot(),
    mapSize: deps.mapSize,
    ...(deps.elevation !== undefined ? { elevation: deps.elevation } : {}),
    humanPlayer: HUMAN_PLAYER,
    professions: pickerEntries(),
    content: sim.content,
    ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
    enqueue: (command) => sim.enqueue(command),
    boundsOf: (ref) => renderer.entityBounds(ref), // pixel-accurate picking against the real sprite
    claimPointer: (x: number, y: number) => toolPanel.claimPointer(x, y),
    // The Magazyn stock-row name tooltip. Its OWN instance (not the ground one below): the two hover
    // surfaces are mutually exclusive by cursor, and a shared element would fight — the frame loop hides the
    // ground tooltip whenever the pointer is over the HUD, which is exactly when this one must stay shown.
    tooltip: createTooltip(),
  });

  // The good display label by sim goodType — the ONE localized name source (the scene entry seeded
  // `sim.content.goods` names from the `?locale` language). Shared by the ground-pile tooltip below and the
  // admin spawn palette, so both read in the player's language; falls back to the good's id.
  const goodLabelByType = new Map<number, string>(sim.content.goods.map((g) => [g.typeId, g.name ?? g.id]));

  // The admin/debug spawn palette (a hidden panel behind a top toggle button): click-to-spawn any unit
  // or resource for any player through the sim command seam, for hands-on combat/economy testing. Its
  // spawn clicks resolve tiles + defer to the SAME composed HUD claim the unit controls use (tool-panel
  // strip/windows PLUS the settler action ring), and it runs BEFORE the RTS controls (a window-capture
  // press) so arming never also selects a unit.
  mountAdminDebug({
    canvas,
    enqueue: (command) => sim.enqueue(command),
    clientToTile: (x, y) => toolPanel.clientToTile(x, y),
    claimPointer: (x, y) => controls.claimsPointer(x, y),
    goodLabel: (typeId) => goodLabelByType.get(typeId),
  });

  // Name-on-hover: a cursor tooltip naming the loose good pile (with its count) under the pointer, so a
  // dropped heap the eye can't always tell apart — one bottle from another, one ring from another — reads its
  // good + how many units. Keyed by the sim goodType the pile's DrawItem carries.
  const tooltip = createTooltip();
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = screenScale(canvas, app.renderer.resolution);
    return screenToWorld(cameraCtl.camera(), (clientX - rect.left) * sx, (clientY - rect.top) * sy);
  };
  // Pile hit-targets, rebuilt only when the sim tick OR the camera moves. buildSpriteScene is culled to the
  // camera viewport (same margin the renderer draws with), so this is a SCREEN-bounded pass, not a whole-map
  // one — the tooltip only names piles under the cursor, which are on-screen (golden rule 6). The set is
  // camera-dependent now (culled), so the cache keys on the camera too; a still cursor over a still frame
  // re-picks the cached set. Empty flags (no dominant good) carry nothing to name and are skipped.
  let hoverKey = '';
  let hoverTargets: Pickable[] = [];
  const hoverInfo = new Map<number, { goodType: number; amount: number }>();
  const pileTargets = (snap: WorldSnapshot): Pickable[] => {
    const cam = cameraCtl.camera();
    const key = `${snap.tick}:${cam.offsetX}:${cam.offsetY}:${cam.scale ?? 1}`;
    if (key === hoverKey) return hoverTargets;
    hoverKey = key;
    hoverTargets = [];
    hoverInfo.clear();
    const vp = cameraViewport(
      cam,
      app.screen.width,
      app.screen.height,
      SPRITE_CULL_MARGIN + (deps.elevation?.maxLift ?? 0),
    );
    for (const it of buildSpriteScene(snap, vp, deps.elevation)) {
      if (it.kind !== 'stockpile' && it.kind !== 'grounddrop') continue;
      if (it.goodType === undefined) continue; // an empty delivery flag — nothing to name
      hoverTargets.push({ ref: it.ref, x: it.x, y: it.y, box: renderer.entityBounds(it.ref) });
      hoverInfo.set(it.ref, { goodType: it.goodType, amount: it.fill ?? 0 });
    }
    return hoverTargets;
  };
  const updateHoverTooltip = (snap: WorldSnapshot): void => {
    // Suppress while placing a building and whenever the HUD owns the pointer (a tool-panel window, the
    // details panel) — the tooltip names WORLD piles, not HUD chrome.
    if (
      pointer === null ||
      toolPanel.controller.placementType() !== null ||
      toolPanel.claimPointer(pointer.clientX, pointer.clientY) ||
      controls.claimsPointer(pointer.clientX, pointer.clientY)
    ) {
      tooltip.hide();
      return;
    }
    const w = toWorld(pointer.clientX, pointer.clientY);
    const ref = pickTopAt(pileTargets(snap), w.x, w.y);
    const info = ref === null ? undefined : hoverInfo.get(ref);
    if (info === undefined) {
      tooltip.hide();
      return;
    }
    const label = goodLabelByType.get(info.goodType) ?? `#${info.goodType}`;
    tooltip.show(pointer.clientX, pointer.clientY, info.amount > 1 ? `${label} ×${info.amount}` : label);
  };

  // The memoized build-mode band probe (see makeOverlayFrameSource) — one instance per view.
  const overlayFrame = makeOverlayFrameSource(sim, deps.mapSize);
  // Building types keyed by typeId, for the per-frame door-badge projection (its door offset). Built
  // once — the content is fixed for a view's lifetime.
  const buildingDoors = indexById(sim.content.buildings);

  const timestep = new FixedTimestep();
  let lastMs = performance.now();
  // The fixed-timestep interpolation fraction the renderer lerps entity anchors by — refreshed each
  // un-paused frame from `advance` (a pause freezes it, so units hold their drawn spot mid-leg).
  let renderAlpha = 1;
  // Events from EVERY sim step this frame (not just the last tick): the fixed-timestep loop may advance
  // several ticks between rendered frames, and each step clears the buffer — so an audio trigger on an
  // intermediate tick would otherwise be lost. One persistent scratch array, cleared per frame.
  const frameEvents: SimEvent[] = [];
  const collect = (): void => {
    sim.step();
    for (const ev of sim.events.current()) frameEvents.push(ev);
  };

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    // Time the CPU work (sim + snapshot + render-build/submit + audio) so the overlay can split the
    // frame into CPU vs GPU/compositor — the split that tells whether a slow frame is our code or the GPU.
    const cpu0 = performance.now();
    frameEvents.length = 0;
    // Count the sim steps this frame — the fixed-timestep loop may run several to catch wall-clock up
    // (or zero when paused/idle); a persistently high count is the sim falling behind, the overlay shows it.
    let steps = 0;
    if (!control.paused) {
      renderAlpha = timestep.advance(elapsed * control.speed, () => {
        collect();
        steps++;
      });
    }
    // CPU split #1: the sim step(s). The overlay breaks the frame's CPU into sim/snap/draw so a slow
    // scene can be blamed on the right layer (render/AGENTS.md: measure before blaming the GPU).
    const simMs = performance.now() - cpu0;
    cameraCtl.update(elapsed);
    // The sepia pause wash mirrors the loop's pause flag EVERY frame (an idempotent visibility set), so
    // any future pauser — auto-pause on blur, a modal — browns the map without knowing about the renderer.
    renderer.setPaused(control.paused);
    const snap0 = performance.now();
    const snap = sim.snapshot();
    // CPU split #2: the snapshot clone (the plain-cloned world the renderer + HUD read).
    const snapMs = performance.now() - snap0;
    // Build the tribe HUD read-view once per frame (an O(entities) scan) for the tool panel's statistics
    // window (the on-demand population/jobs/stocks panel). The old ALWAYS-ON stocks panel that also read
    // this was removed — that data now shows only when the player opens the stats window.
    const hud = layoutHud(buildHud(snap, HUD_TRIBE));
    // Re-place the tool panel's screen-space sprites BEFORE the renderer's render (they carry the
    // canvas resolution in their shader), and refresh an open stats window from this frame's HUD.
    toolPanel.controller.update(hud);
    // Build mode: dim the ground the held building can't anchor on and float its translucent ghost at
    // the hovered tile (hidden over rejecting ground — the original's vanishing house cursor). Both
    // are computed here, in the app, from the sim's placement probe and handed to the renderer as
    // plain data — the renderer stays a pure projection and never calls back into the sim.
    const placeType = toolPanel.controller.placementType();
    renderer.updatePlacementOverlay(
      placeType === null
        ? null
        : overlayFrame(placeType, cameraCtl.camera(), app.screen.width, app.screen.height),
    );
    // (No HUD-claim check: the HUD draws over the world layer, so the ghost can't cover it.)
    const hovered =
      placeType !== null && pointer !== null
        ? toolPanel.clientToTile(pointer.clientX, pointer.clientY)
        : null;
    renderer.updatePlacementGhost(
      placeType !== null && hovered !== null && canPlaceAt(placeType, hovered.col, hovered.row)
        ? { col: hovered.col, row: hovered.row, buildingType: placeType }
        : null,
    );
    // Feed the details panel's live "observation window" — a world cutout centred on the selected entity,
    // rendered into the portrait box INSIDE renderer.update (a second world render, before the main stage
    // render). Null when the selection has no portrait; the inset fits the entity's bounds to the box.
    renderer.setPortraitInset(controls.portrait());
    // One retained update: reconcile the pooled sprites, draw the selection rings + door badges + the
    // selected gatherers' work-flag highlight, render once. `app.screen` tracks window resizes. No HUD frame
    // is passed — the always-on stocks panel is gone; the debug tick lives in the top overlay and the
    // population/jobs/stocks in the stats window.
    const doorBadges = computeDoorBadges(snap, buildingDoors, workerRoleOf);
    renderer.update(
      snap,
      cameraCtl.camera(),
      snap.tick,
      undefined,
      controls.selectedIds(),
      renderAlpha,
      doorBadges,
      controls.flaggedFlagIds(),
    );
    controls.tick(snap); // reuse the frame's snapshot — don't rebuild a second one
    updateHoverTooltip(snap); // name-on-hover for the good pile under the cursor (after controls: claim state is current)
    deps.onFrame?.(snap);
    if (soundDriver !== null) {
      soundDriver.update({
        events: frameEvents,
        snapshot: snap,
        camera: cameraCtl.camera(),
        canvasW: app.screen.width,
        canvasH: app.screen.height,
        terrain: deps.terrainGrid,
        dtMs: elapsed,
      });
    }
    const cpuMs = performance.now() - cpu0;
    // CPU split #3: the render build + submit and the rest of the frame's app work (camera, controls,
    // sound) — the remainder after sim + snapshot, so the three sum to cpuMs.
    const drawMs = cpuMs - simMs - snapMs;
    perf.update(elapsed, {
      tick: snap.tick,
      steps,
      speed: control.speed,
      paused: control.paused,
      entities: snap.entities.length,
      cpuMs,
      simMs,
      snapMs,
      drawMs,
      ...renderer.stats(),
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
