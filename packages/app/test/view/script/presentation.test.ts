import type { Camera } from '@open-northland/render';
import { halfCellToScreen } from '@open-northland/render';
import type {
  Entity,
  InfoLineView,
  MatchGoalProgress,
  MissionPresentationView,
  SimEvent,
  WorldSnapshot,
} from '@open-northland/sim';
import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { MissionInfoRow } from '../../../src/game/map/info-lines.js';
import { messages } from '../../../src/i18n/index.js';
import type { GameToolPanelHandle } from '../../../src/view/game-tool-panel.js';
import type { ScriptEffects } from '../../../src/view/script/effects.js';
import type { ScriptMarkers } from '../../../src/view/script/markers.js';
import { createScriptPresentation } from '../../../src/view/script/presentation.js';
import type { WeatherFeed } from '../../../src/view/weather-feed.js';

/**
 * The join from a script's display events to the HUD: a cutscene opens the window on its page, a
 * camera result and a selection steer the view, the markers and effects get their events, and the
 * info lines reach the panel on the original's refresh cadence.
 */

const HERO = 3 as Entity;
const WOOD = 5;
const HERO_NODE = { hx: 11, hy: 10 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0, scale: 1 };
const SCREEN = { width: 800, height: 600 };
/** Past the longest camera glide, so a steered frame lands on its target. */
const GLIDED_MS = 10_000;

/** Let the host's answers land: each resolves a microtask after it was asked. */
const landed = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
  showBriefings = true,
  keepPlayingAfterResult = () => false,
  goalProgress: readonly MatchGoalProgress[] = [],
  mapText: (id: number) => string | undefined = (id) => (id === 7 ? 'Held: %d of %d' : undefined),
  mapTextVersion?: () => number,
) {
  const calls: string[] = [];
  const infoLines: (readonly MissionInfoRow[])[] = [];
  let tick = 0;
  let camera = { ...CAMERA };
  const host = {
    get tick() {
      return tick;
    },
    snapshot: () => snapshotAt(tick),
    infoLines: (player: number) => Promise.resolve(lines.filter((line) => line.index === player)),
    matchGoalProgress: () => Promise.resolve(goalProgress),
    missionPresentation: () => Promise.resolve(saved),
    missionStatus: () => [],
  };
  const toolPanel = {
    controller: {
      openMission: (page?: number) => calls.push(`open:${page}`),
      setInfoLines: (next: readonly MissionInfoRow[]) => infoLines.push(next),
    },
  } as unknown as GameToolPanelHandle;
  const markers: ScriptMarkers = {
    apply: (event) => calls.push(`marker:${event.kind}`),
    update: () => undefined,
    dispose: () => undefined,
  };
  const effects: ScriptEffects = {
    startEarthquake: (seconds) => calls.push(`quake:${seconds}`),
    jitter: () => null,
  };
  const weather: WeatherFeed = {
    write: (region) => calls.push(`weather:${region.weather}`),
    writeAll: (regions) => {
      for (const region of regions) calls.push(`weather:${region.weather}`);
    },
    frame: () => {},
  };
  const presentation = createScriptPresentation({
    host,
    seat,
    showBriefings,
    keepPlayingAfterResult,
    toolPanel,
    controls: { select: (ids) => calls.push(`select:${[...ids].join()}`) },
    camera: () => camera,
    centerOn: (x, y) => {
      calls.push(`centre:${x},${y}`);
      camera = { ...camera, offsetX: SCREEN.width / 2 - x, offsetY: SCREEN.height / 2 - y };
    },
    screen: () => SCREEN,
    markers,
    effects,
    weather,
    mapText,
    mapTextVersion,
    goodLabel: (typeId) => (typeId === WOOD ? 'Wood' : undefined),
    now: () => 0,
    exit: () => calls.push('exit'),
  });
  return {
    presentation,
    calls,
    infoLines,
    moveCamera: () => {
      camera = { ...camera, offsetX: camera.offsetX + 10 };
    },
    advance: (to: number) => {
      tick = to;
    },
  };
}

describe('createScriptPresentation', () => {
  it('hydrates persistent overlays once they land without replaying transient presentation', async () => {
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
    await landed();
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
    expect(calls).toEqual([
      'open:500',
      `select:${HERO}`,
      'marker:missionGuiMarker',
      'weather:snow',
      'quake:3',
    ]);
    // The camera moves on the frame, toward the last request: the human the script picked.
    presentation.steerCamera(snapshotAt(0), 1, GLIDED_MS);
    expect(calls.at(-1)).toBe(`centre:${world.x},${world.y}`);
  });

  it('pushes the formatted info lines every frame and re-reads their tallies every two seconds', async () => {
    const lines: InfoLineView[] = [{ index: 0, stringId: 7, count: 1, extra: 4 }];
    const { presentation, infoLines, advance } = harness(lines);
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines).toEqual([[]]);
    await landed();
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Held: 1 of 4' }]);
    lines[0] = { index: 0, stringId: 7, count: 2, extra: 4 };
    advance(12);
    presentation.frame(snapshotAt(12), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(12), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Held: 1 of 4' }]);
    advance(24);
    presentation.frame(snapshotAt(24), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(24), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Held: 2 of 4' }]);
  });

  it('re-reads the info lines when the map-text version moves, without waiting for the tick', async () => {
    const lines: InfoLineView[] = [{ index: 0, stringId: 7, count: 1, extra: 4 }];
    const texts: Record<number, string> = { 7: 'Held: %d of %d' };
    let version = 0;
    const { presentation, infoLines } = harness(
      lines,
      undefined,
      undefined,
      true,
      undefined,
      [],
      (id) => texts[id],
      () => version,
    );
    presentation.frame(snapshotAt(0), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Held: 1 of 4' }]);
    texts[7] = 'Helden: %d von %d';
    version = 1;
    presentation.frame(snapshotAt(0), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Helden: 1 von 4' }]);
  });

  it('appends the goal table rows after the map lines', async () => {
    const lines: InfoLineView[] = [{ index: 0, stringId: 7, count: 1, extra: 4 }];
    const progress: MatchGoalProgress[] = [
      { kind: 'goods', good: WOOD, have: 12, need: 50 },
      { kind: 'inhabitants', soldiers: true, have: 3, need: 10 },
    ];
    const { presentation, infoLines } = harness(lines, undefined, undefined, true, undefined, progress);
    presentation.frame(snapshotAt(0), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(0), CAMERA, 0);
    const hud = messages().hud;
    expect(infoLines.at(-1)).toEqual([
      { kind: 'text', text: 'Held: 1 of 4' },
      { kind: 'progress', label: 'Wood', have: 12, need: 50 },
      { kind: 'progress', label: hud.matchGoalSoldiers, have: 3, need: 10 },
    ]);
  });

  it('re-reads the lines at once when the watched seat changes, and shows none for no seat', async () => {
    // The fixture files each seat's line under its own index.
    const lines: InfoLineView[] = [
      { index: 0, stringId: 7, count: 1, extra: 4 },
      { index: 1, stringId: 7, count: 3, extra: 4 },
    ];
    let seat: number | null = 0;
    const { presentation, infoLines } = harness(lines, undefined, () => seat);
    presentation.frame(snapshotAt(0), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Held: 1 of 4' }]);
    seat = 1;
    presentation.frame(snapshotAt(0), CAMERA, 0);
    await landed();
    presentation.frame(snapshotAt(0), CAMERA, 0);
    expect(infoLines.at(-1)).toEqual([{ kind: 'text', text: 'Held: 3 of 4' }]);
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

it('can suppress automatic briefings while applying other script presentation', () => {
  const { calls, presentation } = harness([], undefined, undefined, false);
  presentation.onEvents([
    { kind: 'missionCutscene', mission: 0, page: 500, replay: true },
    { kind: 'missionEarthquake', seconds: 2 },
    { kind: 'missionCutscene', mission: 1, page: 501, replay: true },
  ]);
  expect(calls).toEqual(['quake:2']);
  presentation.dispose();
});

it('follows a moving human until the player moves the view', () => {
  const { presentation, calls, moveCamera } = harness();
  presentation.onEvents([{ kind: 'missionSelectHuman', entity: HERO, select: false }]);
  const moved = snapshotAt(1);
  const entity = moved.entities[0];
  if (entity === undefined) throw new Error('missing fixture human');
  const snapshot = {
    ...moved,
    entities: [{ ...entity, components: { Position: { x: 6 * ONE, y: 5 * ONE } } }],
  } as unknown as WorldSnapshot;
  presentation.steerCamera(snapshot, 1, GLIDED_MS);
  expect(calls.at(-1)).toBe(`centre:${halfCellToScreen(13, 10).x},${halfCellToScreen(13, 10).y}`);
  const count = calls.length;
  moveCamera();
  presentation.steerCamera(snapshot, 1, GLIDED_MS);
  presentation.steerCamera(snapshotAt(2), 1, GLIDED_MS);
  expect(calls).toHaveLength(count);
});

it('ends following when the human disappears or a script moves the camera', () => {
  const { presentation, calls } = harness();
  presentation.onEvents([{ kind: 'missionSelectHuman', entity: HERO, select: true }]);
  presentation.steerCamera({ ...snapshotAt(1), entities: [] }, 1, GLIDED_MS);
  presentation.steerCamera(snapshotAt(2), 1, GLIDED_MS);
  expect(calls).toEqual([`select:${HERO}`]);
  presentation.onEvents([
    { kind: 'missionSelectHuman', entity: HERO, select: false },
    { kind: 'missionCamera', point: { hx: 4, hy: 2 } },
  ]);
  presentation.steerCamera(snapshotAt(3), 1, GLIDED_MS);
  presentation.steerCamera(snapshotAt(4), 1, GLIDED_MS);
  const at = halfCellToScreen(4, 2);
  expect(calls).toEqual([`select:${HERO}`, `centre:${at.x},${at.y}`]);
});

it('keeps a camera move when the same frame selects a missing human', () => {
  const { presentation, calls } = harness();
  presentation.onEvents([
    { kind: 'missionCamera', point: { hx: 4, hy: 2 } },
    { kind: 'missionSelectHuman', entity: 99 as Entity, select: false },
  ]);
  presentation.steerCamera(snapshotAt(1), 1, GLIDED_MS);
  const at = halfCellToScreen(4, 2);
  expect(calls).toEqual([`centre:${at.x},${at.y}`]);
});

it('keeps following a human aboard a moving vehicle and after disembarking', () => {
  const { presentation, calls } = harness();
  presentation.onEvents([{ kind: 'missionSelectHuman', entity: HERO, select: false }]);
  const aboard = {
    ...snapshotAt(1),
    entities: [
      { id: HERO, components: { Rider: { vehicle: 4 } } },
      { id: 4, components: { Position: { x: 6 * ONE, y: 5 * ONE } } },
    ],
  } as unknown as WorldSnapshot;
  presentation.steerCamera(aboard, 1, GLIDED_MS);
  expect(calls.at(-1)).toBe(`centre:${halfCellToScreen(13, 10).x},${halfCellToScreen(13, 10).y}`);
  presentation.steerCamera(snapshotAt(2), 1, GLIDED_MS);
  expect(calls.at(-1)).toBe(`centre:${halfCellToScreen(11, 10).x},${halfCellToScreen(11, 10).y}`);
});

it('keeps a decided local map running when its script asks to exit after the result', () => {
  const { presentation, calls } = harness([], undefined, undefined, true, () => true);
  presentation.onEvents([
    { kind: 'missionExit', mission: 0 },
    { kind: 'missionEarthquake', seconds: 2 },
  ]);
  expect(calls).toEqual(['quake:2']);
});
