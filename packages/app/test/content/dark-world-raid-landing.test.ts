import {
  components,
  type Entity,
  type MissionGoalOp,
  type MissionResultOp,
  type SimEvent,
  type Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

const { MissionObjectId, Position, Rider } = components;

/**
 * The story map's first raid, run by its own script: the wave boards a ship, sails for the defended
 * coast, and a timed line orders the crew off a little before the ship can get there. A crew whose
 * detach is refused at sea stays aboard until the ship is sunk, so the raid never lands and the
 * defence objective, which waits for every raider's death, never completes.
 */
const MAP_ID = 'mroczny_swiat';
/** The seat the map's story player holds. */
const STORY_PLAYER = 0;
/** Ticks from the trigger for the wave to spawn, board, sail and dock. */
const RAID_BUDGET_TICKS = 1500;
/** The tick after the mooring, by which the crew held for the detach has stepped ashore. */
const LANDING_TICKS = 1;

interface Wave {
  readonly mission: number;
  readonly crewId: number;
  /** The crew's tribe and job, ones the content holds: the trigger's human spawns with them. */
  readonly tribe: number;
  readonly job: number;
  readonly ship: number;
  readonly detachMission: number;
}

type Mission = NonNullable<Simulation['missions']>['missions'][number];

function missionsOf(sim: Simulation): readonly Mission[] {
  return sim.missions?.missions ?? [];
}

/** The script's first wave: the mission that spawns a crew, a ship, attaches and docks, with the mission
 *  that later orders the same crew off. */
function firstWave(sim: Simulation): Wave {
  for (const [mission, { results }] of missionsOf(sim).entries()) {
    const ship = results.find(
      (op): op is Extract<MissionResultOp, { opcode: 'SetVehicle' }> => op.opcode === 'SetVehicle',
    );
    const dock = results.find((op) => op.opcode === 'DockVehicle');
    const crew = results.find(
      (op): op is Extract<MissionResultOp, { opcode: 'SetHumanX' }> => op.opcode === 'SetHumanX',
    );
    if (ship === undefined || dock === undefined || crew === undefined) continue;
    const detachMission = missionsOf(sim).findIndex(({ results: later }) =>
      later.some((op) => op.opcode === 'DetachHumanFromVehicle' && op.humanId === crew.humanId),
    );
    if (detachMission < 0) continue;
    return {
      mission,
      crewId: crew.humanId,
      tribe: crew.tribe,
      job: crew.job,
      ship: ship.vehicleId,
      detachMission,
    };
  }
  throw new Error('the script has no scripted wave with a timed detach');
}

/** The proximity goal whose mission activates `wave`: a human with its id near its point starts the raid. */
function raidTrigger(sim: Simulation, wave: Wave): Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }> {
  for (const { goals, results } of missionsOf(sim)) {
    if (!results.some((op) => op.opcode === 'ActivateMission' && op.missionIndex === wave.mission)) continue;
    const goal = goals.find(
      (op): op is Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }> => op.opcode === 'FindPosByHumans',
    );
    if (goal !== undefined) return goal;
  }
  throw new Error('no proximity trigger activates the wave');
}

function crewOf(sim: Simulation, crewId: number): readonly Entity[] {
  return [...sim.world.query(MissionObjectId)].filter((e) => sim.world.get(e, MissionObjectId).id === crewId);
}

function runUntil(sim: Simulation, budget: number, done: (events: readonly SimEvent[]) => boolean): boolean {
  for (let tick = 0; tick < budget; tick++) {
    sim.step();
    if (done(sim.events.current())) return true;
  }
  return false;
}

describe.runIf(hasRealIr())(`${MAP_ID}: the first scripted raid`, () => {
  it('lands its crew the moment the ship moors, although the script ordered them off at sea', async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: [] });
    const wave = firstWave(sim);
    const trigger = raidTrigger(sim, wave);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: wave.job,
      tribe: wave.tribe,
      x: trigger.point.hx,
      y: trigger.point.hy,
      owner: STORY_PLAYER,
      missionId: trigger.humanId,
    });
    const detached = runUntil(
      sim,
      RAID_BUDGET_TICKS,
      () => sim.missionStatus()[wave.detachMission]?.done === true,
    );
    expect(detached, 'the timed detach fires').toBe(true);
    const crew = crewOf(sim, wave.crewId);
    expect(crew.length).toBeGreaterThan(0);
    // The author timed the line to the original's crossing, which this ship has not finished: nobody
    // left, nobody was refused, the order holds.
    for (const e of crew) {
      expect(sim.world.has(e, Position), 'aboard').toBe(false);
      expect(sim.world.get(e, Rider).leaving).toBe(true);
    }
    expect(sim.events.current().filter((e) => e.kind === 'riderRefused')).toEqual([]);
    const moored = runUntil(sim, RAID_BUDGET_TICKS, (events) =>
      events.some((e) => e.kind === 'vehicleDocked' && e.player !== STORY_PLAYER),
    );
    expect(moored, 'the raiding ship docks').toBe(true);
    sim.run(LANDING_TICKS);
    for (const e of crew) {
      expect(sim.world.has(e, Position), 'ashore').toBe(true);
      expect(sim.world.has(e, Rider), 'off the ship').toBe(false);
    }
  }, 300_000);
});
