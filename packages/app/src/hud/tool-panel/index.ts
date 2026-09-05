import type { HudLayout } from '@open-northland/render';
import type { Command, PlayerCommand } from '@open-northland/sim';
import { type Application, Container, Texture } from 'pixi.js';
import { loadGuiArt } from '../../content/gui-art.js';
import {
  type GuiBitmapName,
  type GuiStrings,
  loadGuiBitmap,
  loadGuiStrings,
  type UiString,
  uiStringLookup,
} from '../../content/gui-gfx.js';
import { loadUiFont, type UiFont } from '../../content/ui-font.js';
import type { MissionBrief } from '../../game/mission-brief.js';
import { clientToCanvas, type Rect } from '../geometry.js';
import type { KeyBindings } from '../keybindings.js';
import { makeUiParagraph, makeUiTextRun } from '../ui-text.js';
import type { MenuBuildingEntry } from './building-menu.js';
import { applyToolButtonEffect, type ToolButtonSurfaces } from './button-effects.js';
import type { PanelBitmaps, PanelContext } from './context.js';
import type { DiplomacyPanelRow } from './diplomacy/index.js';
import type { ExtrasCountersSeam, ExtrasGrantsSeam } from './extras-window.js';
import type { GameSpeedChangeCause, GameSpeedControl, GameSpeedStateSpec } from './game-speed.js';
import { createGoodsDropController } from './goods-drop.js';
import type { MenuGoodEntry } from './goods-menu.js';
import { createToolPanelInput, type HeldMode, type ToolPanelInput } from './input.js';
import { buildToolPanelLayout, pointOverToolPanel, type ToolButtonId } from './layout.js';
import { createPlacementController } from './placement.js';
import { createSpeedButton } from './speed-button.js';
import { createStripSurface, type StripSurface } from './strip-surface.js';
import { createToolWindows, type ToolWindowsState } from './windows.js';

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
  /** Resolved player key bindings; the input layer reads the pause key from it. */
  readonly bindings: KeyBindings;
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
  /** The diplomacy window's roster: one row per discovered player, pulled only while it is open. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
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
  /** The mission window's content, read on each open; absent opens an empty sheet. */
  readonly missionBrief?: () => MissionBrief | null;
  /** Fires as the mission window opens and closes, so the host can hold game time behind it. */
  readonly onLargeWindow?: (open: boolean) => void;
}

export interface ToolPanelController {
  /** The decoded UI string lookup the panel resolved for its language, shared with sibling overlays. */
  readonly uiString: UiString;
  /** Open the mission window (the map's briefing and goals), as the session start does. */
  openMission(): void;
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
  state(): ToolPanelState;
  restore(state: ToolPanelState): void;
  dispose(): void;
}

export interface ToolPanelState {
  readonly speed: GameSpeedControl;
  readonly windows: ToolWindowsState;
  readonly placementType: number | null;
  readonly goodType: number | null;
}

interface ToolPanelAssets {
  readonly art: Awaited<ReturnType<typeof loadGuiArt>>;
  readonly strings: GuiStrings | null;
  readonly uiFont: UiFont;
  readonly bitmaps: PanelBitmaps;
}

const assetsByLanguage = new Map<string, Promise<ToolPanelAssets>>();

function loadToolPanelAssets(lang: string): Promise<ToolPanelAssets> {
  let assets = assetsByLanguage.get(lang);
  if (assets !== undefined) return assets;
  const loadBitmap = async (name: GuiBitmapName): Promise<Texture | undefined> => {
    const source = await loadGuiBitmap(name);
    return source === undefined ? undefined : new Texture({ source });
  };
  assets = Promise.all([
    loadGuiArt(),
    loadGuiStrings(lang),
    loadUiFont(),
    loadBitmap('bg'),
    loadBitmap('bg_button'),
    loadBitmap('bg_button_hilite'),
    loadBitmap('bg_headline'),
  ]).then(([art, strings, uiFont, bg, button, buttonHilite, headline]) => ({
    art,
    strings,
    uiFont,
    bitmaps: { bg, button, buttonHilite, headline },
  }));
  assetsByLanguage.set(lang, assets);
  // A rejected load would otherwise pin every later rebuild to the one transient failure.
  void assets.catch(() => assetsByLanguage.delete(lang));
  return assets;
}

/** Mount the tool panel onto the app stage; async because it loads the optional decoded GUI art and font. */
export async function mountToolPanel(opts: ToolPanelOptions): Promise<ToolPanelController> {
  const { app, canvas, enqueue } = opts;
  const layout = buildToolPanelLayout(opts.uiscale);
  const scale = layout.scale;

  const { art, strings, uiFont, bitmaps } = await loadToolPanelAssets(opts.lang);

  const labelByType = new Map(opts.buildings.map((b) => [b.typeId, b.label]));

  const root = new Container();
  root.zIndex = 1000;
  app.stage.addChild(root);
  const stripContainer = new Container();
  const hoverContainer = new Container();
  const windowContainer = new Container();
  const bannerContainer = new Container();
  root.addChild(stripContainer, windowContainer, hoverContainer, bannerContainer);

  let stripSurface: StripSurface | null = null;
  let input: ToolPanelInput | null = null;
  try {
    stripSurface = createStripSurface({ app, container: stripContainer, layout, art });
    const mountedStrip = stripSurface;

    const ctx: PanelContext = {
      layout,
      scale,
      makeText: (text, color, px) => makeUiTextRun(uiFont.family, text, color, scale, px),
      makeParagraph: (text, color, px, wrapWidth, align) =>
        makeUiParagraph(uiFont.family, text, color, scale, px, wrapWidth, align),
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
      diplomacyRows: opts.diplomacyRows,
      art,
      missionBrief: opts.missionBrief ?? ((): null => null),
      ...(opts.onLargeWindow !== undefined ? { onLargeWindow: opts.onLargeWindow } : {}),
      onPickBuilding: (typeId) => placement.enter(typeId),
      onPickGood: (goodType) => goodsDrop.enter(goodType),
    });

    const speedButton = createSpeedButton({
      ctx,
      app,
      scale,
      stripContainer,
      art,
      bake: stripSurface,
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

    input = createToolPanelInput({
      canvas,
      container: hoverContainer,
      layout,
      toCanvas,
      windows,
      held,
      bindings: opts.bindings,
      activateButton,
      togglePause: () => speedButton.togglePause(),
      ...(opts.deferToOverlay !== undefined ? { deferToOverlay: opts.deferToOverlay } : {}),
    });
    const mountedInput = input;

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
      uiString: ctx.uiString,
      openMission: () => {
        if (!windows.byId.mission.isOpen()) activateButton('mission');
      },
      claimsPointer,
      claimsWheel,
      placementType: () => placement.activeType(),
      update(hudFor): void {
        if (mountedStrip.syncResolution()) speedButton.syncGlyph();
        windows.refresh(hudFor);
        for (const mode of held) mode.placeBanner();
      },
      state: () => ({
        speed: speedButton.state(),
        windows: windows.state(),
        placementType: placement.activeType(),
        goodType: goodsDrop.activeGood(),
      }),
      restore(state): void {
        speedButton.restore(state.speed);
        windows.restore(state.windows);
        if (state.placementType !== null) placement.enter(state.placementType);
        if (state.goodType !== null) goodsDrop.enter(state.goodType);
      },
      dispose(): void {
        mountedInput.dispose();
        root.destroy({ children: true });
        mountedStrip.dispose();
      },
    };
  } catch (error: unknown) {
    input?.dispose();
    root.destroy({ children: true });
    stripSurface?.dispose();
    throw error;
  }
}
