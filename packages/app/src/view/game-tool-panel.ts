import type { SessionClock } from '@open-northland/lockstep';
import type { Camera, ElevationField, SpriteSheet } from '@open-northland/render';
import type { Command, Paper, PlayerCommand } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { localizedBuildingName } from '../catalog/building-i18n.js';
import { vikingBuildingByTypeId } from '../catalog/buildings.js';
import type { MissionBrief } from '../game/mission-brief.js';
import type { Rect } from '../hud/geometry.js';
import type { KeyBindings } from '../hud/keybindings.js';
import { createReplaceableMount } from '../hud/replaceable-mount.js';
import type { MenuBuildingEntry } from '../hud/tool-panel/building-menu.js';
import type { DiplomacyPanelRow } from '../hud/tool-panel/diplomacy/index.js';
import type {
  ExtrasCountersSeam,
  ExtrasGrantsSeam,
  ExtrasPapersSeam,
} from '../hud/tool-panel/extras-window.js';
import type { GameSpeedChangeCause, GameSpeedStateSpec } from '../hud/tool-panel/game-speed.js';
import type { MenuGoodEntry } from '../hud/tool-panel/goods-menu.js';
import { mountToolPanel, type ToolPanelController } from '../hud/tool-panel/index.js';
import type { MessageTarget } from '../hud/tool-panel/messages/index.js';
import type { TooltipSurface } from '../hud/tooltip-surface.js';
import { currentLocale } from '../i18n/index.js';
import { clientToScreen, screenScale } from './camera/index.js';
import { nodeBounds, screenToWorld, worldToTile } from './picking.js';

/**
 * Wraps the tool panel with the wiring the map viewer and the acceptance scenes share, chiefly the
 * client-point to tile mapping that returns null off the map so a stray click never clamp-places.
 */

export interface GameToolPanelDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Shared with the unit controls; may be fractional. */
  readonly uiscale: number;
  readonly camera: () => Camera;
  /** A closure, so it follows a scene restart. */
  readonly enqueue: (command: PlayerCommand) => void;
  /** The goods palette's sandbox world-edit seam; a closure, so it follows a scene restart. */
  readonly enqueueAdmin: (command: Command) => void;
  /** Gates the placement click; a closure, so it follows a scene restart. */
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  /** A placement click outside these bounds is rejected, never clamped to the border. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** Terrain-height field, so a click on a lifted hill resolves to the tile drawn there. */
  readonly elevation?: ElevationField;
  readonly buildings: readonly MenuBuildingEntry[];
  readonly goods: readonly MenuGoodEntry[];
  /** The tribe a placed building is stamped with. */
  readonly tribe: number;
  /** The player a placed building is owned by. */
  readonly owner: number;
  readonly grants: ExtrasGrantsSeam;
  readonly counters: ExtrasCountersSeam;
  readonly papers: ExtrasPapersSeam;
  /** The diplomacy window's roster: one row per discovered player. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
  /** A seat's roster name, for the note about an eliminated player. */
  readonly seatNameOf?: (player: number) => string | undefined;
  /** The diplomacy window's pay button; a closure, so it follows a scene restart. */
  readonly onPayTribute: (slot: number) => void;
  /** UI string language (`pol`/`eng`); defaults to the active locale. */
  readonly lang?: string;
  readonly bindings: KeyBindings;
  readonly onSpeed: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** A higher overlay's claim: the panel yields left clicks it covers, so hit priority follows draw order. */
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** That overlay's screen-px box, which the panel's pop-up lists size against. */
  readonly overlayReserve?: () => Rect | null;
  readonly onSystemMenu?: () => void;
  /** The mission window's brief for a briefing page, or the map's fallback text with null. */
  readonly missionBrief?: (page: number | null) => MissionBrief | null;
  readonly missionBriefingHistory?: () => readonly number[];
  /** The briefing page the mission window opens on from the strip; null before any replayable one. */
  readonly missionReplayPage?: () => number | null;
  readonly onLargeWindow?: (open: boolean) => void;
  /** The map's sprite sheet for the note portraits; absent leaves the notes bare. */
  readonly sheet?: SpriteSheet;
  readonly playerColourOf?: (player: number) => number;
  /** The cursor chip a hovered note shows its text in. */
  readonly tooltip?: TooltipSurface;
  /** A note's Select: centre the view on the target and select it. */
  readonly onSelectMessageTarget?: (target: MessageTarget) => void;
}

export interface GameToolPanelHandle {
  readonly controller: ToolPanelController;
  /** True over the strip, an open window, or active placement; asked before any world picking. */
  claimPointer(clientX: number, clientY: number): boolean;
  /** True over an open pop-up window, so scrolling its list never also zooms the world behind it. */
  claimsWheel(clientX: number, clientY: number): boolean;
  /** Shared with the frame loop's build hover, so the ghost and the placement click resolve identically. */
  clientToTile(clientX: number, clientY: number): { col: number; row: number } | null;
  setUiScale(uiscale: number): Promise<void>;
  dispose(): void;
}

/**
 * Apply the panel's game-speed spec to the session clock. A `'cycle'` sets the multiplier and
 * un-pauses; a `'pause-toggle'` flips only the pause flag, since writing the multiplier would replace a
 * fractional `?speed=` seed with the button's discrete steps.
 */
export function applyGameSpeed(
  clock: SessionClock,
  spec: GameSpeedStateSpec,
  cause: GameSpeedChangeCause,
): void {
  clock.setPaused(spec.state === 'paused');
  if (cause === 'cycle' && spec.state !== 'paused') clock.setSpeed(spec.tickMultiplier);
}

/**
 * The content set's building types, labelled through the viking catalog and localized to `lang`. The
 * English catalog label is the fallback when a language has no authored name.
 */
export function menuEntriesFromContent(
  content: { buildings: readonly { typeId: number; id: string; kind: string }[] },
  lang: string = currentLocale(),
): MenuBuildingEntry[] {
  return content.buildings.map((b) => {
    const catalog = vikingBuildingByTypeId(b.typeId);
    const english = catalog?.label ?? b.id;
    return {
      typeId: b.typeId,
      label: localizedBuildingName(catalog?.id ?? b.id, english, lang),
      kind: b.kind,
    };
  });
}

/** The content set's goods in its own order, minus the `none` sentinel, which is not a droppable ware. */
export function menuGoodsFromContent(content: {
  goods: readonly { typeId: number; id: string; name?: string | undefined }[];
}): MenuGoodEntry[] {
  return content.goods
    .filter((g) => g.id !== 'none')
    .map((g) => ({ goodType: g.typeId, id: g.id, label: g.name ?? g.id }));
}

export async function mountGameToolPanel(deps: GameToolPanelDeps): Promise<GameToolPanelHandle> {
  const clientToTile = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const c = clientToScreen(deps.canvas, deps.app.renderer.resolution, clientX, clientY);
    const w = screenToWorld(deps.camera(), c.x, c.y);
    const t = worldToTile(w.x, w.y, deps.elevation);
    // `worldToTile` yields half-cell nodes, so the bound is the node grid, not the cell grid.
    const bounds = nodeBounds(deps.mapSize);
    if (t.col < 0 || t.col >= bounds.width || t.row < 0 || t.row >= bounds.height) return null;
    return { col: t.col, row: t.row };
  };

  const mountController = (uiscale: number) =>
    mountToolPanel({
      app: deps.app,
      canvas: deps.canvas,
      uiscale,
      buildings: deps.buildings,
      goods: deps.goods,
      lang: deps.lang ?? currentLocale(),
      bindings: deps.bindings,
      tribe: deps.tribe,
      owner: deps.owner,
      enqueue: deps.enqueue,
      enqueueAdmin: deps.enqueueAdmin,
      grants: deps.grants,
      counters: deps.counters,
      papers: deps.papers,
      diplomacyRows: deps.diplomacyRows,
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      onPayTribute: deps.onPayTribute,
      screenToTile: clientToTile,
      canPlaceAt: deps.canPlaceAt,
      onSpeedChange: deps.onSpeed,
      screenScale: (c) => screenScale(c, deps.app.renderer.resolution),
      ...(deps.deferToOverlay !== undefined ? { deferToOverlay: deps.deferToOverlay } : {}),
      ...(deps.overlayReserve !== undefined ? { overlayReserve: deps.overlayReserve } : {}),
      ...(deps.onSystemMenu !== undefined ? { onSystemMenu: deps.onSystemMenu } : {}),
      ...(deps.missionBrief !== undefined ? { missionBrief: deps.missionBrief } : {}),
      ...(deps.missionBriefingHistory !== undefined
        ? { missionBriefingHistory: deps.missionBriefingHistory }
        : {}),
      ...(deps.missionReplayPage !== undefined ? { missionReplayPage: deps.missionReplayPage } : {}),
      ...(deps.onLargeWindow !== undefined ? { onLargeWindow: deps.onLargeWindow } : {}),
      ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      ...(deps.tooltip !== undefined ? { tooltip: deps.tooltip } : {}),
      ...(deps.onSelectMessageTarget !== undefined
        ? { onSelectMessageTarget: deps.onSelectMessageTarget }
        : {}),
    });

  const mounts = createReplaceableMount(
    await mountController(deps.uiscale),
    mountController,
    (next, previous) => next.restore(previous.state()),
  );

  return {
    get controller() {
      return mounts.current();
    },
    claimPointer: (x, y) => mounts.current().claimsPointer(x, y),
    claimsWheel: (x, y) => mounts.current().claimsWheel(x, y),
    clientToTile,
    setUiScale: (uiscale) => mounts.replace(uiscale),
    dispose: () => mounts.dispose(),
  };
}
