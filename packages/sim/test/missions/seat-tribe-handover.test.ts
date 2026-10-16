import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Health, Person, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import type { MissionResultOp, MissionSeatTribe } from '../../src/systems/missions/index.js';
import { missionObjects } from '../../src/systems/missions/index.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import {
  enableMissions,
  FRANK,
  firingMission,
  HUT,
  houseContent,
  LOAD_PASS,
  MAP_NODES,
  POINT,
  VIKING,
  WOODCUTTER,
} from './support.js';

/** A handover that delivers the re-tribed seat's authored people moves them to the chosen people. */

const SARACEN = 4;
const PERSON_SEAT = 0;
const STAGING_SEAT = 3;
/** `hero_saber_hatschi` in the fixture content. */
const HERO = 45;
const VIKING_ID = 70;
const FRANK_ID = 71;
const HERO_ID = 72;
const HOUSE_ID = 73;

const SEAT: MissionSeatTribe = {
  player: PERSON_SEAT,
  authored: VIKING,
  chosen: SARACEN,
  drawnBuildings: [HUT],
};

const spawnHuman = (tribe: number, job: number, humanId: number): MissionResultOp => ({
  opcode: 'SetHuman',
  player: STAGING_SEAT,
  tribe,
  job,
  point: { hx: POINT.hx + humanId - VIKING_ID, hy: POINT.hy },
  humanId,
  behaviour: 0,
});

const VIKING_HUT_HITPOINTS = 100;
const SARACEN_HUT_HITPOINTS = 200;

/** The hut as real content carries it: each people's own variant with its own footprint object and hit
 *  points, the saracen one shifted by `shift` cells. */
function variantContent(shift: number): ContentSet {
  const base = houseContent();
  const viking = base.tribes.find((tribe) => tribe.typeId === VIKING);
  return parseContentSet({
    ...base,
    tribes:
      viking === undefined ? base.tribes : [...base.tribes, { ...viking, typeId: SARACEN, id: 'saracen' }],
    buildings: base.buildings.map((type) => {
      const footprint = type.footprint;
      if (type.typeId !== HUT || footprint === undefined) return type;
      const moved = { ...footprint, blocked: footprint.blocked.map((c) => ({ dx: c.dx + shift, dy: c.dy })) };
      return {
        ...type,
        tribeVariants: [
          { tribe: VIKING, footprint: structuredClone(footprint), hitpoints: VIKING_HUT_HITPOINTS },
          { tribe: SARACEN, footprint: moved, hitpoints: SARACEN_HUT_HITPOINTS },
        ],
      };
    }),
  });
}

function handoverSim(
  handovers: readonly MissionResultOp[],
  seatTribes: readonly MissionSeatTribe[],
  content: ContentSet = variantContent(0),
) {
  const sim = new Simulation({
    seed: 1,
    content,
    map: grassNodeMap(MAP_NODES, MAP_NODES),
    missions: {
      missions: [
        firingMission([
          spawnHuman(VIKING, WOODCUTTER, VIKING_ID),
          spawnHuman(FRANK, WOODCUTTER, FRANK_ID),
          spawnHuman(VIKING, HERO, HERO_ID),
          {
            opcode: 'SetHouse',
            player: STAGING_SEAT,
            houseName: { typeId: HUT, tribe: VIKING },
            level: 0,
            built: true,
            point: { hx: POINT.hx, hy: POINT.hy + 10 },
            objectId: HOUSE_ID,
          },
          ...handovers,
        ]),
      ],
      seatTribes,
    },
  });
  enableMissions(sim);
  sim.run(LOAD_PASS);
  return sim;
}

function tribeOf(sim: Simulation, id: number): number | undefined {
  const e: Entity | undefined = missionObjects(sim.world, id)[0];
  if (e === undefined) return undefined;
  return sim.world.has(e, Person) ? sim.world.get(e, Settler).tribe : sim.world.tryGet(e, Building)?.tribe;
}

const corrections = (sim: Simulation) =>
  sim.events.current().filter((event) => event.kind === 'missionSeatTribeCorrected');

describe('the handover safety net', () => {
  it("moves a handed seat's authored people, keeping another people and a hero", () => {
    const sim = handoverSim(
      [{ opcode: 'ChangePlayerPlayerId', player: STAGING_SEAT, otherPlayer: PERSON_SEAT }],
      [SEAT],
    );
    expect(tribeOf(sim, VIKING_ID)).toBe(SARACEN);
    expect(tribeOf(sim, FRANK_ID)).toBe(FRANK);
    expect(tribeOf(sim, HERO_ID)).toBe(VIKING);
    expect(tribeOf(sim, HOUSE_ID)).toBe(SARACEN);
    const house = missionObjects(sim.world, HOUSE_ID)[0];
    expect(house === undefined ? undefined : sim.world.get(house, Health)).toMatchObject({
      hitpoints: SARACEN_HUT_HITPOINTS,
      max: SARACEN_HUT_HITPOINTS,
    });
    expect(corrections(sim)).toEqual([
      { kind: 'missionSeatTribeCorrected', mission: 0, opcode: 'ChangePlayerPlayerId', count: 2 },
    ]);
  });

  it('moves a human handed by id, and a house the chosen people do not draw is reported but kept', () => {
    const sim = handoverSim(
      [
        { opcode: 'ChangeHumanPlayerId', humanId: VIKING_ID, player: PERSON_SEAT },
        { opcode: 'ChangeHousesPlayerId', objectId: HOUSE_ID, player: PERSON_SEAT },
      ],
      [{ ...SEAT, drawnBuildings: [] }],
    );
    expect(tribeOf(sim, VIKING_ID)).toBe(SARACEN);
    expect(tribeOf(sim, HOUSE_ID)).toBe(VIKING);
    expect(corrections(sim).map((event) => event.opcode)).toEqual([
      'ChangeHumanPlayerId',
      'ChangeHousesPlayerId',
    ]);
  });

  it('keeps a handed house whose footprint cells differ between the two peoples', () => {
    const sim = handoverSim(
      [{ opcode: 'ChangeHousesPlayerId', objectId: HOUSE_ID, player: PERSON_SEAT }],
      [SEAT],
      variantContent(1),
    );
    expect(tribeOf(sim, HOUSE_ID)).toBe(VIKING);
    expect(corrections(sim).map((event) => event.count)).toEqual([1]);
  });

  it('stays silent for a seat the session plays as the map authored it', () => {
    const sim = handoverSim(
      [{ opcode: 'ChangePlayerPlayerId', player: STAGING_SEAT, otherPlayer: PERSON_SEAT }],
      [],
    );
    expect(tribeOf(sim, VIKING_ID)).toBe(VIKING);
    expect(corrections(sim)).toEqual([]);
  });
});
