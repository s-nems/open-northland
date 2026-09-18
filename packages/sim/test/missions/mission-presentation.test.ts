import { describe, expect, it } from 'vitest';
import {
  infoLinesOf,
  missionBriefingPage,
  missionRecords,
  ScriptedName,
} from '../../src/components/index.js';
import type { SimEvent } from '../../src/core/events.js';
import type { Simulation } from '../../src/index.js';
import { hexDistance } from '../../src/nav/halfcell.js';
import type { MissionDefinition, MissionResultOp } from '../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import {
  firingSim,
  LOAD_PASS,
  missionSim,
  PASS_TICKS,
  POINT,
  roundTrip,
  SOLDIER,
  spawn,
  stamped,
  WOODCUTTER,
} from './support.js';

/**
 * The results that reach the player through the display: each fires its event, the two that outlive
 * the frame (the replayable briefing page, a human's name) write sim state, and the info lines keep
 * what to tally so the display can read it live.
 */

const OWNER = 0;
const HUMAN = 7;
const PAGE = 500;
const STRING = 21;
const MARKER = 3;
const LINE = 2;
const FAR = { hx: 40, hy: 40 };

function eventsAtLoadPass(results: readonly MissionResultOp[]): SimEvent[] {
  const sim = firingSim(results);
  sim.run(LOAD_PASS);
  return [...sim.events.current()];
}

function mission(definition: Partial<MissionDefinition>): MissionDefinition {
  return {
    successfullIf: SUCCESSFUL_IF.all,
    active: true,
    visible: false,
    goals: [],
    results: [],
    ...definition,
  };
}

describe('PlayCutscene', () => {
  it('opens the page, records it as the replayable briefing, and ends the pass', () => {
    const sim = missionSim([
      mission({ results: [{ opcode: 'PlayCutscene', cutscene: PAGE, replay: true }] }),
      mission({ results: [{ opcode: 'Exit' }] }),
    ]);
    sim.run(LOAD_PASS);
    expect(sim.events.current()).toEqual([{ kind: 'missionCutscene', mission: 0, page: PAGE, replay: true }]);
    expect(sim.missionBriefingPage()).toBe(PAGE);
    // The second mission waited for the next pass, which is when its own result fires.
    expect(missionRecords(sim.world)[1]?.active).toBe(true);
    sim.run(PASS_TICKS - LOAD_PASS);
    expect(sim.events.current()).toEqual([{ kind: 'missionExit', mission: 1 }]);
  });

  it('leaves the replayable page alone without the flag, and survives a save', () => {
    const sim = missionSim([
      mission({ results: [{ opcode: 'PlayCutscene', cutscene: PAGE, replay: true }] }),
      mission({ results: [{ opcode: 'PlayCutscene', cutscene: PAGE + 1, replay: false }] }),
    ]);
    // The first cutscene ends the load pass; the second page comes with the next pass.
    sim.run(PASS_TICKS);
    expect(missionBriefingPage(sim.world)).toBe(PAGE);
    expect(roundTrip(sim).missionBriefingPage()).toBe(PAGE);
    expect(sim.missionBriefingHistory()).toEqual([PAGE, PAGE + 1]);
    expect(roundTrip(sim).missionBriefingHistory()).toEqual([PAGE, PAGE + 1]);
    const detached = sim.missionBriefingHistory() as number[];
    detached.length = 0;
    expect(sim.missionBriefingHistory()).toEqual([PAGE, PAGE + 1]);
  });
});

describe('the one-shot display results', () => {
  it("fire their events with the line's point", () => {
    expect(
      eventsAtLoadPass([
        { opcode: 'PlaySound', sound: 56, point: POINT },
        { opcode: 'SetCameraPosition', point: FAR },
        { opcode: 'StartEarthQuake', seconds: 3 },
        { opcode: 'SetImportLandscapeMarker', point: POINT, flag: true },
      ]),
    ).toEqual([
      { kind: 'missionSound', soundType: 56, at: POINT },
      { kind: 'missionCamera', point: FAR },
      { kind: 'missionEarthquake', seconds: 3 },
      { kind: 'missionImportMarker', point: POINT, placed: true },
    ]);
  });

  it('places a GUI marker on a point and clears it with the origin; a slot past the ten is refused', () => {
    expect(
      eventsAtLoadPass([
        { opcode: 'SetGuiMarker', objectId: MARKER, point: POINT },
        { opcode: 'SetGuiMarker', objectId: MARKER, point: { hx: 0, hy: 0 } },
        { opcode: 'SetGuiMarker', objectId: 10, point: POINT },
      ]),
    ).toEqual([
      { kind: 'missionGuiMarker', marker: MARKER, point: POINT, placed: true },
      { kind: 'missionGuiMarker', marker: MARKER, point: { hx: 0, hy: 0 }, placed: false },
      { kind: 'missionResultFailed', mission: 0, opcode: 'SetGuiMarker' },
    ]);
  });

  it('scales the weather density and names the kind after the flag', () => {
    expect(
      eventsAtLoadPass([
        { opcode: 'SetWeather', point: POINT, range: 5, flag: false, amount: 15 },
        { opcode: 'SetWeather', point: POINT, range: 5, flag: true, amount: 200 },
      ]),
    ).toEqual([
      {
        kind: 'missionWeather',
        weather: 'rain',
        min: { hx: POINT.hx - 5, hy: POINT.hy - 5 },
        max: { hx: POINT.hx + 5, hy: POINT.hy + 5 },
        density: 1500,
      },
      {
        kind: 'missionWeather',
        weather: 'snow',
        min: { hx: POINT.hx - 5, hy: POINT.hy - 5 },
        max: { hx: POINT.hx + 5, hy: POINT.hy + 5 },
        density: 10000,
      },
    ]);
  });

  it('walks the hexagon ring for the area markers, every nth step', () => {
    const odd = { hx: 21, hy: 21 };
    const [ring, sparse, oddRing] = eventsAtLoadPass([
      { opcode: 'SetMapAreaMarker', point: POINT, range: 2, flag: true, index: 1 },
      { opcode: 'SetMapAreaMarkerMagic', point: POINT, range: 2, flag: false, index: 4 },
      { opcode: 'SetMapAreaMarker', point: odd, range: 3, flag: true, index: 1 },
    ]);
    expect(ring?.kind).toBe('missionAreaMarkers');
    if (
      ring?.kind !== 'missionAreaMarkers' ||
      sparse?.kind !== 'missionAreaMarkers' ||
      oddRing?.kind !== 'missionAreaMarkers'
    )
      return;
    expect(ring.magic).toBe(false);
    expect(ring.placed).toBe(true);
    // Twelve distinct points, every one exactly the range away under the goals' own metric.
    expect(ring.points).toHaveLength(12);
    expect(new Set(ring.points.map((p) => `${p.hx},${p.hy}`)).size).toBe(12);
    expect(ring.points.every((p) => hexDistance(p, POINT) === 2)).toBe(true);
    expect(oddRing.points).toHaveLength(18);
    expect(oddRing.points.every((p) => hexDistance(p, odd) === 3)).toBe(true);
    // The walk starts `range` steps north-west of the point and turns east first.
    expect(ring.points.slice(0, 3)).toEqual([
      { hx: 19, hy: 18 },
      { hx: 20, hy: 18 },
      { hx: 21, hy: 18 },
    ]);
    expect(sparse.magic).toBe(true);
    expect(sparse.placed).toBe(false);
    // The step count restarts on every side, so a spacing beyond the side keeps the six corners.
    expect(sparse.points).toHaveLength(6);
    expect(sparse.points[0]).toEqual({ hx: 19, hy: 18 });
  });
});

describe('SelectHuman and SetHumanName', () => {
  function withHuman(results: readonly MissionResultOp[]): Simulation {
    const sim = firingSim(results);
    spawn(sim, { player: OWNER, missionId: HUMAN });
    spawn(sim, { player: OWNER, missionId: HUMAN, at: FAR });
    return sim;
  }

  it('select the first human carrying the id, and report an id nobody carries', () => {
    const sim = withHuman([
      { opcode: 'SelectHuman', humanId: HUMAN, flag: false },
      { opcode: 'SelectHuman', humanId: HUMAN + 1, flag: true },
    ]);
    sim.run(LOAD_PASS);
    const humans = sim.events.current().filter((e) => e.kind === 'missionSelectHuman');
    expect(humans).toEqual([{ kind: 'missionSelectHuman', entity: expect.any(Number), select: true }]);
    expect(sim.events.current()).toContainEqual({
      kind: 'missionResultFailed',
      mission: 0,
      opcode: 'SelectHuman',
    });
  });

  it('name the first human carrying the id, once, and keep the name through a save', () => {
    const sim = withHuman([{ opcode: 'SetHumanName', humanId: HUMAN, stringId: STRING }]);
    sim.run(LOAD_PASS);
    const [only, ...rest] = [...sim.world.query(ScriptedName)];
    expect(rest).toHaveLength(0);
    if (only === undefined) throw new Error('nobody was named');
    expect(sim.world.get(only, ScriptedName)).toEqual({ stringId: STRING });
    expect([...roundTrip(sim).world.query(ScriptedName)]).toHaveLength(1);
  });

  it('a spawn carrying a name stamps it at birth', () => {
    const sim = missionSim([]);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      tribe: 1,
      x: POINT.hx,
      y: POINT.hy,
      owner: OWNER,
      missionId: HUMAN,
      nameStringId: STRING,
    });
    sim.step();
    expect(sim.world.get(stamped(sim, HUMAN), ScriptedName)).toEqual({ stringId: STRING });
  });
});

describe('the info lines', () => {
  it('set a plain string on one line, clear it, and refuse a line past the five', () => {
    const sim = firingSim([
      { opcode: 'InfoShowString', player: OWNER, index: LINE, stringId: STRING },
      { opcode: 'InfoShowString', player: OWNER, index: 0, stringId: STRING + 1 },
      { opcode: 'InfoClear', player: OWNER, index: 0 },
      { opcode: 'InfoShowString', player: OWNER, index: 5, stringId: STRING },
    ]);
    sim.run(LOAD_PASS);
    expect(sim.infoLines(OWNER)).toEqual([{ index: LINE, stringId: STRING, count: 0, extra: 0 }]);
    expect(sim.infoLines(OWNER + 1)).toEqual([]);
    expect(sim.events.current()).toContainEqual({
      kind: 'missionResultFailed',
      mission: 0,
      opcode: 'InfoShowString',
    });
  });

  it('a broadcast writes every player, and the tally follows the humans in range', () => {
    const sim = firingSim([
      {
        opcode: 'InfoCountHumenInArea',
        player: 20,
        index: LINE,
        stringId: STRING,
        point: POINT,
        range: 3,
        extra: 4,
      },
    ]);
    // Soldiers, which stand where they spawn; a woodcutter wanders off to find work.
    spawn(sim, { player: OWNER, at: POINT, job: SOLDIER });
    spawn(sim, { player: OWNER, at: { hx: POINT.hx + 2, hy: POINT.hy }, job: SOLDIER });
    spawn(sim, { player: OWNER, at: FAR, job: SOLDIER });
    spawn(sim, { player: OWNER + 1, at: POINT, job: SOLDIER });
    sim.run(LOAD_PASS);
    expect(infoLinesOf(sim.world, 5)).toHaveLength(1);
    expect(sim.infoLines(OWNER)).toEqual([{ index: LINE, stringId: STRING, count: 2, extra: 4 }]);
    expect(sim.infoLines(OWNER + 1)).toEqual([{ index: LINE, stringId: STRING, count: 1, extra: 4 }]);
    expect(roundTrip(sim).infoLines(OWNER)).toEqual([{ index: LINE, stringId: STRING, count: 2, extra: 4 }]);
  });
});

describe('the mission status probe', () => {
  it('lists every mission with its description id and live flags', () => {
    const sim = missionSim([
      mission({
        description: STRING,
        visible: true,
        results: [{ opcode: 'ActivateMission', missionIndex: 1 }],
      }),
      mission({
        active: false,
        visible: true,
        description: STRING + 1,
        goals: [{ opcode: 'TimeGone', seconds: 3600 }],
      }),
      mission({ visible: false }),
    ]);
    expect(sim.missionStatus().map((m) => [m.index, m.description, m.visible, m.active, m.done])).toEqual([
      [0, STRING, true, true, false],
      [1, STRING + 1, true, false, false],
      [2, undefined, false, true, false],
    ]);
    sim.run(LOAD_PASS);
    expect(sim.missionStatus().map((m) => [m.active, m.done])).toEqual([
      [false, true],
      [true, false],
      [false, true],
    ]);
  });
});
