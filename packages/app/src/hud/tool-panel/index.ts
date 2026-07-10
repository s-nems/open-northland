import type { HudLayout, PalettedSprite } from '@vinland/render';
import type { Command } from '@vinland/sim';
import { type Application, Container, Graphics, Texture } from 'pixi.js';
import { loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { type GuiBitmapName, loadGuiBitmap, loadGuiStrings, uiStringLookup } from '../../content/gui-gfx.js';
import { loadUiFont } from '../../content/ui-font.js';
import type { TextRun } from '../bitmap-text.js';
import { HOVER_ALPHA, HOVER_TINT } from '../chrome.js';
import { makeUiTextRun } from '../ui-text.js';
import type { MenuBuildingEntry } from './building-menu.js';
import type { PanelBitmaps, PanelContext } from './context.js';
import {
  DEFAULT_GAME_SPEED_CONTROL,
  type GameSpeedChangeCause,
  type GameSpeedControl,
  type GameSpeedStateSpec,
  cycleGameSpeed,
  effectiveGameSpeedSpec,
  gameSpeedClickCause,
  toggleGameSpeedPause,
} from './game-speed.js';
import {
  TOOL_PANEL_STRIP,
  type ToolButtonId,
  buildToolPanelLayout,
  hitTestToolPanel,
  pointOverToolPanel,
} from './layout.js';
import { createMenuWindow } from './menu-window.js';
import { createPlacementController } from './placement.js';
import { createStatsWindow } from './stats-window.js';
import { buildOutlinedButtonSpecs } from './strip-outline.js';
import { type StripSpriteSpec, type SupersampledStrip, createSupersampledStrip } from './strip-texture.js';

/**
 * The LEFT in-game tool panel — the retained screen-space HUD that draws the original toolbar strip, the
 * tool buttons, the working game-speed button, and the pop-up building / statistics windows, and claims the
 * clicks that land on it (so they never fall through to world picking).
 *
 * Rendering: strip/buttons/speed draw as `PalettedSprite`s over the indexed `ls_gui_window` atlas,
 * coloured through the GUI palette LUT (the same mechanism as player colours) — bitmap-native, no DOM. When
 * the decoded GUI art is absent (a checkout that hasn't run the GUI pipeline stage) the panel DEGRADES to
 * flat `Graphics` blocks at the exact same pinned geometry, staying visible and fully interactive; the
 * pop-up windows tile the original wood/rust bitmap fills over a `Graphics` frame (degrading to flat
 * parchment when `content/` is absent). Text is the bundled vector serif (`hud/ui-text.ts`) — the crisp
 * shared HUD default, not the decoded `.fnt` bitmap face.
 *
 * The package splits by concern: the pure geometry / speed-state / menu models (`layout.ts`,
 * `game-speed.ts`, `building-menu.ts` — headlessly unit-tested) from the window controllers
 * (`menu-window.ts`, `stats-window.ts`, `placement.ts` — each owning its own graphics + state over the
 * shared {@link PanelContext}); this module mounts the strip, owns the speed button, and routes input.
 */

export interface ToolPanelOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale (from `?uiscale=`); the pinned internal geometry is multiplied by this. May be fractional. */
  readonly uiscale: number;
  /** The buildings the menu lists (typeId + label + kind) — e.g. derived from the viking catalog. */
  readonly buildings: readonly MenuBuildingEntry[];
  /** Language for the decoded UI strings (`pol`/`eng`); falls back to the pinned Polish labels when absent. */
  readonly lang: string;
  /** The tribe whose read-view stats the statistics window shows. */
  readonly tribe: number;
  /** The player slot a placed building is owned by. */
  readonly owner: number;
  /** Submit a command into the sim (the one-way seam) — the building menu's `placeBuilding`. */
  readonly enqueue: (command: Command) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map — the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule (`Simulation.placementProbe`) — gates the placement click, so a
   *  click on rejecting ground is inert instead of enqueueing a command the sim would drop. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  /** Apply a game-speed change to the app loop; `cause` says whether it was a speed pick or a pause
   *  toggle (a pause toggle must not overwrite the loop's wall-clock multiplier — see the type). */
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Client (CSS px) → Pixi screen px mapper — shared with the unit controls. */
  readonly screenScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
}

export interface ToolPanelController {
  /** True when a client point should be CLAIMED by the HUD (over the strip, an open window, or in placement). */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** True when a client point is over an OPEN pop-up window (menu / stats) — the surface that owns the
   *  wheel, so the camera must not also zoom there. Narrower than {@link claimsPointer}: it excludes the
   *  strip and active placement, so the wheel still zooms the world in those. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** The building typeId currently being placed, or null when not in build mode — the frame loop reads it
   *  to drive the map's buildable/blocked overlay. */
  placementType(): number | null;
  /**
   * Per-frame hook: re-place the screen-space sprites and refresh the open statistics window. Takes the
   * frame's ALREADY-BUILT HUD layout (the caller builds it once for the always-on HUD) so the panel does
   * not run a second O(entities) `buildHud` scan.
   */
  update(hud: HudLayout): void;
  dispose(): void;
}

/** Fallback strip / button block colours (only used when the decoded GUI art is absent). */
const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;
/** Fallback speed-glyph nudges inside the button rect (design px). */
const SPEED_LABEL_INSET_X = 4;
const SPEED_LABEL_RAISE_Y = 3;

/** True when a keydown originated in a text-entry element — a game hotkey must not fire while typing.
 *  (No text field exists in the app today; this guards the first one that appears.) */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/**
 * Mount the tool panel onto the app stage. Async because it loads the (optional) decoded GUI art + font;
 * everything degrades gracefully so a checkout without `content/` still boots and the panel stays usable.
 */
export async function mountToolPanel(opts: ToolPanelOptions): Promise<ToolPanelController> {
  const { app, canvas, enqueue } = opts;
  const layout = buildToolPanelLayout(opts.uiscale);
  const scale = layout.scale;

  const loadBitmap = async (name: GuiBitmapName): Promise<Texture | undefined> => {
    const source = await loadGuiBitmap(name);
    return source === undefined ? undefined : new Texture({ source });
  };
  const [art, strings, uiFont, bg, button, buttonHilite, headline] = await Promise.all([
    loadGuiArt(),
    loadGuiStrings(opts.lang),
    loadUiFont(),
    loadBitmap('bg'),
    loadBitmap('bg_button'),
    loadBitmap('bg_button_hilite'),
    loadBitmap('bg_headline'),
  ]);
  const bitmaps: PanelBitmaps = { bg, button, buttonHilite, headline };

  const labelByType = new Map(opts.buildings.map((b) => [b.typeId, b.label]));

  // --- Pixi containers (screen-space children of the stage; drawn over the world) --------------------
  const root = new Container();
  root.zIndex = 1000;
  app.stage.addChild(root);
  const stripContainer = new Container();
  const hoverContainer = new Container();
  const windowContainer = new Container(); // menu + stats windows
  const bannerContainer = new Container(); // placement banner
  root.addChild(stripContainer, windowContainer, hoverContainer, bannerContainer);

  const hoverG = new Graphics();
  hoverContainer.addChild(hoverG);

  // --- The strip + buttons (real sprites, or a flat-Graphics fallback) ------------------------------
  // The real art path rasterizes the strip+buttons into an off-screen texture at an integer oversample and
  // draws it linear-downscaled to the fractional `uiscale` (crisp — no pixeloza; see `strip-texture.ts`).
  let supersampled: SupersampledStrip | null = null;
  /** The speed button's outline stamps + real glyph — a speed change re-frames ALL of them (one shape). */
  const speedSprites: PalettedSprite[] = [];

  if (art !== null) {
    // The strip keys its near-black backdrop away (the world shows past the carved silhouette — our
    // floating-HUD deviation); the buttons draw keyed too but get a contrast outline instead of the
    // original's opaque dark sockets — the policy + the why live in `strip-outline.ts`.
    const specs: StripSpriteSpec[] = [];
    const strip = makeGuiSprite(art, layout.stripGfx, { defaultPalette: 'iconsleft', colorKey: 'full' });
    if (strip !== null) specs.push({ spr: strip.sprite, design: TOOL_PANEL_STRIP });
    const outlined = buildOutlinedButtonSpecs(art, layout.buttons);
    specs.push(...outlined.specs);
    speedSprites.push(...outlined.speedSprites);
    supersampled = createSupersampledStrip({ app, bounds: layout.designBounds, scale, sprites: specs });
    stripContainer.addChild(supersampled.display);
  } else {
    const g = new Graphics();
    g.rect(layout.strip.x, layout.strip.y, layout.strip.w, layout.strip.h).fill(FALLBACK_STRIP);
    for (const b of layout.buttons) {
      g.rect(b.placed.x + 2, b.placed.y + 2, b.placed.w - 4, b.placed.h - 4)
        .fill(FALLBACK_BUTTON)
        .stroke({ color: FALLBACK_BUTTON_BORDER, width: 1 });
    }
    stripContainer.addChild(g);
  }

  // --- The shared controller context ------------------------------------------------------------------
  const ctx: PanelContext = {
    layout,
    scale,
    makeText: (text, color, px) => makeUiTextRun(uiFont.family, text, color, scale, px),
    bitmaps,
    uiString: uiStringLookup(strings),
    screen: () => app.screen,
  };

  const placement = createPlacementController({
    ctx,
    container: bannerContainer,
    labelByType,
    enqueue,
    screenToTile: opts.screenToTile,
    canPlaceAt: opts.canPlaceAt,
    tribe: opts.tribe,
    owner: opts.owner,
  });
  const menu = createMenuWindow({
    ctx,
    buildings: opts.buildings,
    container: windowContainer,
    onPick: (typeId) => placement.enter(typeId),
  });
  const stats = createStatsWindow({ ctx, container: windowContainer });

  // --- The game-speed button ---------------------------------------------------------------------------
  let speedControl: GameSpeedControl = DEFAULT_GAME_SPEED_CONTROL;
  let speedRun: TextRun | null = null; // fallback glyph (the flat mode has no distinct per-state sprite)
  const speedBtnRect = layout.buttons.find((b) => b.id === 'speed')?.placed;

  // `cause` null = mount-time init (refresh the glyph only, never push to the loop — see the call below).
  const applySpeed = (cause: GameSpeedChangeCause | null): void => {
    const spec = effectiveGameSpeedSpec(speedControl);
    if (speedSprites.length > 0 && art !== null) {
      const frame = art.layer.atlas.frames.get(spec.gfx);
      if (frame !== undefined) {
        // Outline stamps + real glyph share the frame (the rim must follow the new glyph's shape).
        for (const s of speedSprites) {
          s.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
        }
        // The strip is baked into a texture, so re-rasterize it with the new speed glyph (rare — a click).
        supersampled?.redraw();
      }
    }
    if (art === null && speedBtnRect !== undefined) {
      speedRun?.destroy();
      speedRun = ctx.makeText(spec.state === 'paused' ? '||' : `x${spec.factor}`, 'white');
      stripContainer.addChild(speedRun.container);
      speedRun.place(
        speedBtnRect.x + SPEED_LABEL_INSET_X * scale,
        speedBtnRect.y + speedBtnRect.h / 2 - SPEED_LABEL_RAISE_Y * scale,
        scale,
        app.screen.width,
        app.screen.height,
      );
    }
    // Push to the loop only on an actual change (a click / the P key), NOT at mount — the entry seeds its
    // own initial loop speed (default / `?speed=`), and the panel must not clobber it with ×1 before frame 0.
    if (cause !== null) opts.onSpeedChange(spec, cause);
  };

  // --- Button actions -------------------------------------------------------------------------------
  const activateButton = (id: ToolButtonId): void => {
    switch (id) {
      case 'speed': {
        // Cause from the PRE-click state: a click while paused is an un-pause, not a speed pick (a
        // 'cycle' cause there would clobber a fractional `?speed=` seed — see gameSpeedClickCause).
        const cause = gameSpeedClickCause(speedControl);
        speedControl = cycleGameSpeed(speedControl);
        applySpeed(cause);
        break;
      }
      case 'buildings':
        placement.cancel();
        menu.toggle();
        break;
      case 'statistics':
      case 'help': // PLACEHOLDER alias: Help has no window yet, so it toggles Statistics for now.
        stats.toggle();
        break;
      default:
        // extras / mission / diplomacy / population / tech_tree / options — not wired in v1 (see plan).
        break;
    }
  };

  // --- Input --------------------------------------------------------------------------------------
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = opts.screenScale(canvas);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    const { x, y } = toCanvas(clientX, clientY);
    if (pointOverToolPanel(layout, x, y)) return true;
    if (menu.claims(x, y)) return true;
    if (stats.claims(x, y)) return true;
    if (placement.isActive()) return true; // placement claims the whole canvas until placed/cancelled
    return false;
  };

  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);

    // Right button cancels an active placement; otherwise it's a world order (left to the unit controls).
    if (e.button === 2) {
      if (placement.isActive()) {
        e.preventDefault();
        // Stop the SAME event reaching unit-controls' mousedown (it re-checks claimPointer AFTER this
        // handler runs — cancel clears the claim, so without this the right-click would ALSO issue a
        // world move order). We register first (mounted before unit-controls), so this wins.
        e.stopImmediatePropagation();
        placement.cancel();
      }
      return;
    }
    if (e.button !== 0) return;

    // Track whether the panel CONSUMES this press; if so, stop it from also reaching world picking.
    // Priority: strip button > open menu > open stats (close-on-inside) > active placement drop.
    let consumed = false;
    const btn = hitTestToolPanel(layout, x, y);
    if (btn !== null) {
      activateButton(btn);
      consumed = true;
    } else {
      consumed = menu.handleClick(x, y);
    }
    if (!consumed) consumed = stats.handleClick(x, y);
    if (!consumed) consumed = placement.handleClick(e.clientX, e.clientY);
    if (consumed) e.stopImmediatePropagation();
  };

  let hover: ToolButtonId | null = null;
  const onMouseMove = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    menu.handleHover(x, y); // the open menu tracks its own row-hover highlight
    const next = hitTestToolPanel(layout, x, y);
    if (next === hover) return;
    hover = next;
    hoverG.clear();
    if (hover !== null) {
      const rect = layout.buttons.find((b) => b.id === hover)?.placed;
      if (rect !== undefined)
        hoverG.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
  };

  // Wheel scrolls the open building menu's list. Suppress the browser's default wheel action over ANY open
  // pop-up (the menu scrolls; the stats window has no scroll yet but must not page the document behind the
  // canvas either) — the camera's pointer-guard already skips zoom over these same windows.
  const onWheel = (e: WheelEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    if (menu.handleWheel(x, y, e.deltaY) || stats.claims(x, y)) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && placement.isActive()) placement.cancel();
    // `P` toggles pause (remembering the running speed for the resume). Plain, non-repeated key only —
    // a modifier combo (Cmd/Ctrl+P print, etc.) stays the browser's, a held key must not flicker the
    // pause (each toggle re-rasterizes the strip), and typing "p" into a text field must not pause.
    if (
      e.code === 'KeyP' &&
      !e.repeat &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !isTypingTarget(e.target)
    ) {
      speedControl = toggleGameSpeedPause(speedControl);
      applySpeed('pause-toggle');
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  applySpeed(null); // initialise the speed button graphic only — the loop keeps the entry's seeded speed

  const claimsWheel = (clientX: number, clientY: number): boolean => {
    const { x, y } = toCanvas(clientX, clientY);
    return menu.claims(x, y) || stats.claims(x, y);
  };

  return {
    claimsPointer,
    claimsWheel,
    placementType: () => placement.activeType(),
    update(hud): void {
      // The strip is a static baked texture now (a scene-graph sprite that batches + follows resizes for
      // free) — no per-frame re-placement. The menu's vector runs stay put too, so refresh() only reflows
      // on a resize; the stats window + placement banner still re-place.
      menu.refresh();
      stats.refresh(hud);
      placement.placeBanner();
    },
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      root.destroy({ children: true });
      supersampled?.dispose();
    },
  };
}
