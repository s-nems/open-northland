import type { HudLayout, PalettedSprite } from '@open-northland/render';
import type { Command } from '@open-northland/sim';
import { type Application, Container, Graphics, Texture } from 'pixi.js';
import { loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { type GuiBitmapName, loadGuiBitmap, loadGuiStrings, uiStringLookup } from '../../content/gui-gfx.js';
import { loadUiFont } from '../../content/ui-font.js';
import { HOVER_ALPHA, HOVER_TINT } from '../chrome.js';
import { makeUiTextRun } from '../ui-text.js';
import type { MenuBuildingEntry } from './building-menu.js';
import type { PanelBitmaps, PanelContext } from './context.js';
import type { GameSpeedChangeCause, GameSpeedStateSpec } from './game-speed.js';
import { createGoodsDropController } from './goods-drop.js';
import type { MenuGoodEntry } from './goods-menu.js';
import { createGoodsWindow } from './goods-window.js';
import {
  buildToolPanelLayout,
  hitTestToolPanel,
  pointOverToolPanel,
  TOOL_PANEL_STRIP,
  type ToolButtonId,
} from './layout.js';
import { createMenuWindow } from './menu-window.js';
import { createPlacementController } from './placement.js';
import { createSpeedButton } from './speed-button.js';
import { createStatsWindow } from './stats-window.js';
import { buildOutlinedButtonSpecs } from './strip-outline.js';
import { createSupersampledStrip, type StripSpriteSpec, type SupersampledStrip } from './strip-texture.js';

/**
 * The left in-game tool panel — the retained screen-space HUD that draws the original toolbar strip, the
 * tool buttons, the working game-speed button, and the pop-up building / statistics windows, and claims the
 * clicks that land on it (so they never fall through to world picking).
 *
 * Rendering: strip/buttons/speed draw as `PalettedSprite`s over the indexed `ls_gui_window` atlas,
 * coloured through the GUI palette LUT (the same mechanism as player colours) — bitmap-native, no DOM. When
 * the decoded GUI art is absent (a checkout that hasn't run the GUI pipeline stage) the panel degrades to
 * flat `Graphics` blocks at the exact same pinned geometry, staying visible and fully interactive; the
 * pop-up windows tile the original wood/rust bitmap fills over a `Graphics` frame (degrading to flat
 * parchment when `content/` is absent). Text is the bundled vector serif (`hud/ui-text.ts`) — the crisp
 * shared HUD default, not the decoded `.fnt` bitmap face.
 *
 * The package splits by concern: the pure geometry / speed-state / menu models (`layout.ts`,
 * `game-speed.ts`, `building-menu.ts` — headlessly unit-tested) from the window controllers
 * (`menu-window.ts`, `goods-window.ts`, `stats-window.ts` on the shared `window-shell.ts` lifecycle, plus
 * `placement.ts` — each over the shared {@link PanelContext}); this module mounts the strip, owns the
 * speed button, and routes input.
 */

export interface ToolPanelOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale (from `?uiscale=`); the pinned internal geometry is multiplied by this. May be fractional. */
  readonly uiscale: number;
  /** The buildings the menu lists (typeId + label + kind) — e.g. derived from the viking catalog. */
  readonly buildings: readonly MenuBuildingEntry[];
  /** The goods the drop palette lists (goodType + id + label) — the whole content catalog. */
  readonly goods: readonly MenuGoodEntry[];
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
  /** True when a higher HUD overlay (the minimap's framed window) covers this client point. The panel
   *  yields the left click there so hit priority follows draw order — on a short screen the minimap
   *  draws over the strip's lower buttons and over an active placement, and a click on the visible
   *  overlay must never toggle the hidden button / drop a foundation sight-unseen. Right-click
   *  (cancel placement) is deliberately not deferred. Injected per the hud contract. */
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** Open the in-game system menu — the `options` button's action (view/system-menu.ts). Injected per
   *  the hud contract (the panel invokes a callback; it never navigates or owns the session itself). */
  readonly onSystemMenu?: () => void;
}

export interface ToolPanelController {
  /** True when a client point should be claimed by the HUD (over the strip, an open window, or in placement). */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** True when a client point is over an open pop-up window (menu / goods / stats) — the surface that
   *  owns the wheel (the camera must not also zoom there) and that edge scrolling yields to. Narrower
   *  than {@link claimsPointer}: it excludes the strip and active placement, so the wheel still zooms
   *  (and the screen edge still pans) the world in those. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** The building typeId currently being placed, or null when not in build mode — the frame loop reads it
   *  to drive the map's buildable/blocked overlay. */
  placementType(): number | null;
  /**
   * Per-frame hook: re-place the screen-space sprites and refresh the open statistics window. Takes the
   * frame's already-built HUD layout (the caller builds it once for the always-on HUD) so the panel does
   * not run a second O(entities) `buildHud` scan.
   */
  update(hud: HudLayout): void;
  dispose(): void;
}

/** Fallback strip / button block colours (only used when the decoded GUI art is absent). */
const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;

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
  /** The speed button's outline stamps + real glyph — a speed change re-frames all of them (one shape). */
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
  const goodsDrop = createGoodsDropController({
    ctx,
    container: bannerContainer,
    labelByGood: new Map(opts.goods.map((g) => [g.goodType, g.label])),
    enqueue,
    screenToTile: opts.screenToTile,
  });
  const goodsWindow = createGoodsWindow({
    ctx,
    goods: opts.goods,
    container: windowContainer,
    onPick: (goodType) => goodsDrop.enter(goodType),
  });
  const stats = createStatsWindow({ ctx, container: windowContainer });

  // --- The game-speed button (its own controller — see speed-button.ts) --------------------------------
  const speedButton = createSpeedButton({
    ctx,
    app,
    scale,
    stripContainer,
    art,
    supersampled,
    speedSprites,
    speedBtnRect: layout.buttons.find((b) => b.id === 'speed')?.placed,
    onSpeedChange: opts.onSpeedChange,
  });

  // --- Button actions -------------------------------------------------------------------------------
  const activateButton = (id: ToolButtonId): void => {
    switch (id) {
      case 'speed':
        speedButton.cycle();
        break;
      case 'buildings':
        placement.cancel();
        goodsDrop.cancel();
        goodsWindow.close();
        menu.toggle();
        break;
      case 'extras':
        // The goods drop palette — "put a good on the ground" (`dropGood`). Mutually exclusive with the
        // build menu / building placement (one held thing at a time).
        placement.cancel();
        goodsDrop.cancel();
        menu.close();
        goodsWindow.toggle();
        break;
      case 'statistics':
      case 'help': // placeholder alias: Help has no window yet, so it toggles Statistics for now.
        stats.toggle();
        break;
      case 'options':
        opts.onSystemMenu?.();
        break;
      default:
        // mission / diplomacy / population / tech_tree — not wired in v1.
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
    if (goodsWindow.claims(x, y)) return true;
    if (stats.claims(x, y)) return true;
    // Placement / good-drop claim the whole canvas until placed/cancelled.
    if (placement.isActive() || goodsDrop.isActive()) return true;
    return false;
  };

  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);

    // Right button cancels an active placement / good-drop; otherwise it's a world order (left to the
    // unit controls).
    if (e.button === 2) {
      if (placement.isActive() || goodsDrop.isActive()) {
        e.preventDefault();
        // Stop the same event reaching unit-controls' mousedown (it re-checks claimPointer after this
        // handler runs — cancel clears the claim, so without this the right-click would also issue a
        // world move order). We register first (mounted before unit-controls), so this wins.
        e.stopImmediatePropagation();
        placement.cancel();
        goodsDrop.cancel();
      }
      return;
    }
    if (e.button !== 0) return;
    // A higher overlay covers this point: whatever sits under it is invisible, so the panel must not
    // consume the press — the overlay's own handler acts on it instead (see the option's doc).
    if (opts.deferToOverlay?.(e.clientX, e.clientY) === true) return;

    // Track whether the panel consumes this press; if so, stop it from also reaching world picking.
    // Priority: strip button > open menu > open stats (close-on-inside) > active placement drop.
    let consumed = false;
    const btn = hitTestToolPanel(layout, x, y);
    if (btn !== null) {
      activateButton(btn);
      consumed = true;
    } else {
      consumed = menu.handleClick(x, y);
    }
    if (!consumed) consumed = goodsWindow.handleClick(x, y);
    if (!consumed) consumed = stats.handleClick(x, y);
    if (!consumed) consumed = placement.handleClick(e.clientX, e.clientY);
    if (!consumed) consumed = goodsDrop.handleClick(e.clientX, e.clientY);
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

  // Wheel scrolls the open building menu's list. Suppress the browser's default wheel action over any open
  // pop-up (the menu scrolls; the stats window has no scroll yet but must not page the document behind the
  // canvas either) — the camera's pointer-guard already skips zoom over these same windows.
  const onWheel = (e: WheelEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    if (menu.handleWheel(x, y, e.deltaY) || stats.claims(x, y)) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      if (placement.isActive()) placement.cancel();
      if (goodsDrop.isActive()) goodsDrop.cancel();
    }
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
      speedButton.togglePause();
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  speedButton.init(); // initialise the speed button graphic only — the loop keeps the entry's seeded speed

  const claimsWheel = (clientX: number, clientY: number): boolean => {
    const { x, y } = toCanvas(clientX, clientY);
    return menu.claims(x, y) || goodsWindow.claims(x, y) || stats.claims(x, y);
  };

  return {
    claimsPointer,
    claimsWheel,
    placementType: () => placement.activeType(),
    update(hud): void {
      // The strip is a static baked texture (a scene-graph sprite that batches + follows resizes for
      // free) — no per-frame re-placement. The build menu's vector runs stay put too, so refresh() only
      // reflows on a resize; the goods window (its own factory), stats window + placement banner re-place.
      menu.refresh();
      if (goodsWindow.isOpen()) goodsWindow.place();
      stats.refresh(hud);
      placement.placeBanner();
      goodsDrop.placeBanner();
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
