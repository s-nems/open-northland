import type { Camera } from '@open-northland/render';
import { halfCellToScreen } from '@open-northland/render';
import type {
  Entity,
  InfoLineView,
  MissionPresentationView,
  SimEvent,
  WorldSnapshot,
} from '@open-northland/sim';
import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { GameToolPanelHandle } from '../src/view/game-tool-panel.js';
import { createScriptPresentation } from '../src/view/runtime/script-presentation.js';
import type { ScriptEffects } from '../src/view/script-effects.js';
import type { ScriptMarkers } from '../src/view/script-markers.js';

/**
 * The join from a script's display events to the HUD: a cutscene opens the window on its page, a
 * camera result and a selection centre the view, the markers and effects get their events, and the
 * info lines reach the panel on the original's refresh cadence.
 */

const HERO = 3 as Entity;
const HERO_NODE = { hx: 11, hy: 10 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0, scale: 1 };
const SCREEN = { width: 800, height: 600 };

function snapshotAt(tick: number): WorldSnapshot {
  return {
    tick,
    events: [],
    entities: [{ id: HERO, components: { Position: { x: 5 * ONE, y: 5 * ONE } } }],
  } as unknown as WorldSnapshot;
}

function harness(
  lines: InfoLineView[] = [],
  saved: MissionPresentationView = { guiMarkers: [], groundMarkers: [], weather: [] },
  seat: () => number | null = () => 0,
) {
  const calls: string[] = [];
  const infoLines: (readonly string[])[] = [];
  let tick = 0;
  const sim = {
    get tick() {
      return tick;
    },
    snapshot: () => snapshotAt(tick),
    infoLines: (player: number) => lines.filter((line) => line.index === player),
    missionPresentation: () => saved,
    missionStatus: () => [],
  };
  const toolPanel = {
    controller: {
      openMission: (page?: number) => calls.push(`open:${page}`),
      setInfoLines: (next: readonly string[]) => infoLines.push(next),
    },
  } as unknown as GameToolPanelHandle;
  const markers: ScriptMarkers = {
    apply: (event) => calls.push(`marker:${event.kind}`),
    update: () => undefined,
    dispose: () => undefined,
  };
  const effects: ScriptEffects = {
    setWeather: (event) => calls.push(`weather:${event.weather}`),
    startEarthquake: (seconds) => calls.push(`quake:${seconds}`),
    jitter: () => null,
    update: () => undefined,
    dispose: () => undefined,
  };
  const presentation = createScriptPresentation({
    sim,
    seat,
    toolPanel,
    controls: { select: (ids) => calls.push(`select:${[...ids].join()}`) },
    centerOn: (x, y) => calls.push(`centre:${x},${y}`),
    screen: () => SCREEN,
    markers,
    effects,
    mapText: (id) => (id === 7 ? 'Held: %d of %d' : undefined),
    now: () => 0,
    exit: () => calls.push('exit'),
  });
  return {
    presentation,
    calls,
    infoLines,
    advance: (to: number) => {
      tick = to;
    },
  };
}

describe('createScriptPresentation', () => {
  it('hydrates persistent overlays before the first frame without replaying transient presentation', () => {
    const { calls, presentation } = harness([], {
      guiMarkers: [{ marker: 2, point: HERO_NODE }],
      groundMarkers: [
        { style: 'area', point: HERO_NODE },
        { style: 'magic', point: HERO_NODE },
        { style: 'import', point: HERO_NODE },
      ],
      weather: [
        { weather: 'rain', min: HERO_NODE, max: HERO_NODE, density: 100 },
        { weather: 'snow', min: HERO_NODE, max: HERO_NODE, density: 0 },
      ],
    });
    expect(calls).toEqual([
      'marker:missionGuiMarker',
      'marker:missionAreaMarkers',
      'marker:missionAreaMarkers',
      'marker:missionImportMarker',
      'weather:rain',
      'weather:snow',
    ]);
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(calls).toHaveLength(6);
  });

  it('routes each display event to its surface', () => {
    const { presentation, calls } = harness();
    const world = halfCellToScreen(HERO_NODE.hx, HERO_NODE.hy);
    const events: SimEvent[] = [
      { kind: 'missionCutscene', mission: 0, page: 500, replay: true },
      { kind: 'missionCamera', point: { hx: 4, hy: 2 } },
      { kind: 'missionSelectHuman', entity: HERO, select: true },
      { kind: 'missionSelectHuman', entity: HERO, select: false },
      { kind: 'missionGuiMarker', marker: 1, point: HERO_NODE, placed: true },
      { kind: 'missionWeather', weather: 'snow', min: HERO_NODE, max: HERO_NODE, density: 100 },
      { kind: 'missionEarthquake', seconds: 3 },
      { kind: 'missionUnsupported', mission: 2, opcode: 'SetVehicle' },
    ];
    presentation.onEvents(events);
    const at = halfCellToScreen(4, 2);
    expect(calls).toEqual([
      'open:500',
      `centre:${at.x},${at.y}`,
      `select:${HERO}`,
      `centre:${world.x},${world.y}`,
      `centre:${world.x},${world.y}`,
      'marker:missionGuiMarker',
      'weather:snow',
      'quake:3',
    ]);
  });

  it('pushes the formatted info lines every frame and re-reads their tallies every two seconds', () => {
    const lines: InfoLineView[] = [{ index: 0, stringId: 7, count: 1, extra: 4 }];
    const { presentation, infoLines, advance } = harness(lines);
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines).toEqual([['Held: 1 of 4']]);
    lines[0] = { index: 0, stringId: 7, count: 2, extra: 4 };
    advance(12);
    presentation.frame(snapshotAt(12), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual(['Held: 1 of 4']);
    advance(24);
    presentation.frame(snapshotAt(24), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual(['Held: 2 of 4']);
  });

  it('re-reads the lines at once when the watched seat changes, and shows none for no seat', () => {
    // The fixture files each seat's line under its own index.
    const lines: InfoLineView[] = [
      { index: 0, stringId: 7, count: 1, extra: 4 },
      { index: 1, stringId: 7, count: 3, extra: 4 },
    ];
    let seat: number | null = 0;
    const { presentation, infoLines } = harness(lines, undefined, () => seat);
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual(['Held: 1 of 4']);
    seat = 1;
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual(['Held: 3 of 4']);
    seat = null;
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([]);
  });
});

it('leaves the map on Exit and stops presenting the remaining frame events', () => {
  const { presentation, calls } = harness();
  presentation.onEvents([
    { kind: 'missionExit', mission: 0 },
    { kind: 'missionCutscene', mission: 1, page: 5, replay: false },
  ]);
  expect(calls).toEqual(['exit']);
});
