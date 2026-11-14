import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Settler, seatPassenger } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { Simulation, type TerrainMap } from '../../../../../src/index.js';
import { hexDistanceBetween } from '../../../../../src/nav/halfcell.js';
import {
  ALARM_MARGIN_NODES,
  ALARM_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from '../../../../../src/systems/ai-shared/military/defence/index.js';
import { planSettlementDefence } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import { WEAPON_MAIN_TYPE } from '../../../../../src/systems/readviews/index.js';
import { entityNode } from '../../../../../src/systems/spatial/nodes.js';
import { boardRider, createVehicle } from '../../../../../src/systems/vehicles/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { distanceFromWalls } from '../../../../fixtures/walls.js';

// The alarm rings one map point past the house bow's reach for a raider ashore and a crewed catapult alike,
// and takes cover from an enemy warship with a bowman on its deck as from a bowman ashore.

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const SPEARMAN = 32;
const BOWMAN = 40;
const CATAPULT_JOB = 54;
const WARSHIP = 3;
const CATAPULT = 5;
const GRASS = 0;
const WATER = 1;
const MAP_W = 128;
const MAP_H = 96;
/** Room to the west for a raider or catapult past the watch band; the sea lies to the east. */
const HQ = { x: 72, y: 20 };
/** The sea starts this many nodes east of the headquarters, well inside its watch band. */
const SHORE_OFFSET = 8;
/** How far inside the watch band the ship anchors. */
const INSIDE_BAND = 2;
/** How far past the plain watch, yet inside the band a raider ashore holds a raised alarm from, the ship
 *  rides. */
const PAST_WATCH = ALARM_MARGIN_NODES + ALARM_STAND_DOWN_MARGIN_NODES;

const SHIPS = [
  {
    typeId: WARSHIP,
    id: 'ship_small',
    jobId: 52,
    stockSlots: 50,
    passengerSlots: 19,
    logicSize: 2,
    passengerJobs: [SPEARMAN, BOWMAN, CATAPULT_JOB],
    hitpoints: 10_000,
  },
  {
    typeId: CATAPULT,
    id: 'catapult',
    jobId: CATAPULT_JOB,
    stockSlots: 0,
    logicSize: 1,
    passengerJobs: [SPEARMAN],
    hitpoints: 3000,
  },
];

/** The catapult's far reach: under the house bow's, as in the real `weapons.ini`, so the bow's reach and
 *  not the catapult's decides its band. */
const CATAPULT_REACH = 26;

function content() {
  const base = aiContent(SHIPS);
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: CATAPULT_JOB, id: 'catapult' }],
    weapons: [
      ...base.weapons,
      {
        typeId: 21,
        id: 'viking_catapult',
        tribeType: VIKING,
        jobType: CATAPULT_JOB,
        mainType: WEAPON_MAIN_TYPE.CATAPULT,
        minRange: 8,
        maxRange: CATAPULT_REACH,
      },
    ],
  });
}

function coast(): TerrainMap {
  const sea = HQ.x + SHORE_OFFSET;
  const typeIds = Array.from({ length: MAP_W * MAP_H }, (_, i) => (i % MAP_W >= sea ? WATER : GRASS));
  return { resolution: 'half-cell', width: MAP_W, height: MAP_H, typeIds };
}

function setup(): { sim: Simulation; hq: Entity } {
  const sim = new Simulation({ seed: 1, content: content(), map: coast() });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ.x,
    y: HQ.y,
    tribe: VIKING,
    owner: SEAT,
  });
  sim.step();
  const hq = [...sim.world.query(Building)][0];
  if (hq === undefined) throw new Error('setup: the headquarters was refused');
  return { sim, hq };
}

/** An enemy warship east of the headquarters, `offset` points off its watch band from the walls (negative
 *  inside it), with one man of `crew`'s job seated aboard. */
function shipOff(sim: Simulation, crew: number, offset = -INSIDE_BAND): Entity {
  const hq = [...sim.world.query(Building)][0];
  if (hq === undefined) throw new Error('setup: no headquarters');
  const watch = threatWatchNodes(ctxOf(sim), VIKING);
  let x = HQ.x;
  while (distanceFromWalls(sim, hq, x, HQ.y) < watch + offset) x++;
  const ship = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: WARSHIP,
    x,
    y: HQ.y,
    tribe: VIKING,
    owner: FOE,
  });
  if (ship === null) throw new Error('setup: the warship was refused');
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: crew, x: HQ.x, y: HQ.y + 10, tribe: VIKING, owner: FOE });
  sim.step();
  const man = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (man === undefined || !seatPassenger(sim.world, ship, man))
    throw new Error('setup: the crew was refused');
  boardRider(sim.world, man, ship);
  return ship;
}

/** Where a foe's crewman waits, far outside every band. */
const AWAY = { x: HQ.x, y: HQ.y + 60 };

/** A foe's settler of `job`, spawned at `at`. */
function foeOf(sim: Simulation, job: number, at = AWAY): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: job, ...at, tribe: VIKING, owner: FOE });
  sim.step();
  const man = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (man === undefined) throw new Error('setup: the foe was refused');
  return man;
}

/** The first node west of the headquarters, on its row, whose distance from its walls lies in `(lo, hi]`. */
function westBetween(sim: Simulation, hq: Entity, lo: number, hi: number): { x: number; y: number } {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain graph');
  const at = terrain.coordsOf(entityNode(sim.world, terrain, hq));
  for (let x = at.x; x >= 0; x--) {
    const d = distanceFromWalls(sim, hq, x, at.y);
    if (d > lo && d <= hi) return { x, y: at.y };
  }
  throw new Error('setup: no node in the band');
}

/** An enemy catapult at `at`, crewed by one spearman unless `crewed` is false. */
function catapultAt(sim: Simulation, at: { x: number; y: number }, crewed = true): Entity {
  const catapult = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: CATAPULT,
    ...at,
    tribe: VIKING,
    owner: FOE,
  });
  if (catapult === null) throw new Error('setup: the catapult was refused');
  if (crewed) {
    const man = foeOf(sim, SPEARMAN);
    if (!seatPassenger(sim.world, catapult, man)) throw new Error('setup: the crew was refused');
    boardRider(sim.world, man, catapult);
  }
  return catapult;
}

/** The alarm orders of the seat's whole defence plan this decision. */
function alarms(sim: Simulation): { building: Entity; enabled: boolean }[] {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain graph');
  return planSettlementDefence(sim.world, ctxOf(sim), terrain, SEAT, true).commands.flatMap((c) =>
    c.kind === 'setDefenceMode' ? [{ building: c.building, enabled: c.enabled }] : [],
  );
}

describe('ai defence alarm - armed ships', () => {
  it('rings a shelter an enemy warship with a bowman on deck has closed on', () => {
    const { sim, hq } = setup();
    shipOff(sim, BOWMAN);

    expect(alarms(sim)).toEqual([{ building: hq, enabled: true }]);
  });

  it('ignores the same warship carrying no bowman', () => {
    const { sim } = setup();
    shipOff(sim, SPEARMAN);

    expect(alarms(sim)).toEqual([]);
  });

  it('stands down once the ship rides past the plain watch, though a man ashore there would hold it', () => {
    const { sim, hq } = setup();
    sim.enqueueSetup({ kind: 'setDefenceMode', building: hq, enabled: true });
    sim.step();
    shipOff(sim, BOWMAN, PAST_WATCH);

    expect(alarms(sim)).toEqual([{ building: hq, enabled: false }]);
  });
});

describe('ai defence alarm - margin', () => {
  it('rings for a raider ashore one map point past the house bow', () => {
    const { sim, hq } = setup();
    const watch = threatWatchNodes(ctxOf(sim), VIKING);
    const spot = westBetween(sim, hq, watch, watch + ALARM_MARGIN_NODES);
    const man = foeOf(sim, SPEARMAN, spot);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain graph');
    expect(terrain.coordsOf(entityNode(sim.world, terrain, man))).toEqual(spot);

    expect(alarms(sim)).toEqual([{ building: hq, enabled: true }]);
  });

  it("reads the band off the nearest wall off the building's row too, where a diagonal comes free", () => {
    const ROWS = 10;
    for (const [pastBand, rings] of [
      [0, true],
      [1, false],
    ] as const) {
      const { sim, hq } = setup();
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('setup: no terrain graph');
      const band = threatWatchNodes(ctxOf(sim), VIKING) + ALARM_MARGIN_NODES;
      const at = terrain.coordsOf(entityNode(sim.world, terrain, hq));
      const y = at.y + ROWS;
      let x = at.x;
      while (distanceFromWalls(sim, hq, x, y) < band + pastBand) x--;
      foeOf(sim, SPEARMAN, { x, y });

      expect(alarms(sim)).toEqual(rings ? [{ building: hq, enabled: true }] : []);
    }
  });

  it('rings for a crewed catapult inside the margin and not a point past it', () => {
    const watch = threatWatchNodes(ctxOf(setup().sim), VIKING);
    const band = watch + ALARM_MARGIN_NODES;
    for (const [lo, rings] of [
      [watch, true],
      [band, false],
    ] as const) {
      const { sim, hq } = setup();
      catapultAt(sim, westBetween(sim, hq, lo, lo + 1));

      expect(alarms(sim)).toEqual(rings ? [{ building: hq, enabled: true }] : []);
    }
  });

  it('measures from the walls the catapult aims at, not from the anchor', () => {
    const { sim, hq } = setup();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: no terrain graph');
    const band = threatWatchNodes(ctxOf(sim), VIKING) + ALARM_MARGIN_NODES;
    const spot = westBetween(sim, hq, band - 1, band);
    const anchor = terrain.coordsOf(entityNode(sim.world, terrain, hq));
    expect(hexDistanceBetween(spot.x, spot.y, anchor.x, anchor.y)).toBeGreaterThan(band);
    catapultAt(sim, spot);

    expect(alarms(sim)).toEqual([{ building: hq, enabled: true }]);
  });

  it('ignores an empty catapult inside the margin', () => {
    const { sim, hq } = setup();
    const watch = threatWatchNodes(ctxOf(sim), VIKING);
    catapultAt(sim, westBetween(sim, hq, watch, watch + ALARM_MARGIN_NODES), false);

    expect(alarms(sim)).toEqual([]);
  });
});
