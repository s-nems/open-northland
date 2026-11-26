import type { Camera, ElevationField } from '@open-northland/render';
import { halfCellToScreen } from '@open-northland/render';
import type { HalfCellNode, MissionPresentationView, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { goalProgressRows, infoLineRows, type MissionInfoRow } from '../../game/map/info-lines.js';
import { messages } from '../../i18n/index.js';
import { createLastAnswerCache, type SessionHost } from '../../session/index.js';
import type { GameToolPanelHandle } from '../game-tool-panel.js';
import { entityAnchor } from '../projections/entity-anchor.js';
import type { UnitControls } from '../unit-controls/index.js';
import type { WeatherFeed } from '../weather-feed.js';
import { createScriptCamera } from './camera.js';
import type { CameraJitter, ScriptEffects } from './effects.js';
import type { ScriptMarkers } from './markers.js';
import { mountMissionTrace } from './mission-trace.js';

const DIAG_CHANNEL = 'missions';
/** The info lines' tallies are re-read this often: the original rebuilds its lines at most every two
 *  seconds (reading). */
const INFO_LINE_REFRESH_SECONDS = 2;
const INFO_LINE_REFRESH_TICKS = INFO_LINE_REFRESH_SECONDS * TICKS_PER_SECOND;
const NO_LINES: readonly MissionInfoRow[] = [];

export interface ScriptPresentationDeps {
  readonly host: Pick<
    SessionHost,
    'tick' | 'snapshot' | 'infoLines' | 'matchGoalProgress' | 'missionPresentation' | 'missionStatus'
  >;
  readonly missionTrace?: boolean;
  /** False suppresses automatic briefing windows; the host still records their chapters. */
  readonly showBriefings?: boolean;
  /** Whose info lines the panel shows, read on every refresh; null shows none. */
  readonly seat: () => number | null;
  readonly toolPanel: GameToolPanelHandle;
  readonly controls: Pick<UnitControls, 'select'>;
  /** Re-centre the view on a world-px point at the current zoom. */
  readonly centerOn: (worldX: number, worldY: number) => void;
  readonly camera: () => Camera;
  readonly screen: () => { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly markers: ScriptMarkers;
  readonly effects: ScriptEffects;
  readonly weather: WeatherFeed;
  /** The map's own string by id, for the info lines. */
  readonly mapText: (stringId: number) => string | undefined;
  /** Bumped when the info-line texts change outside the sim, as a landed translation does; the lines
   *  re-read then, without waiting for the tick. */
  readonly mapTextVersion?: () => number;
  /** A good's display name, for the goal table's progress lines. */
  readonly goodLabel: (typeId: number) => string | undefined;
  /** The info lines at `tick` with what the map's siege leads them with; absent, they pass as read. */
  readonly siegeRows?: (rows: readonly MissionInfoRow[], tick: number) => readonly MissionInfoRow[];
  readonly now: () => number;
  /** A local verdict offers continued play, so a later script Exit must not leave the map. */
  readonly keepPlayingAfterResult?: () => boolean;
  readonly exit: () => void;
}

export interface ScriptPresentation {
  /** The frame's sim events, unfiltered: a camera move to unexplored ground must still happen. */
  onEvents(events: readonly SimEvent[]): void;
  /** Glide toward a script's or briefing's camera target before reading the camera for drawing;
   *  `alpha` is the frame's place between two ticks. */
  steerCamera(snapshot: WorldSnapshot, alpha: number, nowMs: number): void;
  /** Glide the view to a world-px point, as a script camera result does. */
  glideTo(worldX: number, worldY: number): void;
  /** The quake's camera offset for this frame, or null while the ground is still. */
  jitter(nowMs: number): CameraJitter | null;
  /** Per-frame, after the sim stepped: the info lines and the overlays under the camera. */
  frame(snapshot: WorldSnapshot, camera: Camera, nowMs: number): void;
  dispose(): void;
}

/**
 * Where a map script's display results land: the mission window for a cutscene, the camera and the
 * selection for a camera or select result, the marker and effect overlays, the info lines, and the
 * diagnostics log for what the script asked for and did not get.
 */
export function createScriptPresentation(deps: ScriptPresentationDeps): ScriptPresentation {
  const { host, toolPanel, controls, markers, effects, weather } = deps;
  const trace = deps.missionTrace === true ? mountMissionTrace(host) : null;
  let linesTick = Number.NEGATIVE_INFINITY;
  let linesSeat: number | null = null;
  const lineAnswers = createLastAnswerCache<readonly MissionInfoRow[]>({ tick: () => host.tick });
  let disposed = false;
  const scriptCamera = createScriptCamera(deps);

  const restore = (saved: MissionPresentationView): void => {
    for (const marker of saved.guiMarkers) {
      markers.apply({ kind: 'missionGuiMarker', ...marker, placed: true });
    }
    for (const marker of saved.groundMarkers) {
      markers.apply(
        marker.style === 'import'
          ? { kind: 'missionImportMarker', point: marker.point, placed: true }
          : {
              kind: 'missionAreaMarkers',
              points: [marker.point],
              magic: marker.style === 'magic',
              placed: true,
            },
      );
    }
    weather.writeAll(saved.weather);
  };
  void host.missionPresentation().then((saved) => {
    if (!disposed) restore(saved);
  });

  const glideToNode = (point: HalfCellNode): void => {
    const world = halfCellToScreen(point.hx, point.hy);
    const lift = deps.elevation?.liftAtNode(point.hx, point.hy) ?? 0;
    scriptCamera.glideTo(world.x, world.y - lift, deps.now());
  };

  return {
    onEvents(events) {
      for (const event of events) {
        switch (event.kind) {
          case 'missionCutscene':
            if (deps.showBriefings !== false) toolPanel.controller.openMission(event.page);
            break;
          case 'missionCamera':
            glideToNode(event.point);
            break;
          case 'missionSelectHuman': {
            if (event.select) controls.select([event.entity]);
            const human = event.entity;
            const anchor = entityAnchor(host.snapshot(), human, deps.elevation);
            if (anchor === null) scriptCamera.unfollow();
            else
              scriptCamera.follow(
                (snapshot) => entityAnchor(snapshot, human, deps.elevation),
                anchor,
                deps.now(),
              );
            break;
          }
          case 'missionGuiMarker':
          case 'missionAreaMarkers':
          case 'missionImportMarker':
            markers.apply(event);
            break;
          case 'missionWeather':
            weather.write(event);
            break;
          case 'missionEarthquake':
            effects.startEarthquake(event.seconds, deps.now());
            break;
          case 'missionUnsupported':
            diag.warn(
              DIAG_CHANNEL,
              `mission ${event.mission} asked for ${event.opcode}, which this build cannot run`,
            );
            break;
          case 'missionResultFailed':
            diag.warn(DIAG_CHANNEL, `mission ${event.mission}: ${event.opcode} could not act on the world`);
            break;
          case 'missionSeatTribeCorrected':
            diag.warn(
              DIAG_CHANNEL,
              `mission ${event.mission}: ${event.opcode} moved ${event.count} handed things of the seat's authored people to its chosen people`,
            );
            break;
          case 'missionExit':
            if (deps.keepPlayingAfterResult?.() === true) break;
            deps.exit();
            return;
          default:
            break;
        }
      }
    },
    steerCamera: (snapshot, alpha, nowMs) => scriptCamera.frame(snapshot, alpha, nowMs),
    glideTo: (worldX, worldY) => scriptCamera.glideTo(worldX, worldY, deps.now()),
    jitter: (nowMs) => effects.jitter(nowMs),
    frame(snapshot, camera, nowMs) {
      weather.frame(snapshot.tick / TICKS_PER_SECOND);
      trace?.refresh(snapshot.tick);
      // A seat switch re-reads at once: the cadence paces one seat's lines, not a change of seat.
      const seat = deps.seat();
      if (seat !== linesSeat || snapshot.tick - linesTick >= INFO_LINE_REFRESH_TICKS) {
        linesTick = snapshot.tick;
        linesSeat = seat;
      }
      const lines =
        seat === null
          ? NO_LINES
          : (lineAnswers.read(
              `${seat}`,
              () =>
                Promise.all([host.infoLines(seat), host.matchGoalProgress(seat)]).then(
                  ([views, progress]) => [
                    ...infoLineRows(views, deps.mapText),
                    ...goalProgressRows(progress, {
                      good: deps.goodLabel,
                      inhabitants: messages().hud.matchGoalInhabitants,
                      soldiers: messages().hud.matchGoalSoldiers,
                    }),
                  ],
                ),
              `${linesTick}:${deps.mapTextVersion?.() ?? 0}`,
            ) ?? NO_LINES);
      // Pushed every frame; the book keeps an unchanged list as it is.
      toolPanel.controller.setInfoLines(deps.siegeRows?.(lines, snapshot.tick) ?? lines);
      const screen = deps.screen();
      markers.update(camera, screen, nowMs);
    },
    dispose() {
      disposed = true;
      lineAnswers.dispose();
      trace?.dispose();
      markers.dispose();
    },
  };
}
