import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import type { SessionClock } from '@open-northland/lockstep';
import type { Camera, ElevationField, SpriteSheet } from '@open-northland/render';
import {
  constructionBillForType,
  type DiplomacyState,
  type Paper,
  type PlayerCommand,
  type Simulation,
} from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { localizedBuildingName } from '../catalog/building-i18n.js';
import { vikingBuildingByTypeId } from '../catalog/buildings.js';
import type { MissionBrief } from '../game/mission-brief.js';
import type { ViewerSeat } from '../game/viewer-seat.js';
import type { Rect } from '../hud/geometry.js';
import type { KeyBindings } from '../hud/keybindings.js';
import { createReplaceableMount } from '../hud/replaceable-mount.js';
import { CATALOGUE_KINDS, type MenuBuildingEntry } from '../hud/tool-panel/building-menu.js';
import type { DiplomacyPanelRow } from '../hud/tool-panel/diplomacy/index.js';
import type { ExtrasCountersSeam, ExtrasGrantsSeam } from '../hud/tool-panel/extras-window.js';
import type { GameSpeedChangeCause, GameSpeedStateSpec } from '../hud/tool-panel/game-speed.js';
import {
  mountToolPanel,
  type PalisadeTools,
  type ToolPanelController,
  type ToolPanelOptions,
} from '../hud/tool-panel/index.js';
import type { MessageTarget, NoticeGallery } from '../hud/tool-panel/messages/index.js';
import type { PapersSeam } from '../hud/tool-panel/paper-cards.js';
import type { PalisadeGateProbeView } from '../hud/tool-panel/placement.js';
import type { ResidentsSeam } from '../hud/tool-panel/residents/seam.js';
import { currentLocale } from '../i18n/index.js';
import type { PresentationPack } from '../presentation/pack.js';
import { clientToScreen, screenScale } from './camera/index.js';
import { nodeBounds, screenToWorld, worldToTile } from './picking.js';

/**
 * Wraps the tool panel with the wiring the map viewer and the acceptance scenes share, chiefly the
 * client-point to tile mapping that returns null off the map so a stray click never clamp-places.
 */

export interface GameToolPanelDeps {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The DOM HUD plane the shell regions mount on. */
  readonly plane: HTMLElement;
  /** Shared with the unit controls; may be fractional. */
  readonly uiscale: number;
  readonly camera: () => Camera;
  /** A closure, so it follows a scene restart. */
  readonly enqueue: (command: PlayerCommand) => void;
  /** Gates the placement click; a closure, so it follows a scene restart. */
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlacePalisadeAt: (gfxIndex: number, col: number, row: number) => boolean;
  readonly palisadeGateProbe: (gfxIndex: number, col: number, row: number) => PalisadeGateProbeView | null;
  readonly palisadeTools: PalisadeTools;
  /** A placement click outside these bounds is rejected, never clamped to the border. */
  readonly mapSize: { readonly width: number; readonly height: number };
  /** Terrain-height field, so a click on a lifted hill resolves to the tile drawn there. */
  readonly elevation?: ElevationField;
  readonly buildings: readonly MenuBuildingEntry[];
  /** Every building type's localized name, catalogue or not: notes, papers and the strip name them. */
  readonly buildingLabels: ReadonlyMap<number, string>;
  /** Localized name of a profession, good, or building announced by a discovery note. */
  readonly technologyLabel: (kind: 'job' | 'good' | 'house', typeId: number) => string;
  /** A good's localized name, for a produce permit's label. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** The content set's goods, for the summary bar's per-good rows. */
  readonly goods: readonly { readonly typeId: number; readonly id: string }[];
  /** The pack the map draws with, or null for the original's art, so the HUD's good icons match it. */
  readonly pack: PresentationPack | null;
  /** The tribe a placed building is stamped with. */
  readonly tribe: number;
  /** The player a placed building is owned by. */
  readonly owner: number;
  /** Whose notes the column shows. */
  readonly viewer: ViewerSeat;
  /** A spectator's seat picker on the system bar; absent, the bar has none. */
  readonly observer?: ToolPanelOptions['observer'];
  readonly grants: ExtrasGrantsSeam;
  readonly counters: ExtrasCountersSeam;
  readonly papers: PapersSeam;
  readonly residents: ResidentsSeam;
  /** The diplomacy window's roster: one row per discovered player. */
  readonly diplomacyRows: () => readonly DiplomacyPanelRow[];
  /** A seat's roster name, for the note about an eliminated player. */
  readonly seatNameOf?: (player: number) => string | undefined;
  /** The diplomacy window's pay button; a closure, so it follows a scene restart. */
  readonly onPayTribute: (slot: number) => void;
  /** The diplomacy window's stance buttons; a closure, as the pay button. */
  readonly onDeclareDiplomacy: (player: number, state: DiplomacyState) => void;
  /** UI string language (`pol`/`eng`); defaults to the active locale. */
  readonly lang?: string;
  readonly bindings: KeyBindings;
  readonly onSpeed: (spec: GameSpeedStateSpec, cause: GameSpeedChangeCause) => void;
  /** Whether the session clock stands, whoever stopped it; absent, the bar shows its own pause only. */
  readonly clockPaused?: () => boolean;
  /** True while an overlay holds the game paused (the system menu, the verdict, the mission sheet). */
  readonly pauseHeld?: () => boolean;
  /** A higher overlay's claim: the panel yields left clicks it covers, so hit priority follows draw order. */
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
  /** That overlay's screen-px box, which the panel's pop-up lists size against. */
  readonly overlayReserve?: () => Rect | null;
  readonly onSystemMenu?: () => void;
  readonly onToggleHud?: () => void;
  /** True while the system menu is open and owns the keyboard. */
  readonly systemMenuOpen?: () => boolean;
  readonly escapeClaimed?: () => boolean;
  /** The mission window's brief for a briefing page, or the map's fallback text with null. */
  readonly missionBrief?: (page: number | null) => MissionBrief | null;
  readonly missionBriefingHistory?: () => readonly number[];
  /** The briefing page the mission window opens on from the strip; null before any replayable one. */
  readonly missionReplayPage?: () => number | null;
  /** The human a briefing picture of a mission id shows; absent, those pictures draw nothing. */
  readonly missionHuman?: (missionId: number) => number | null;
  readonly onLargeWindow?: (open: boolean) => void;
  /** The map's sprite sheet for the cards' settler figures; absent leaves the thumbnails bare. */
  readonly sheet?: SpriteSheet;
  readonly playerColourOf?: (player: number) => number;
  /** A pressed card: centre the view on the target and select it. */
  readonly onSelectMessageTarget?: (target: MessageTarget) => void;
  /** Set, the notification column shows one note of every type (`?debug=notices`). */
  readonly noticeGallery?: NoticeGallery;
  /** The GUI click feedback for the panel's buttons and held modes; absent, silent. */
  readonly onUiCue?: (cue: UiCue) => void;
}

export interface GameToolPanelHandle {
  readonly controller: ToolPanelController;
  /** True over an open window or in active placement; asked before any world picking. */
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
 * The content set's building types the construction window lists, labelled through the viking
 * catalog and localized to `lang`; the English catalog label is the fallback when a language has no
 * authored name. As the original's selection window, it skips the vehicles and the wonders, and a
 * type that costs nothing: the headquarters stands from the map and the wall segment comes from the
 * wall tool, never from the catalogue. Each entry carries the from-scratch bill the sim charges.
 */
export function menuEntriesFromContent(
  content: Pick<ContentSet, 'buildings'>,
  lang: string = currentLocale(),
): MenuBuildingEntry[] {
  return content.buildings.flatMap((b) => {
    const cost = constructionBillForType(content.buildings, b.typeId);
    if (!CATALOGUE_KINDS.has(b.kind) || cost.length === 0) return [];
    return [{ typeId: b.typeId, label: buildingLabel(b, lang), kind: b.kind, cost }];
  });
}

/** Every building type's localized name, the catalogue's and the rest alike (the headquarters a
 *  note reports attacked, the wonder a paper names). */
export function buildingLabelsFromContent(
  content: Pick<ContentSet, 'buildings'>,
  lang: string = currentLocale(),
): ReadonlyMap<number, string> {
  return new Map(content.buildings.map((b) => [b.typeId, buildingLabel(b, lang)]));
}

function buildingLabel(b: { readonly typeId: number; readonly id: string }, lang: string): string {
  const catalog = vikingBuildingByTypeId(b.typeId);
  return localizedBuildingName(catalog?.id ?? b.id, catalog?.label ?? b.id, lang);
}

/** The content set's goods by type, labelled with their authored name; the `none` sentinel is no good. */
export function goodLabelsFromContent(content: {
  goods: readonly { typeId: number; id: string; name?: string | undefined }[];
}): ReadonlyMap<number, string> {
  return new Map(content.goods.filter((g) => g.id !== 'none').map((g) => [g.typeId, g.name ?? g.id]));
}

/** The quick row's wall-line tool and axis-detecting gate-conversion tool, from the map catalog. */
export function palisadeToolsOf(sim: Simulation): PalisadeTools {
  const types = sim.terrain?.landscapes?.types ?? [];
  const wall = types.find((type) => type.wall !== undefined && type.wall.gate === undefined);
  const gate = types.find((type) => type.wall?.gate?.open === false);
  return { wall: wall?.typeId ?? null, gate: gate?.typeId ?? null };
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
      plane: deps.plane,
      uiscale,
      buildings: deps.buildings,
      buildingLabels: deps.buildingLabels,
      technologyLabel: deps.technologyLabel,
      goodLabel: deps.goodLabel,
      goods: deps.goods,
      pack: deps.pack,
      lang: deps.lang ?? currentLocale(),
      bindings: deps.bindings,
      tribe: deps.tribe,
      owner: deps.owner,
      viewer: deps.viewer,
      ...(deps.observer !== undefined ? { observer: deps.observer } : {}),
      enqueue: deps.enqueue,
      grants: deps.grants,
      counters: deps.counters,
      papers: deps.papers,
      residents: deps.residents,
      diplomacyRows: deps.diplomacyRows,
      ...(deps.seatNameOf !== undefined ? { seatNameOf: deps.seatNameOf } : {}),
      onPayTribute: deps.onPayTribute,
      onDeclareDiplomacy: deps.onDeclareDiplomacy,
      screenToTile: clientToTile,
      canPlaceAt: deps.canPlaceAt,
      canPlacePalisadeAt: deps.canPlacePalisadeAt,
      palisadeGateProbe: deps.palisadeGateProbe,
      palisadeTools: deps.palisadeTools,
      onSpeedChange: deps.onSpeed,
      ...(deps.clockPaused !== undefined ? { clockPaused: deps.clockPaused } : {}),
      ...(deps.pauseHeld !== undefined ? { pauseHeld: deps.pauseHeld } : {}),
      screenScale: (c) => screenScale(c, deps.app.renderer.resolution),
      ...(deps.deferToOverlay !== undefined ? { deferToOverlay: deps.deferToOverlay } : {}),
      ...(deps.overlayReserve !== undefined ? { overlayReserve: deps.overlayReserve } : {}),
      ...(deps.onSystemMenu !== undefined ? { onSystemMenu: deps.onSystemMenu } : {}),
      ...(deps.onToggleHud !== undefined ? { onToggleHud: deps.onToggleHud } : {}),
      ...(deps.systemMenuOpen !== undefined ? { systemMenuOpen: deps.systemMenuOpen } : {}),
      ...(deps.escapeClaimed !== undefined ? { escapeClaimed: deps.escapeClaimed } : {}),
      ...(deps.missionBrief !== undefined ? { missionBrief: deps.missionBrief } : {}),
      ...(deps.missionBriefingHistory !== undefined
        ? { missionBriefingHistory: deps.missionBriefingHistory }
        : {}),
      ...(deps.missionReplayPage !== undefined ? { missionReplayPage: deps.missionReplayPage } : {}),
      ...(deps.missionHuman !== undefined ? { missionHuman: deps.missionHuman } : {}),
      ...(deps.onLargeWindow !== undefined ? { onLargeWindow: deps.onLargeWindow } : {}),
      ...(deps.sheet !== undefined ? { sheet: deps.sheet } : {}),
      ...(deps.playerColourOf !== undefined ? { playerColourOf: deps.playerColourOf } : {}),
      ...(deps.onSelectMessageTarget !== undefined
        ? { onSelectMessageTarget: deps.onSelectMessageTarget }
        : {}),
      ...(deps.noticeGallery !== undefined ? { noticeGallery: deps.noticeGallery } : {}),
      ...(deps.onUiCue !== undefined ? { onUiCue: deps.onUiCue } : {}),
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
