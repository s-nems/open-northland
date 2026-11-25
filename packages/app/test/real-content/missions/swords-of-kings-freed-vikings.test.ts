import {
  adminCommand,
  components,
  type Entity,
  type HalfCellNode,
  type MissionGoalOp,
  type MissionResultOp,
  nodeOfPosition,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import { realMapWorld } from '../real-map-world.js';

const { MissionObjectId, Owner, Palisade, Person, Position, Settler } = components;

/**
 * The sub-map's two cages of Vikings, run by its own script: once the player's men stand at a cage, a
 * repeating line sends the prisoners out to a point past its gate, and a mission waiting for none of them
 * near the cage hands them to the player. Breaking the gate lets them out; the band must then stand clear
 * of the cage, or the hand-over never comes and the Vikings stay with the allied seat.
 */
const MAP_ID = 'northland-campaign_02_04_sub1';
/** The seat the map's story player holds. */
const STORY_PLAYER = 0;
/** The player's breaching party at each cage. */
const BREACHERS = 5;
const BREACHER_JOB = 'soldier_sword_long';
/** Ticks for the party to break both gates and the prisoners to walk out. */
const FREE_BUDGET_TICKS = 3000;
/** How far from the point the prisoners are sent to the cage's gate may stand, in map points. */
const GATE_SEARCH_POINTS = 4;

interface Cage {
  readonly humanId: number;
  readonly freeMission: number;
  /** Where the script sends the prisoners out to. */
  readonly exit: HalfCellNode;
}

type Mission = NonNullable<Simulation['missions']>['missions'][number];

function missionsOf(sim: Simulation): readonly Mission[] {
  return sim.missions?.missions ?? [];
}

/** Each mission handing a group to the story player, with the walk out its repeating line orders. */
function cages(sim: Simulation): readonly Cage[] {
  const missions = missionsOf(sim);
  const found: Cage[] = [];
  for (const [freeMission, { goals, results }] of missions.entries()) {
    const handover = results.find(
      (op): op is Extract<MissionResultOp, { opcode: 'ChangeHumanPlayerId' }> =>
        op.opcode === 'ChangeHumanPlayerId' && op.player === STORY_PLAYER,
    );
    const away = goals.find(
      (op): op is Extract<MissionGoalOp, { opcode: 'FindPosByHumans' }> => op.opcode === 'FindPosByHumans',
    );
    if (handover === undefined || away === undefined) continue;
    const send = missions
      .flatMap((m) => m.results)
      .find(
        (op): op is Extract<MissionResultOp, { opcode: 'SendHuman' }> =>
          op.opcode === 'SendHuman' && op.humanId === handover.humanId,
      );
    if (send === undefined) continue;
    found.push({ humanId: handover.humanId, freeMission, exit: send.point });
  }
  return found;
}

function nodeOf(sim: Simulation, e: Entity): HalfCellNode {
  const at = sim.world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}

/** The gate standing nearest the point the prisoners are sent to. */
function gateOf(sim: Simulation, cage: Cage): Entity {
  for (const e of sim.world.canonicalQuery(Palisade, Position)) {
    if (sim.world.get(e, Palisade).gate === null) continue;
    const { hx, hy } = nodeOf(sim, e);
    if (Math.abs(hx - cage.exit.hx) + Math.abs(hy - cage.exit.hy) <= GATE_SEARCH_POINTS) return e;
  }
  throw new Error(`no gate near ${cage.exit.hx},${cage.exit.hy}`);
}

function prisoners(sim: Simulation, humanId: number): readonly Entity[] {
  return sim.world
    .canonicalQuery(MissionObjectId, Person)
    .filter((e) => sim.world.get(e, MissionObjectId).id === humanId);
}

describe.runIf(hasRealIr())(`${MAP_ID}: the caged Vikings`, () => {
  it('join the player once their gate is broken and they have walked out', async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, machineSeats: [] });
    const all = cages(sim);
    expect(all.length).toBe(2);
    const gates = all.map((cage) => gateOf(sim, cage));
    const [firstGate] = gates;
    const [firstPrisoner] = prisoners(sim, all[0]?.humanId ?? 0);
    if (firstGate === undefined || firstPrisoner === undefined) throw new Error('no caged group');
    const jailer = sim.world.get(firstGate, Owner).player;
    const job = sim.content.jobs.find((row) => row.id === BREACHER_JOB);
    if (job === undefined) throw new Error(`no job ${BREACHER_JOB}`);
    const tribe = sim.world.get(firstPrisoner, Settler).tribe;
    // The jailers' fight is not under test: they are struck off so the party only breaks the gates.
    for (const e of sim.world.canonicalQuery(Person)) {
      if (sim.world.get(e, Owner).player === jailer)
        sim.enqueue(adminCommand({ kind: 'debugKill', target: e }));
    }
    for (const cage of all) {
      for (let i = 0; i < BREACHERS; i++) {
        sim.enqueueSetup({
          kind: 'spawnSettler',
          jobType: job.typeId,
          tribe,
          x: cage.exit.hx,
          y: cage.exit.hy,
          owner: STORY_PLAYER,
        });
      }
    }
    sim.step();
    const party = sim.world
      .canonicalQuery(Person, Settler)
      .filter((e) => sim.world.get(e, Owner).player === STORY_PLAYER && !sim.world.has(e, MissionObjectId));
    expect(party.length).toBe(BREACHERS * all.length);
    for (const [i, e] of party.entries()) {
      const gate = gates[Math.floor(i / BREACHERS)];
      if (gate === undefined) throw new Error('a breacher without a gate');
      sim.enqueue(playerCommand(STORY_PLAYER, { kind: 'attackUnit', entity: e, target: gate }));
    }
    const freed = (): boolean => all.every((cage) => sim.missionStatus()[cage.freeMission]?.done === true);
    for (let tick = 0; tick < FREE_BUDGET_TICKS && !freed(); tick++) sim.step();
    for (const gate of gates) expect(sim.world.isAlive(gate), 'the gate is broken').toBe(false);
    for (const cage of all) {
      expect(sim.missionStatus()[cage.freeMission]?.done, `group ${cage.humanId} is freed`).toBe(true);
      for (const e of prisoners(sim, cage.humanId)) expect(sim.world.get(e, Owner).player).toBe(STORY_PLAYER);
    }
  }, 300_000);
});
