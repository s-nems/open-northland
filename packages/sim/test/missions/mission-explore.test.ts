import { describe, expect, it } from 'vitest';
import { FOG_MODE, type FogMode } from '../../src/components/index.js';
import type { Simulation } from '../../src/index.js';
import type { HalfCellNode } from '../../src/nav/halfcell.js';
import type { MissionGoalOp, MissionResultOp } from '../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { FOG_STATE, VISION_CADENCE_TICKS } from '../../src/systems/vision/index.js';
import {
  FIRST_PASS,
  failedResultsUntil,
  firingSim,
  goalSim,
  HEADQUARTERS,
  holds,
  MAP_NODES,
  missionSim,
  POINT,
  roundTrip,
  spawn,
  VIKING,
  WILD,
  WOLF,
} from './support.js';

/**
 * The reveal a script grants and the goals that ask whether a player has explored a point. Fog is
 * off by default, where everything reads explored; under REVEAL and RECON a reveal shows as fully as
 * ground an own eye covers, and keeps showing.
 */

const OWNER = 0;
const RIVAL = 1;
const MARK = 7;
const RANGE = 4;
/** A slot above the sim's players: the original explores nothing for it and holds its goals outright. */
const BEYOND_SLOTS = 16;
const LAST_NODE = MAP_NODES - 1;
/** Beyond a civilian's eye and beyond the scripted reveal alike. */
const FAR_EAST = { hx: POINT.hx + 24, hy: POINT.hy };
const NEAR_EAST = { hx: POINT.hx + 4, hy: POINT.hy };
/** Nodes at hexagon distance 4 and 6 along the row: the reveal's rim and the first cell past it. */
const ON_RIM = { hx: POINT.hx + RANGE, hy: POINT.hy };
const PAST_RIM = { hx: POINT.hx + RANGE + 2, hy: POINT.hy };
const BELOW_RIM = { hx: POINT.hx, hy: POINT.hy + RANGE + 2 };

function explore(player: number, point: HalfCellNode, range: number): MissionResultOp {
  return { opcode: 'ExploreArea', player, point, range };
}

function underFog(sim: Simulation, mode: FogMode): Simulation {
  sim.enqueueSetup({ kind: 'setFogMode', mode });
  return sim;
}

function cellState(sim: Simulation, player: number, at: HalfCellNode): number {
  if (sim.fog === undefined) throw new Error('mapless sim');
  return sim.fog.stateAt(player, at.hx >> 1, at.hy >> 1);
}

function houseAt(sim: Simulation, owner: number, at: HalfCellNode, missionId: number): void {
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    x: at.hx,
    y: at.hy,
    owner,
    force: true,
    missionId,
  });
}

describe('ExploreArea', () => {
  it('reveals the hexagon around the point for the named player alone, as fully as an own eye', () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, RANGE)]), FOG_MODE.REVEAL);
    sim.run(FIRST_PASS);
    expect(cellState(sim, OWNER, POINT)).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, ON_RIM)).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, PAST_RIM)).toBe(FOG_STATE.UNEXPLORED);
    expect(cellState(sim, OWNER, BELOW_RIM)).toBe(FOG_STATE.UNEXPLORED);
    expect(sim.fog?.tryMaskFor(RIVAL)).toBeUndefined();
  });

  it('keeps the reveal in sight across later rebuilds, with no eye of the player near', () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, RANGE)]), FOG_MODE.REVEAL);
    spawn(sim, { player: OWNER, at: FAR_EAST });
    sim.run(FIRST_PASS + 2 * VISION_CADENCE_TICKS);
    expect(cellState(sim, OWNER, POINT)).toBe(FOG_STATE.VISIBLE);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a zero coordinate or range reveals the whole map', () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, 0)]), FOG_MODE.REVEAL);
    sim.run(FIRST_PASS);
    expect(cellState(sim, OWNER, { hx: 0, hy: 0 })).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, { hx: LAST_NODE, hy: LAST_NODE })).toBe(FOG_STATE.VISIBLE);
  });

  it('a whole-map reveal stays in sight in RECON as well', () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, 0)]), FOG_MODE.RECON);
    spawn(sim, { player: OWNER, at: FAR_EAST });
    sim.run(FIRST_PASS + 2 * VISION_CADENCE_TICKS);
    expect(cellState(sim, OWNER, { hx: 0, hy: 0 })).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, { hx: LAST_NODE, hy: LAST_NODE })).toBe(FOG_STATE.VISIBLE);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a range no lattice distance exceeds reveals the whole map too', () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, 4 * MAP_NODES)]), FOG_MODE.REVEAL);
    sim.run(FIRST_PASS);
    expect(cellState(sim, OWNER, { hx: 0, hy: 0 })).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, { hx: LAST_NODE, hy: LAST_NODE })).toBe(FOG_STATE.VISIBLE);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it("reveals for every player sharing the named player's vision", () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, RANGE)]), FOG_MODE.REVEAL);
    sim.enqueueSetup({ kind: 'setSharedVision', players: [OWNER, RIVAL] });
    sim.run(FIRST_PASS);
    expect(cellState(sim, RIVAL, ON_RIM)).toBe(FOG_STATE.VISIBLE);
  });

  it('keeps the reveal in sight in RECON, where every later rebuild lowers what no eye covers', () => {
    const sim = underFog(firingSim([explore(OWNER, POINT, RANGE)]), FOG_MODE.RECON);
    spawn(sim, { player: OWNER, at: FAR_EAST });
    sim.run(FIRST_PASS + 2 * VISION_CADENCE_TICKS);
    expect(cellState(sim, OWNER, POINT)).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, ON_RIM)).toBe(FOG_STATE.VISIBLE);
    expect(cellState(sim, OWNER, PAST_RIM)).toBe(FOG_STATE.UNEXPLORED);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('writes nothing with fog off, where everything shows already', () => {
    const sim = firingSim([explore(OWNER, POINT, RANGE)]);
    sim.run(FIRST_PASS);
    expect(sim.fog?.tryMaskFor(OWNER)).toBeUndefined();
  });

  it('carries the reveal through the save round trip, past the rebuilds that follow', () => {
    for (const mode of [FOG_MODE.REVEAL, FOG_MODE.RECON]) {
      const sim = underFog(firingSim([explore(OWNER, POINT, RANGE)]), mode);
      sim.run(FIRST_PASS);
      const restored = roundTrip(sim);
      restored.run(2 * VISION_CADENCE_TICKS);
      expect(cellState(restored, OWNER, ON_RIM)).toBe(FOG_STATE.VISIBLE);
    }
  });

  it('reports a slot the sim keeps no fog for', () => {
    const sim = underFog(firingSim([explore(WILD, POINT, RANGE)]), FOG_MODE.REVEAL);
    expect(failedResultsUntil(sim, FIRST_PASS)).toEqual(['ExploreArea']);
  });
});

describe('FindPos', () => {
  const at = (player: number, point: HalfCellNode): MissionGoalOp => ({ opcode: 'FindPos', player, point });

  it('holds with fog off', () => {
    const sim = goalSim(at(OWNER, FAR_EAST));
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it("under fog holds for a point the player's eye reached and not for one beyond it", () => {
    const near = underFog(goalSim(at(OWNER, NEAR_EAST)), FOG_MODE.REVEAL);
    spawn(near, { player: OWNER });
    near.run(FIRST_PASS);
    expect(holds(near)).toBe(true);

    const far = underFog(goalSim(at(OWNER, FAR_EAST)), FOG_MODE.REVEAL);
    spawn(far, { player: OWNER });
    far.run(FIRST_PASS);
    expect(holds(far)).toBe(false);
  });

  it('holds for a scripted reveal', () => {
    const sim = underFog(
      missionSim([
        {
          successfullIf: SUCCESSFUL_IF.all,
          active: true,
          visible: false,
          goals: [at(OWNER, ON_RIM)],
          results: [],
        },
        {
          successfullIf: SUCCESSFUL_IF.all,
          active: true,
          visible: false,
          goals: [],
          results: [explore(OWNER, POINT, RANGE)],
        },
      ]),
      FOG_MODE.REVEAL,
    );
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false); // judged before the reveal in the same pass
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it("holds for a slot above the sim's players whatever the fog", () => {
    const sim = underFog(goalSim(at(BEYOND_SLOTS, FAR_EAST)), FOG_MODE.REVEAL);
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('knows the terrain from the start in RECON', () => {
    const sim = underFog(goalSim(at(OWNER, FAR_EAST)), FOG_MODE.RECON);
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });
});

describe('FindHumans, FindHouses and FindAnimals', () => {
  it('hold when something stamped with the id stands on a point the player explored', () => {
    const humans = underFog(goalSim({ opcode: 'FindHumans', player: OWNER, humanId: MARK }), FOG_MODE.REVEAL);
    spawn(humans, { player: OWNER });
    spawn(humans, { player: RIVAL, at: NEAR_EAST, missionId: MARK });
    humans.run(FIRST_PASS);
    expect(holds(humans)).toBe(true);

    const houses = underFog(
      goalSim({ opcode: 'FindHouses', player: OWNER, objectId: MARK }),
      FOG_MODE.REVEAL,
    );
    spawn(houses, { player: OWNER });
    houseAt(houses, RIVAL, NEAR_EAST, MARK);
    houses.run(FIRST_PASS);
    expect(holds(houses)).toBe(true);

    const animals = underFog(
      goalSim({ opcode: 'FindAnimals', player: OWNER, objectId: MARK }),
      FOG_MODE.REVEAL,
    );
    spawn(animals, { player: OWNER });
    animals.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: WOLF,
      x: NEAR_EAST.hx,
      y: NEAR_EAST.hy,
      count: 1,
      missionId: MARK,
    });
    animals.run(FIRST_PASS);
    expect(holds(animals)).toBe(true);
  });

  it('hold nowhere for a stamped human beyond every eye', () => {
    const sim = underFog(goalSim({ opcode: 'FindHumans', player: OWNER, humanId: MARK }), FOG_MODE.REVEAL);
    spawn(sim, { player: OWNER });
    spawn(sim, { player: RIVAL, at: FAR_EAST, missionId: MARK });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
  });

  it("hold for a slot above the sim's players once anything carries the id, wherever it stands", () => {
    const sim = underFog(
      goalSim({ opcode: 'FindHumans', player: BEYOND_SLOTS, humanId: MARK }),
      FOG_MODE.REVEAL,
    );
    spawn(sim, { player: RIVAL, at: FAR_EAST, missionId: MARK });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(true);
  });

  it('hold nowhere when nothing carries the id, even for such a slot', () => {
    const sim = goalSim({ opcode: 'FindHumans', player: BEYOND_SLOTS, humanId: MARK });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
  });
});
