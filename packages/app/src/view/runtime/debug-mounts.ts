import { BUILDING_KIND } from '@open-northland/data';
import type { SessionClock } from '@open-northland/lockstep';
import type { ElevationField, WorldRenderer } from '@open-northland/render';
import type { Command, systems } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import { ANIMAL_PALETTE_BY_TRIBE } from '../../catalog/animal-roster.js';
import { hasDebugFlag, setDebugFlag } from '../../diag/index.js';
import { bioGroundRuleWaived } from '../../game/snapshot/base.js';
import { vehicleLabel } from '../../game/technology.js';
import type { GoodIconPainter } from '../../hud/dom/good-art.js';
import type { StandingStructure } from '../../hud/tool-panel/placement.js';
import { bcp47Tag, compareLabels, currentLocale } from '../../i18n/index.js';
import { createLastAnswerCache, type SessionHost, samePlainData } from '../../session/index.js';
import { readAiSeats } from '../admin-debug/ai-seats.js';
import { createAdminEntityPicker } from '../admin-debug/entity-picker.js';
import { type AdminDebugHandle, mountAdminDebug } from '../admin-debug/index.js';
import { armorEntriesOf, everyJobExperience } from '../admin-debug/spawn-catalog.js';
import type { BuildingEntry } from '../admin-debug/tools.js';
import type { CameraController } from '../camera/index.js';
import { buildingLabelsFromContent } from '../game-tool-panel.js';
import { replaceEntryUrl } from '../platform/navigation-guard.js';
import {
  createGeometryDebugOverlay,
  type GeometryBuildingInfoOf,
  type GeometryDebugOverlay,
} from '../projections/index.js';

const NO_INPUTS = '';
const PER_TICK = true;

/** The `?debug=` value that turns on the building-geometry diagram. */
export const GEOMETRY_DEBUG_FLAG = 'geometry';

export interface DebugMountsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly params: URLSearchParams;
  readonly host: SessionHost;
  readonly renderer: WorldRenderer;
  readonly cameraCtl: CameraController;
  /** The DOM HUD plane the tools' panel drops onto. */
  readonly plane: HTMLElement;
  /** The system bar's lead, where the tools' toggle stands. */
  readonly barLead: HTMLElement;
  readonly initialToolsEnabled: boolean;
  readonly elevation?: ElevationField;
  readonly geometryOf: GeometryBuildingInfoOf;
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  readonly clientToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The trusted admin channel: every debug poke is a world edit, not a seat's order. */
  readonly enqueue: (command: Command) => void;
  readonly allowWorldEdits?: boolean;
  /** The composed HUD claim an admin spawn click must defer to. */
  readonly claimPointer: (clientX: number, clientY: number) => boolean;
  /** The localized good name by sim goodType. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** Owner slot to its roster tribe, so a spawned settler can work the buildings that slot raises. */
  readonly seatTribeOf: (player: number) => number;
  /** The session's roster seats, for the owner picker. */
  readonly seats: readonly number[];
  /** Seat to the team colour the HUD and minimap paint it with. */
  readonly seatColourOf?: (player: number) => number;
  /** Hand the HUD's placement tools a finished structure for `owner`; false when they cannot take it. */
  readonly enterStanding?: (structure: StandingStructure, owner: number, tribe: number) => boolean;
  /** Drop the HUD's held placement as a debug map tool is armed. */
  readonly cancelPlacement?: () => void;
  /** Drop the HUD's held placement when it is a debug finished structure. */
  readonly cancelStanding?: () => void;
  /** The session's own clock for the debug tempos; absent under a shared clock. */
  readonly clock?: Pick<SessionClock, 'speed' | 'setSpeed'>;
  readonly paintGood?: GoodIconPainter;
}

export interface DebugMounts {
  readonly geometryDebug: GeometryDebugOverlay;
  /** Shows or hides the debug tools and the aids they switch on, as the one settings toggle. */
  setToolsEnabled(enabled: boolean): void;
  /** Hide the tools with the rest of the HUD, leaving them switched on. */
  setHudHidden(hidden: boolean): void;
  /** Tear the tools' listeners and DOM down with the world that mounted them. */
  dispose(): void;
}

export function mountDebugOverlays(opts: DebugMountsOptions): DebugMounts {
  const { params, renderer } = opts;

  const geometryDebug = createGeometryDebugOverlay({
    enabled: hasDebugFlag(params, GEOMETRY_DEBUG_FLAG),
    geometryOf: opts.geometryOf,
    setItems: (items) => renderer.setGeometryDebug(items),
  });
  // Writing the URL back keeps a reload reproducing what is on screen.
  const setGeometryEnabled = (enabled: boolean): void => {
    geometryDebug.setEnabled(enabled);
    // `?debug=` holds a set: a plain `params.set` would clobber an active `profile,trace`.
    setDebugFlag(params, GEOMETRY_DEBUG_FLAG, enabled);
    const search = params.toString();
    replaceEntryUrl(`${window.location.pathname}${search === '' ? '' : `?${search}`}`);
  };

  // Not written to the URL: a reload resets the camera's zoom anyway.
  let zoomOutUnlocked = false;
  const setZoomOutUnlocked = (unlocked: boolean): void => {
    zoomOutUnlocked = unlocked;
    opts.cameraCtl.setZoomOutUnlocked(unlocked);
  };

  // Built on the first enable, so a player who never turns the tools on pays nothing for it.
  let admin: AdminDebugHandle | null = null;
  let toolsEnabled = false;
  let hudHidden = false;
  const setToolsEnabled = (enabled: boolean): void => {
    toolsEnabled = enabled;
    if (!enabled) {
      admin?.setVisible(false);
      // A finished structure held for placement is a debug tool too.
      opts.cancelStanding?.();
      // The grid's only switch is on the panel, so it must not outlive it.
      if (admin !== null && geometryDebug.enabled()) setGeometryEnabled(false);
      if (zoomOutUnlocked) setZoomOutUnlocked(false);
      return;
    }
    if (opts.allowWorldEdits === false) return;
    if (admin === null) {
      admin = mountAdminPanel(opts, geometryDebug, setGeometryEnabled, {
        unlocked: () => zoomOutUnlocked,
        setUnlocked: setZoomOutUnlocked,
      });
      opts.barLead.append(admin.toggle);
    }
    admin.setVisible(!hudHidden);
  };
  setToolsEnabled(opts.initialToolsEnabled);

  return {
    geometryDebug,
    setToolsEnabled,
    setHudHidden: (hidden) => {
      hudHidden = hidden;
      admin?.setVisible(toolsEnabled && !hidden);
    },
    dispose: () => {
      admin?.dispose();
      admin = null;
    },
  };
}

function mountAdminPanel(
  opts: DebugMountsOptions,
  geometryDebug: GeometryDebugOverlay,
  setGeometryEnabled: (enabled: boolean) => void,
  zoomOut: { readonly unlocked: () => boolean; readonly setUnlocked: (unlocked: boolean) => void },
): AdminDebugHandle {
  const { app, canvas, host, renderer } = opts;
  // The AI tab's apprentice read, asked again once the tick moved; the tab reads it once a second.
  const apprentices = createLastAnswerCache<readonly systems.ApprenticeView[]>({
    tick: () => host.tick,
    same: samePlainData,
  });
  return mountAdminDebug({
    canvas,
    plane: opts.plane,
    enqueue: opts.enqueue,
    clientToTile: (x, y) => opts.clientToTile(x, y),
    // A viewport-bounded pass over every owner, rebuilt per click rather than cached like the
    // per-frame hover set.
    pickEntity: createAdminEntityPicker({
      app,
      host,
      renderer,
      camera: opts.cameraCtl,
      toScreen: opts.clientToScreen,
      ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    }),
    claimPointer: (x, y) => opts.claimPointer(x, y),
    goodLabel: (typeId) => opts.goodLabel(typeId),
    seatTribeOf: (player) => opts.seatTribeOf(player),
    seats: opts.seats,
    ...(opts.seatColourOf !== undefined ? { seatColourOf: opts.seatColourOf } : {}),
    ...(opts.enterStanding !== undefined ? { enterStanding: opts.enterStanding } : {}),
    ...(opts.cancelPlacement !== undefined ? { cancelPlacement: opts.cancelPlacement } : {}),
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
    buildings: standingBuildings(host),
    goods: host.content.goods.map((g) => ({ good: g.typeId, id: g.id })),
    armors: armorEntriesOf(host.content),
    learnedExperience: everyJobExperience(host.content),
    // Skips decorative swarms (hitpoints 0) and species with no body in the render roster; first-wins
    // dedup matches the sim's `animalRecord` read, so a listed entry is the record a spawn consumes.
    animals: host.content.animals
      .filter(
        (a, i) =>
          a.hitpointsAdult > 0 &&
          ANIMAL_PALETTE_BY_TRIBE.has(a.tribeType) &&
          host.content.animals.findIndex((b) => b.tribeType === a.tribeType) === i,
      )
      .map((a) => ({
        tribe: a.tribeType,
        id: host.content.tribes.find((t) => t.typeId === a.tribeType)?.id ?? a.id,
      }))
      .sort((a, b) => a.tribe - b.tribe),
    // The content's own row order, which keeps the carts together ahead of the ships.
    vehicles: host.content.vehicles.map((v) => ({
      vehicleType: v.typeId,
      label: vehicleLabel(host.content, v.typeId) ?? v.id,
    })),
    needsEnabled: () => host.needsEnabled(),
    bioGroundWaived: () => bioGroundRuleWaived(host.snapshot()),
    fogMode: () => host.fogMode(),
    geometryEnabled: geometryDebug.enabled,
    setGeometryEnabled,
    zoomOutUnlocked: zoomOut.unlocked,
    setZoomOutUnlocked: zoomOut.setUnlocked,
    ...(opts.paintGood !== undefined ? { paintGood: opts.paintGood } : {}),
    aiSeats: () =>
      readAiSeats(host.snapshot(), host, (player) =>
        apprentices.read(`${player}`, () => host.computerApprentices(player), NO_INPUTS, PER_TICK),
      ),
  });
}

/** Every building type with a body to stand but a workshop's hidden vehicle site, in the language's
 *  alphabetical order. */
function standingBuildings(host: SessionHost): BuildingEntry[] {
  const lang = currentLocale();
  const labels = buildingLabelsFromContent(host.content, lang);
  const compare = compareLabels(bcp47Tag(lang));
  return host.content.buildings
    .filter((b) => b.kind !== BUILDING_KIND.vehicle && b.footprint !== undefined)
    .map((b) => ({ typeId: b.typeId, label: labels.get(b.typeId) ?? b.id }))
    .sort((a, b) => compare(a.label, b.label) || a.typeId - b.typeId);
}
