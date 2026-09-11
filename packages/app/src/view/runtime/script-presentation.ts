import type { Camera, ElevationField } from '@open-northland/render';
import { halfCellToScreen } from '@open-northland/render';
import type { Entity, HalfCellNode, SimEvent, Simulation, WorldSnapshot } from '@open-northland/sim';
import { entityById, nodeOfPosition } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { infoLineTexts } from '../../game/info-lines.js';
import { positionOf } from '../../game/snapshot-base.js';
import type { GameToolPanelHandle } from '../game-tool-panel.js';
import type { CameraJitter, ScriptEffects } from '../script-effects.js';
import type { ScriptMarkers } from '../script-markers.js';
import type { UnitControls } from '../unit-controls/index.js';
import { mountMissionTrace } from './mission-trace.js';

/**
 * Where a map script's display results land: the mission window for a cutscene, the camera and the
 * selection for a camera or select result, the marker and effect overlays, the info lines, and the
 * diagnostics log for what the script asked for and did not get.
 */

const DIAG_CHANNEL = 'missions';
/** The info lines' tallies are re-read this often: the original rebuilds its lines at most every two
 *  seconds (reading), which is 24 ticks at 12 a second. */
const INFO_LINE_REFRESH_TICKS = 24;

export interface ScriptPresentationDeps {
  readonly sim: Pick<Simulation, 'snapshot' | 'infoLines' | 'missionPresentation' | 'missionStatus'>;
  readonly missionTrace?: boolean;
  readonly localPlayer: number;
  readonly toolPanel: GameToolPanelHandle;
  readonly controls: Pick<UnitControls, 'select'>;
  /** Re-centre the view on a world-px point at the current zoom. */
  readonly centerOn: (worldX: number, worldY: number) => void;
  readonly screen: () => { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly markers: ScriptMarkers;
  readonly effects: ScriptEffects;
  /** The map's own string by id, for the info lines. */
  readonly mapText: (stringId: number) => string | undefined;
  readonly now: () => number;
  readonly exit: () => void;
}

export interface ScriptPresentation {
  /** The frame's sim events, unfiltered: a camera move to unexplored ground must still happen. */
  onEvents(events: readonly SimEvent[]): void;
  /** The quake's camera offset for this frame, or null while the ground is still. */
  jitter(nowMs: number): CameraJitter | null;
  /** Per-frame, after the sim stepped: the info lines and the overlays under the camera. */
  frame(snapshot: WorldSnapshot, camera: Camera, nowMs: number): void;
  dispose(): void;
}

export function createScriptPresentation(deps: ScriptPresentationDeps): ScriptPresentation {
  const { sim, toolPanel, controls, markers, effects } = deps;
  const trace = deps.missionTrace === true ? mountMissionTrace(sim) : null;
  let linesTick = Number.NEGATIVE_INFINITY;
  let lines: string[] = [];

  const saved = sim.missionPresentation();
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
  for (const region of saved.weather) effects.setWeather({ kind: 'missionWeather', ...region });

  const centreOn = (point: HalfCellNode): void => {
    const world = halfCellToScreen(point.hx, point.hy);
    const lift = deps.elevation?.liftAtNode(point.hx, point.hy) ?? 0;
    deps.centerOn(world.x, world.y - lift);
  };

  const entityNode = (entity: Entity): HalfCellNode | null => {
    const ent = entityById(sim.snapshot(), entity);
    const at = ent === undefined ? undefined : positionOf(ent);
    return at === undefined ? null : nodeOfPosition(at.x, at.y);
  };

  return {
    onEvents(events) {
      for (const event of events) {
        switch (event.kind) {
          case 'missionCutscene':
            toolPanel.controller.openMission(event.page);
            break;
          case 'missionCamera':
            centreOn(event.point);
            break;
          case 'missionSelectHuman': {
            if (event.select) controls.select([event.entity]);
            // Approximation: the original follows the human from then on; this view centres once.
            const node = entityNode(event.entity);
            if (node !== null) centreOn(node);
            break;
          }
          case 'missionGuiMarker':
          case 'missionAreaMarkers':
          case 'missionImportMarker':
            markers.apply(event);
            break;
          case 'missionWeather':
            effects.setWeather(event);
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
          case 'missionExit':
            deps.exit();
            return;
          default:
            break;
        }
      }
    },
    jitter: (nowMs) => effects.jitter(nowMs),
    frame(snapshot, camera, nowMs) {
      trace?.refresh(snapshot.tick);
      if (snapshot.tick - linesTick >= INFO_LINE_REFRESH_TICKS) {
        linesTick = snapshot.tick;
        lines = infoLineTexts(sim.infoLines(deps.localPlayer), deps.mapText);
      }
      // Pushed every frame: the panel remounts on a scale change and starts blank.
      toolPanel.controller.setInfoLines(lines);
      const screen = deps.screen();
      markers.update(camera, screen, nowMs);
      effects.update(camera, screen);
    },
    dispose() {
      trace?.dispose();
      markers.dispose();
      effects.dispose();
    },
  };
}
