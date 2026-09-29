import { MapScript } from '@open-northland/data';
import type { GameSession, SessionSeat } from '@open-northland/lockstep';
import { components, type Entity, exportSaveGame, type MissionScript } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorldFromInputs } from '../src/entries/map/world-inputs.js';
import {
  seatedMissions,
  seatTribeRemap,
  sessionMapScript,
  sessionSeatTribes,
} from '../src/game/seat-tribes.js';
import type { AuthoredJoinRows } from '../src/game/world/index.js';
import { worldTribes } from '../src/game/world-tribes.js';
import { AUTHORED_ENTITIES, AUTHORED_ROWS } from './support/authored-entities.js';
import { authoredMapFile } from './support/world-maps.js';

/** A seat the lobby moved to another civilization takes its settlers, houses, roster row and script
 *  lines along; monsters, animals and other seats keep theirs. */

const VIKING = 1;
const FRANK = 2;
const SARACEN = 4;
const WERESNAKE = 5;
const WOLVES = 20;
const BARRACKS = 30;
const SHIP = 45;
/** Ticks run on each side of the save before the two worlds are compared. */
const RESTORE_TICKS = 40;

const roster = MapScript.parse({
  players: [
    { player: 0, type: 'human', tribeId: VIKING, colorId: 0 },
    { player: 1, type: 'ai', tribeId: WERESNAKE, colorId: 1 },
    { player: 2, type: 'human', tribeId: FRANK, colorId: 2 },
  ],
});

const seat = (player: number, tribe?: number): SessionSeat => ({
  player,
  mode: 'human',
  color: player,
  ...(tribe === undefined ? {} : { tribe }),
});

const rows: AuthoredJoinRows = {
  ...AUTHORED_ROWS,
  buildingBobs: [
    ...(AUTHORED_ROWS.buildingBobs ?? []),
    { editName: 'saracen barracks', level: 0, typeId: BARRACKS, tribeId: SARACEN },
    { editName: 'viking ship', level: 0, typeId: SHIP, tribeId: VIKING },
  ],
  tribes: [...(AUTHORED_ROWS.tribes ?? []), { typeId: SARACEN, id: 'saracen' }],
};

describe('sessionSeatTribes', () => {
  it('keeps only a civilization seat moved to another civilization', () => {
    const chosen = sessionSeatTribes(
      { seats: [seat(0, SARACEN), seat(1, VIKING), seat(2, FRANK), seat(3, SARACEN)] },
      roster.players,
    );
    // Seat 1 is a monster, seat 2 kept its own, seat 3 is off the roster.
    expect([...chosen]).toEqual([[0, SARACEN]]);
    expect(sessionSeatTribes({ seats: [seat(0, WERESNAKE)] }, roster.players).size).toBe(0);
  });
});

describe('seatTribeRemap', () => {
  const remap = seatTribeRemap(new Map([[0, SARACEN]]), rows);

  it("moves the seat's civilization things and leaves monsters, animals and other seats", () => {
    expect(remap.tribe(0, VIKING)).toBe(SARACEN);
    expect(remap.tribe(0, FRANK)).toBe(SARACEN);
    expect(remap.tribe(0, WERESNAKE)).toBe(WERESNAKE);
    expect(remap.tribe(0, WOLVES)).toBe(WOLVES);
    expect(remap.tribe(2, FRANK)).toBe(FRANK);
    expect(remap.tribe(undefined, VIKING)).toBe(VIKING);
  });

  it('keeps a building type the chosen civilization has no graphics for', () => {
    expect(remap.building(0, BARRACKS, VIKING)).toBe(SARACEN);
    expect(remap.building(0, SHIP, VIKING)).toBe(VIKING);
  });

  it("moves the seat's script lines, including a house the chosen civilization draws", () => {
    const script = {
      missions: [
        {
          successfullIf: 0,
          active: true,
          visible: false,
          goals: [],
          results: [
            { opcode: 'AllowJob', player: 0, tribe: VIKING, job: 7 },
            { opcode: 'AllowJob', player: 2, tribe: FRANK, job: 7 },
            { opcode: 'SetHouse', player: 0, houseName: { typeId: BARRACKS, tribe: VIKING } },
            { opcode: 'SetHouse', player: 0, houseName: { typeId: SHIP, tribe: VIKING } },
          ],
        },
      ],
    } as unknown as MissionScript;
    const results = seatedMissions(script, remap).missions[0]?.results as unknown as readonly Record<
      string,
      unknown
    >[];
    expect(results.map((op) => op.tribe ?? op.houseName)).toEqual([
      SARACEN,
      FRANK,
      { typeId: BARRACKS, tribe: SARACEN },
      { typeId: SHIP, tribe: VIKING },
    ]);
  });
});

describe('a session with a changed seat', () => {
  const session = (seats: readonly SessionSeat[]): GameSession => ({
    world: { kind: 'map', mapId: 'fixture' },
    seed: 7,
    seats,
    localSeat: 0,
    rules: { fog: null, progression: null, needs: null },
    speed: 1,
  });

  it('seats the roster and moves its permission rows', () => {
    const script = MapScript.parse({
      ...roster,
      permissions: [
        { player: 0, tribe: VIKING, kind: 'house', typeId: BARRACKS, allowed: false },
        { player: 2, tribe: FRANK, kind: 'house', typeId: BARRACKS, allowed: false },
      ],
    });
    const seated = sessionMapScript(session([seat(0, SARACEN), seat(2)]), script, rows);
    expect(seated.script?.players.map((p) => p.tribeId)).toEqual([SARACEN, WERESNAKE, FRANK]);
    expect(seated.script?.permissions?.map((row) => row.tribe)).toEqual([SARACEN, FRANK]);
  });

  it("raises the seat's scripted creatures as its chosen civilization", () => {
    const createCreatures = {
      kind: 'createCreatures',
      priority: 0,
      condition: 0,
      job: 7,
      x: 0,
      y: 0,
      missionId: 0,
      count: 1,
      once: true,
    };
    const script = MapScript.parse({
      ...roster,
      ai: [
        { player: 0, disabled: false, strategicOff: [], tasks: [{ ...createCreatures, tribe: VIKING }] },
        { player: 1, disabled: false, strategicOff: [], tasks: [{ ...createCreatures, tribe: WERESNAKE }] },
      ],
    });
    const seated = sessionMapScript(session([seat(0, SARACEN), seat(1, VIKING)]), script, rows);
    expect(
      seated.world.ai?.map((row) => row.tasks.map((task) => ('tribe' in task ? task.tribe : null))),
    ).toEqual([[SARACEN], [WERESNAKE]]);
  });

  it("builds the seat's authored settlers and houses as the chosen civilization, and restores them", () => {
    const { Building, Owner, Settler } = components;
    const inputs = {
      map: authoredMapFile(AUTHORED_ENTITIES),
      ir: rows as ContentIr,
      script: roster,
      goodNames: new Map<string, string>(),
      content: null,
      session: session([seat(0, SARACEN), seat(2)]),
      missions: null,
    };
    const { sim } = buildMapWorldFromInputs({ ...inputs, save: null });
    const seatZero = (entities: Iterable<Entity>) =>
      [...entities].filter((e) => sim.world.has(e, Owner) && sim.world.get(e, Owner).player === 0);
    expect(seatZero(sim.world.query(Building)).map((e) => sim.world.get(e, Building).tribe)).toEqual([
      SARACEN,
    ]);
    expect(seatZero(sim.world.query(Settler)).map((e) => sim.world.get(e, Settler).tribe)).toEqual([SARACEN]);

    sim.run(RESTORE_TICKS);
    const restored = buildMapWorldFromInputs({ ...inputs, save: exportSaveGame(sim) }).sim;
    sim.run(RESTORE_TICKS);
    restored.run(RESTORE_TICKS);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('loads the art of the tribes the seated world fields', () => {
    const map = authoredMapFile(AUTHORED_ENTITIES).entities;
    const seated = sessionMapScript(session([seat(0, SARACEN)]), roster, rows);
    // No viking settler or house is left, but the base tribe is always pinned.
    expect(worldTribes(seated.script, map, rows, seated.remap)).toEqual([VIKING, FRANK, SARACEN, WERESNAKE]);
  });
});
