import type { HypertextBook } from '@open-northland/data';
import type { HudLayout, SpriteSheet } from '@open-northland/render';
import type { Command, PlayerCommand, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Texture } from 'pixi.js';
import { loadGuiArt } from '../../content/gui-art.js';
import {
  type GuiBitmapName,
  type GuiStrings,
  loadGuiBitmap,
  loadGuiHistory,
  loadGuiStrings,
  type UiString,
  uiStringLookup,
} from '../../content/gui-gfx.js';
import { loadUiFont, type UiFont } from '../../content/ui-font.js';
import type { MissionBrief } from '../../game/mission-brief.js';
import { clientToCanvas, type Rect } from '../geometry.js';
import type { KeyBindings } from '../keybindings.js';
import type { TooltipSurface } from '../tooltip-surface.js';
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
import {
  createMessageCenter,
  MESSAGE_LEVEL_FACE,
  type MessageFeedState,
  type MessageTarget,
} from './messages/index.js';
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
  readonly missionBrief?: () => MissionBrief | null;
  readonly onLargeWindow?: (open: boolean) => void;
  /** The map's sprite sheet, which draws a settler standing on its note; absent leaves the note bare. */
  readonly sheet?: SpriteSheet;
  /** Owner slot to team-colour slot for those portraits; absent means identity. */
  readonly playerColourOf?: (player: number) => number;
  /** The cursor chip a hovered note shows its text in; absent means no tooltip. */
  readonly tooltip?: TooltipSurface;
  /** A note's Select: centre the view on the target and select it. */
  readonly onSelectMessageTarget?: (target: MessageTarget) => void;
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
  /** Per-frame hook for the note strip: this frame's unfiltered sim events and the snapshot after them. */
  presentMessages(snapshot: WorldSnapshot, events: readonly SimEvent[]): void;
  state(): ToolPanelState;
  restore(state: ToolPanelState): void;
  dispose(): void;
}

export interface ToolPanelState {
  readonly speed: GameSpeedControl;
  readonly windows: ToolWindowsState;
  readonly placementType: number | null;
  readonly goodType: number | null;
  readonly messages: MessageFeedState;
}

interface ToolPanelAssets {
  readonly art: Awaited<ReturnType<typeof loadGuiArt>>;
  readonly strings: GuiStrings | null;
  readonly uiFont: UiFont;
  readonly bitmaps: PanelBitmaps;
  readonly history: HypertextBook | null;
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
    loadGuiHistory(lang),
    loadUiFont(),
    loadBitmap('bg'),
    loadBitmap('bg_button'),
    loadBitmap('bg_button_hilite'),
    loadBitmap('bg_headline'),
  ]).then(([art, strings, history, uiFont, bg, button, buttonHilite, headline]) => ({
    art,
    strings,
    uiFont,
    bitmaps: { bg, button, buttonHilite, headline },
    history,
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

  const { art, strings, uiFont, bitmaps, history } = await loadToolPanelAssets(opts.lang);

  const labelByType = new Map(opts.buildings.map((b) => [b.typeId, b.label]));

  const root = new Container();
  root.zIndex = 1000;
  app.stage.addChild(root);
  const stripContainer = new Container();
  const notesContainer = new Container();
  const hoverContainer = new Container();
  const windowContainer = new Container();
  const bannerContainer = new Container();
  root.addChild(stripContainer, notesContainer, windowContainer, hoverContainer, bannerContainer);

  let stripSurface: StripSurface | null = null;
  let input: ToolPanelInput | null = null;
  try {
    stripSurface = createStripSurface({ app, container: stripContainer, layout, art });
    const mountedStrip = stripSurface;

    const uiString = uiStringLookup(strings);
    const contextAt = (at: number): PanelContext => ({
      layout,
      scale: at,
      makeText: (text, color, px) => makeUiTextRun(uiFont.family, text, color, at, px),
      makeParagraph: (text, color, px, wrapWidth, align) =>
        makeUiParagraph(uiFont.family, text, color, at, px, wrapWidth, align),
      bitmaps,
      uiString,
      screen: () => app.screen,
      ...(opts.overlayReserve !== undefined ? { overlayReserve: opts.overlayReserve } : {}),
      atScale: contextAt,
    });
    const ctx = contextAt(scale);

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
      history,
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

    const messageCenter = createMessageCenter({
      ctx,
      app,
      art,
      notesContainer,
      windowContainer,
      sheet: opts.sheet,
      playerColourOf: opts.playerColourOf,
      localPlayer: opts.owner,
      buildingLabel: (typeId) => labelByType.get(typeId),
      playerLabel: (player) => opts.diplomacyRows().find((r) => r.player === player)?.name ?? null,
      tooltip: opts.tooltip,
      onSelect: (target) => opts.onSelectMessageTarget?.(target),
    });
    // The envelope loses a seal per level, re-framed inside the strip bake like the speed glyph.
    const syncPriorityGlyph = (): void =>
      mountedStrip.reframe('message_priority', MESSAGE_LEVEL_FACE[messageCenter.level()].gfx);

    const surfaces: ToolButtonSurfaces = {
      windows: windows.byId,
      cancelHeld: () => {
        for (const mode of held) mode.cancel();
      },
      cycleSpeed: () => speedButton.cycle(),
      openSystemMenu: () => opts.onSystemMenu?.(),
      cycleMessagePriority: () => {
        messageCenter.cycleLevel();
        syncPriorityGlyph();
      },
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
      notes: messageCenter,
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
      if (windows.claims(x, y) || messageCenter.claims(x, y)) return true;
      return held.some((mode) => mode.isActive());
    };

    speedButton.syncGlyph();
    syncPriorityGlyph();

    const claimsWheel = (clientX: number, clientY: number): boolean => {
      const { x, y } = toCanvas(clientX, clientY);
      return windows.claims(x, y) || messageCenter.claims(x, y);
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
        if (mountedStrip.syncResolution()) {
          speedButton.syncGlyph();
          syncPriorityGlyph();
        }
        windows.refresh(hudFor);
        for (const mode of held) mode.placeBanner();
      },
      presentMessages: (snapshot, events) => messageCenter.present(snapshot, events),
      state: () => ({
        speed: speedButton.state(),
        windows: windows.state(),
        placementType: placement.activeType(),
        goodType: goodsDrop.activeGood(),
        messages: messageCenter.state(),
      }),
      restore(state): void {
        speedButton.restore(state.speed);
        windows.restore(state.windows);
        if (state.placementType !== null) placement.enter(state.placementType);
        if (state.goodType !== null) goodsDrop.enter(state.goodType);
        messageCenter.restore(state.messages);
        syncPriorityGlyph();
      },
      dispose(): void {
        mountedInput.dispose();
        messageCenter.dispose();
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
