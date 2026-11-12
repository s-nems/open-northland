import { describe, expect, it } from 'vitest';
import { Building, Settler, seatPassenger } from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { Simulation, type TerrainMap } from '../../../../../src/index.js';
import {
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from '../../../../../src/systems/ai-shared/military/defence/index.js';
import { planSettlementDefence } from '../../../../../src/systems/ai-shared/military/settlement-defence.js';
import { boardRider, createVehicle } from '../../../../../src/systems/vehicles/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { ctxOf } from '../../../../fixtures/context.js';

// The alarm takes cover from an enemy warship with a bowman on its deck as from a bowman ashore.

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
const HQ = { x: 24, y: 20 };
/** The sea starts this many nodes east of the headquarters, well inside its watch band. */
const SHORE_OFFSET = 8;
/** How far inside the watch band the ship anchors. */
const INSIDE_BAND = 2;
/** How far past the plain watch, yet inside the stand-down margin a raider ashore holds, the ship rides. */
const PAST_WATCH = 3;

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

function coast(): TerrainMap {
  const sea = HQ.x + SHORE_OFFSET;
  const typeIds = Array.from({ length: MAP_W * MAP_H }, (_, i) => (i % MAP_W >= sea ? WATER : GRASS));
  return { resolution: 'half-cell', width: MAP_W, height: MAP_H, typeIds };
}

function setup(): { sim: Simulation; hq: Entity } {
  const sim = new Simulation({ seed: 1, content: aiContent(SHIPS), map: coast() });
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

/** An enemy warship `offset` points off the headquarters' watch band (negative inside it) with one man of
 *  `crew`'s job seated aboard. */
function shipOff(sim: Simulation, crew: number, offset = -INSIDE_BAND): Entity {
  const watch = threatWatchNodes(ctxOf(sim), VIKING);
  const ship = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: WARSHIP,
    x: HQ.x + watch + offset,
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

    expect(PAST_WATCH).toBeLessThan(THREAT_STAND_DOWN_MARGIN_NODES);
    expect(alarms(sim)).toEqual([{ building: hq, enabled: false }]);
  });
});
