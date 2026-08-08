import type { HudLayout, PalettedSprite } from '@open-northland/render';
import type { Command, PlayerCommand } from '@open-northland/sim';
import { type Application, Container, Graphics, Texture } from 'pixi.js';
import { type GuiArt, loadGuiArt, makeGuiSprite } from '../../content/gui-art.js';
import { type GuiBitmapName, loadGuiBitmap, loadGuiStrings, uiStringLookup } from '../../content/gui-gfx.js';
import { loadUiFont } from '../../content/ui-font.js';
import { clientToCanvas, type Rect } from '../geometry.js';
import { makeUiTextRun } from '../ui-text.js';
import type { MenuBuildingEntry } from './building-menu.js';
import { applyToolButtonEffect, type ToolButtonSurfaces } from './button-effects.js';
import type { PanelBitmaps, PanelContext } from './context.js';
import type { ExtrasCountersSeam, ExtrasGrantsSeam } from './extras-window.js';
import type { GameSpeedChangeCause, GameSpeedStateSpec } from './game-speed.js';
import { createGoodsDropController } from './goods-drop.js';
import type { MenuGoodEntry } from './goods-menu.js';
import { createToolPanelInput, type HeldMode } from './input.js';
import { buildToolPanelLayout, pointOverToolPanel, TOOL_PANEL_STRIP, type ToolButtonId } from './layout.js';
import { createPlacementController } from './placement.js';
import { createSpeedButton } from './speed-button.js';
import { buildOutlinedButtonSpecs } from './strip-outline.js';
import { createSupersampledStrip, type StripSpriteSpec, type SupersampledStrip } from './strip-texture.js';
import { createToolWindows } from './windows.js';

export interface ToolPanelOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The resolved HUD scale; the pinned internal geometry is multiplied by this. May be fractional. */
  readonly uiscale: number;
  /** The buildings the build menu lists. */
  readonly buildings: readonly MenuBuildingEntry[];
  /** The goods the drop palette lists. */
  readonly goods: readonly MenuGoodEntry[];
  /** Language for the decoded UI strings (`pol`/`eng`); falls back to the pinned Polish labels when absent. */
  readonly lang: string;
  /** The tribe a placed building is stamped with. */
  readonly tribe: number;
  /** The player slot a placed building is owned by. */
  readonly owner: number;
  /** Submit a seat command into the sim. */
  readonly enqueue: (command: PlayerCommand) => void;
  /** The goods palette's seam. Dropping a loose pile materializes goods from nothing, so it is a
   *  trusted world edit the HUD hands every seat, not an order a seat is entitled to issue. */
  readonly enqueueAdmin: (command: Command) => void;
  /** The chest window's grant-switch seam (reads the sim's assistant grants, toggles one). */
  readonly grants: ExtrasGrantsSeam;
  /** The chest window's counter seam (reads the sim's assistant queues, sets one). */
  readonly counters: ExtrasCountersSeam;
  /** Convert a client (CSS) point to a map tile, or `null` off the map - the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule (`Simulation.placementProbe`), which gates the placement click. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  readonly onSpeedChange: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Client (CSS px) → Pixi screen px mapper, shared with the unit controls. */
  readonly screenScale: (canvas: HTMLCanvasElement) => { sx: number; sy: number; rect: DOMRect };
  /** True when a higher HUD overlay covers this client point; the panel yields the left click there so
   *  hit priority follows draw order. Right-click (cancel placement) is deliberately not deferred. */
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** That same overlay's box, which the pop-up lists size against. */
  readonly overlayReserve?: () => Rect | null;
  readonly onSystemMenu?: () => void;
}

export interface ToolPanelController {
  /** True when a client point should be claimed by the HUD (over the strip, an open window, or in placement). */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** True when a client point is over an open pop-up window, which owns the wheel; unlike
   *  `claimsPointer` this excludes the strip and active placement. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** The building typeId currently being placed, or null when not in build mode. */
  placementType(): number | null;
  /** Per-frame hook; the HUD layout arrives as an accessor so a closed window never runs its
   *  `buildHud` scan. */
  update(hudFor: () => HudLayout): void;
  dispose(): void;
}

/** Strip and button block colours drawn when the decoded GUI art is absent. */
const FALLBACK_STRIP = 0x1c1810;
const FALLBACK_BUTTON = 0x4a3f28;
const FALLBACK_BUTTON_BORDER = 0x8a744a;

/** Mount the tool panel onto the app stage; async because it loads the optional decoded GUI art and font. */
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

  const root = new Container();
  root.zIndex = 1000;
  app.stage.addChild(root);
  const stripContainer = new Container();
  const hoverContainer = new Container();
  const windowContainer = new Container();
  const bannerContainer = new Container();
  root.addChild(stripContainer, windowContainer, hoverContainer, bannerContainer);

  let supersampled: SupersampledStrip | null = null;
  /** The renderer resolution the strip was baked at; a live DPR change re-bakes at the new density. */
  let stripResolution = app.renderer.resolution;
  const speedSprites: PalettedSprite[] = [];

  const buildStrip = (guiArt: GuiArt): void => {
    supersampled?.display.destroy();
    supersampled?.dispose();
    speedSprites.length = 0;
    // Deviation from the original's opaque panel: the strip keys its near-black backdrop away, so the
    // world shows past the carved silhouette.
    const specs: StripSpriteSpec[] = [];
    const strip = makeGuiSprite(guiArt, layout.stripGfx, {
      defaultPalette: 'iconsleft',
      colorKey: 'full',
    });
    if (strip !== null) specs.push({ spr: strip.sprite, design: TOOL_PANEL_STRIP });
    const outlined = buildOutlinedButtonSpecs(guiArt, layout.buttons);
    specs.push(...outlined.specs);
    speedSprites.push(...outlined.speedSprites);
    supersampled = createSupersampledStrip({ app, bounds: layout.designBounds, scale, sprites: specs });
    stripContainer.addChild(supersampled.display);
    stripResolution = app.renderer.resolution;
  };

  if (art !== null) {
    buildStrip(art);
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

  const ctx: PanelContext = {
    layout,
    scale,
    makeText: (text, color, px) => makeUiTextRun(uiFont.family, text, color, scale, px),
    bitmaps,
    uiString: uiStringLookup(strings),
    screen: () => app.screen,
    ...(opts.overlayReserve !== undefined ? { overlayReserve: opts.overlayReserve } : {}),
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
  const goodsDrop = createGoodsDropController({
    ctx,
    container: bannerContainer,
    labelByGood: new Map(opts.goods.map((g) => [g.goodType, g.label])),
    enqueue: opts.enqueueAdmin,
    screenToTile: opts.screenToTile,
  });
  const held: readonly HeldMode[] = [placement, goodsDrop];

  const windows = createToolWindows({
    ctx,
    container: windowContainer,
    buildings: opts.buildings,
    goods: opts.goods,
    grants: opts.grants,
    counters: opts.counters,
    onPickBuilding: (typeId) => placement.enter(typeId),
    onPickGood: (goodType) => goodsDrop.enter(goodType),
  });

  const speedButton = createSpeedButton({
    ctx,
    app,
    scale,
    stripContainer,
    art,
    strip: () => supersampled,
    speedSprites,
    speedBtnRect: layout.buttons.find((b) => b.id === 'speed')?.placed,
    onSpeedChange: opts.onSpeedChange,
  });

  const surfaces: ToolButtonSurfaces = {
    windows: windows.byId,
    cancelHeld: () => {
      for (const mode of held) mode.cancel();
    },
    cycleSpeed: () => speedButton.cycle(),
    openSystemMenu: () => opts.onSystemMenu?.(),
  };

  const activateButton = (id: ToolButtonId): void => applyToolButtonEffect(surfaces, id);

  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToCanvas(opts.screenScale(canvas), clientX, clientY);

  const input = createToolPanelInput({
    canvas,
    container: hoverContainer,
    layout,
    toCanvas,
    windows,
    held,
    activateButton,
    togglePause: () => speedButton.togglePause(),
    ...(opts.deferToOverlay !== undefined ? { deferToOverlay: opts.deferToOverlay } : {}),
  });

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    const { x, y } = toCanvas(clientX, clientY);
    if (pointOverToolPanel(layout, x, y)) return true;
    if (windows.claims(x, y)) return true;
    return held.some((mode) => mode.isActive());
  };

  speedButton.syncGlyph();

  const claimsWheel = (clientX: number, clientY: number): boolean => {
    const { x, y } = toCanvas(clientX, clientY);
    return windows.claims(x, y);
  };

  return {
    claimsPointer,
    claimsWheel,
    placementType: () => placement.activeType(),
    update(hudFor): void {
      if (art !== null && app.renderer.resolution !== stripResolution) {
        buildStrip(art);
        speedButton.syncGlyph();
      }
      windows.refresh(hudFor);
      for (const mode of held) mode.placeBanner();
    },
    dispose(): void {
      input.dispose();
      root.destroy({ children: true });
      supersampled?.dispose();
    },
  };
}
