import { describe, expect, it } from 'vitest';
import {
  AiControl,
  aiControlEntity,
  Building,
  ComputerStrategy,
  computerModuleEnables,
  type MilitaryPlan,
  type MilitaryPosture,
  Owner,
  Settler,
  setDiplomacyStance,
} from '../../../../../src/components/index.js';
import { CommandQueue } from '../../../../../src/core/command-queue.js';
import { PersonalNames } from '../../../../../src/core/personal-names.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  EventBuffer,
  exportSaveGame,
  parseSaveGame,
  Rng,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import type { TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import { moduleBeatDue } from '../../../../../src/systems/ai-shared/cadence.js';
import {
  militaryModule,
  type OperationView,
  seatOperationsOf,
  selectPosture,
} from '../../../../../src/systems/computer-player/index.js';
import { ASSUMED_PEACE_TICKS } from '../../../../../src/systems/computer-player/military/deadline.js';
import {
  HOLD_HOME_FLOOR_MEN,
  HOLD_LOOK_EVERY_DECISIONS,
  HOLD_RETRY_TICKS,
} from '../../../../../src/systems/computer-player/military/operations/hold.js';
import { stayingGuardians } from '../../../../../src/systems/computer-player/military/operations/hold-area.js';
import type { SystemContext } from '../../../../../src/systems/index.js';
import { type MissionScript, SUCCESSFUL_IF } from '../../../../../src/systems/missions/index.js';
import { interactionCell } from '../../../../../src/systems/settlers/targets/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const FRIEND = 4;
const HQ_TYPE = 1;
const BARRACKS_TYPE = 12;
const SPEARMAN = 32;
const SEED = 7;
const DIAMOND = 50;

const BARRACKS = { x: 30, y: 30 };
const CENTRE = { hx: 90, hy: 50 };
const RANGE = 8;
const CORNER = { hx: 10, hy: 80 };
/** Men at the door: the home floor plus a band's worth. */
const ARMY = 16;
const DECISION = 48;
const REWARD_SECONDS = 300;

/** A map that pays the seat one diamond at the corner for every timer check its men stand in the centre,
 *  and wins it at ten: the repeating presence pattern the map intent reads as a hold. */
const SCRIPT: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [{ opcode: 'TimeGone', seconds: REWARD_SECONDS }],
      results: [
        { opcode: 'ActivateMission', missionIndex: 1 },
        { opcode: 'ActivateMission', missionIndex: 2 },
      ],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: false,
      visible: false,
      goals: [{ opcode: 'FindPosByPlayersMapMoveable', player: SEAT, point: CENTRE, range: RANGE }],
      results: [
        {
          opcode: 'AddGoodsToMapArea',
          good: DIAMOND,
          amount: 1,
          point: CORNER,
          range: 5,
          flag: false,
          player: SEAT,
        },
      ],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: false,
      visible: false,
      goals: [{ opcode: 'True' }],
      results: [{ opcode: 'ActivateMission', missionIndex: 0 }],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [
        { opcode: 'NumberOfGoodsInArea', player: SEAT, good: DIAMOND, amount: 10, point: CORNER, range: 5 },
      ],
      results: [{ opcode: 'MissionWon', player: SEAT }],
    },
  ],
};

function aiSim(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(128, 96) });
}

function ctxOf(sim: Simulation, tick: number): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(SEED),
    names: new PersonalNames(1, []),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    missions: SCRIPT,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return sim.terrain;
}

function place(sim: Simulation, buildingType: number, at: { x: number; y: number }, owner: number): Entity {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  for (const e of sim.world.query(Building, Owner)) {
    if (sim.world.get(e, Building).buildingType === buildingType && sim.world.get(e, Owner).player === owner)
      return e;
  }
  throw new Error(`setup: building ${buildingType} of ${owner} missing`);
}

/** `count` men of `jobType` on a tight grid around `at`. */
function band(sim: Simulation, count: number, at: { x: number; y: number }, owner = SEAT): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    const x = at.x - 4 + 2 * (i % 5);
    const y = at.y + 2 * Math.floor(i / 5);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SPEARMAN, x, y, tribe: VIKING, owner });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

/** Gives `player` machine identity with only its map AI on: no computer controller runs it. */
function mapAiSeat(sim: Simulation, player: number): void {
  const carrier = sim.world.create();
  sim.world.add(carrier, AiControl, {
    player,
    computerEnabled: false,
    modules: computerModuleEnables(),
    mapAiEnabled: true,
    difficulty: 'hard',
  });
}

function holdPosture(sim: Simulation, plan: MilitaryPlan, posture: MilitaryPosture): void {
  let carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) {
    carrier = sim.world.create();
    sim.world.add(carrier, AiControl, {
      player: SEAT,
      computerEnabled: true,
      modules: computerModuleEnables(),
      mapAiEnabled: true,
      difficulty: 'hard',
    });
  }
  const inputs = {
    ownPoints: 0,
    targetOwner: null,
    targetPoints: null,
    strongestPoints: null,
    threatInTicks: null,
    underAttack: false,
    raidTargetKnown: false,
  };
  const military = { ...selectPosture(plan, inputs, null), posture, plan, decidedAt: 0, challenger: null };
  const economy = { archetype: 'standard' as const, sides: [], evidence: [], decidedAt: 0, challenger: null };
  if (sim.world.has(carrier, ComputerStrategy)) sim.world.remove(carrier, ComputerStrategy);
  sim.world.add(carrier, ComputerStrategy, { economy, military });
}

/** A balanced seat building up (no wave marches) with its barracks and men at the door; `before` sets up
 *  what stands ahead of the seat's first decision, so its map brief records it. */
function holdWorld(before: (sim: Simulation) => void = () => {}) {
  const sim = aiSim();
  before(sim);
  holdPosture(sim, 'balanced', 'prepare');
  const barracks = place(sim, BARRACKS_TYPE, BARRACKS, SEAT);
  const terrain = terrainOf(sim);
  const door = terrain.coordsOf(interactionCell(sim.world, ctxOf(sim, 0), terrain, barracks));
  const men = band(sim, ARMY, door);
  return { sim, door, men };
}

function lookFrom(from: number): number {
  let tick = Math.ceil(from / DECISION) * DECISION;
  while (!moduleBeatDue(tick, SEAT, HOLD_LOOK_EVERY_DECISIONS)) tick += DECISION;
  return tick;
}

/** The first look past the military deadline of a seat with no lobby peace. */
const LOOK = lookFrom(ASSUMED_PEACE_TICKS);

function decide(sim: Simulation, tick: number) {
  return militaryModule.run(sim.world, ctxOf(sim, tick), SEAT);
}

function holds(sim: Simulation): OperationView[] {
  return seatOperationsOf(sim.world, SEAT).filter((op) => op.kind === 'hold');
}

function onlyHold(sim: Simulation): OperationView {
  const [hold, ...more] = holds(sim);
  if (hold === undefined || more.length > 0) throw new Error(`expected one hold, got ${holds(sim).length}`);
  return hold;
}

const AT_CENTRE = { x: CENTRE.hx, y: CENTRE.hy };

describe('hold operations', () => {
  it('forms only past the military deadline, from the plan`s share of the men past the home floor', () => {
    const { sim } = holdWorld();
    decide(sim, lookFrom(ASSUMED_PEACE_TICKS - HOLD_RETRY_TICKS));
    expect(holds(sim)).toEqual([]);
    decide(sim, LOOK);
    const hold = onlyHold(sim);
    // A balanced plan takes three quarters of the eleven spare men, rounded up.
    expect(hold.members).toHaveLength(Math.ceil(((ARMY - HOLD_HOME_FLOOR_MEN) * 3) / 4));
    expect(hold.target).toEqual({ hx: CENTRE.hx, hy: CENTRE.hy, entity: null, owner: null });
    expect(hold.hold?.range).toBe(RANGE);
    expect(hold.state).toBe('forming');
  });

  it('marches its band into the area once it has gathered at the door', () => {
    const { sim } = holdWorld();
    decide(sim, LOOK);
    const commands = decide(sim, LOOK + DECISION);
    const hold = onlyHold(sim);
    expect(hold.state).toBe('moving');
    const post = hold.hold?.post;
    for (const e of hold.members) {
      expect(commands).toContainEqual({ kind: 'attackMoveUnit', entity: e, x: post?.hx, y: post?.hy });
    }
  });

  it('draws more men as the enemy it sees at the area grows, and turns back once clearly outmatched', () => {
    const { sim } = holdWorld();
    decide(sim, LOOK);
    decide(sim, LOOK + DECISION);
    const sent = onlyHold(sim).members.length;
    band(sim, sent, AT_CENTRE, FOE);
    decide(sim, LOOK + 2 * DECISION);
    // Matching the enemy is short of the edge: the two spare men left past the floor join.
    expect(onlyHold(sim).members).toHaveLength(ARMY - HOLD_HOME_FLOOR_MEN);
    expect(onlyHold(sim).state).toBe('moving');
    band(sim, sent, { x: AT_CENTRE.x, y: AT_CENTRE.y + 6 }, FOE);
    decide(sim, LOOK + 3 * DECISION);
    expect(onlyHold(sim).state).toBe('withdrawing');
    expect(onlyHold(sim).reason).toBe('outmatched');
  });

  it('forms no band short of the edge over the defence it sees there', () => {
    const { sim } = holdWorld();
    band(sim, ARMY, AT_CENTRE, FOE);
    decide(sim, LOOK);
    expect(holds(sim)).toEqual([]);
  });

  it('weighs a guardian starting in the area with his whole army, and never as a threat to the home', () => {
    const { sim } = holdWorld((at) => {
      mapAiSeat(at, FOE);
      place(at, HQ_TYPE, { x: CENTRE.hx, y: CENTRE.hy + RANGE }, FOE);
    });
    // His army stands far from the area, out of the watch margin.
    band(sim, ARMY, { x: 110, y: 88 }, FOE);
    expect([...stayingGuardians(sim.world, ctxOf(sim, LOOK), SEAT)]).toEqual([FOE]);
    decide(sim, LOOK);
    expect(holds(sim)).toEqual([]);
  });

  it('never counts a human seat starting in the area as a guardian that stays', () => {
    const { sim } = holdWorld((at) => place(at, HQ_TYPE, { x: CENTRE.hx, y: CENTRE.hy + RANGE }, FOE));
    expect([...stayingGuardians(sim.world, ctxOf(sim, LOOK), SEAT)]).toEqual([]);
  });

  it('leaves an area a friend already holds to him', () => {
    const { sim } = holdWorld();
    setDiplomacyStance(sim.world, SEAT, FRIEND, 'friend');
    setDiplomacyStance(sim.world, FRIEND, SEAT, 'friend');
    band(sim, 1, AT_CENTRE, FRIEND);
    decide(sim, LOOK);
    expect(holds(sim)).toEqual([]);
  });

  it('keeps a hold under way through a save', () => {
    const { sim } = holdWorld();
    decide(sim, LOOK);
    const bytes = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: aiContent(),
      map: grassNodeMap(128, 96),
    });
    expect(seatOperationsOf(restored.world, SEAT)).toEqual(seatOperationsOf(sim.world, SEAT));
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(bytes);
  });
});
