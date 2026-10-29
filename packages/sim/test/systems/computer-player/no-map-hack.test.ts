import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  ComputerIntel,
  ComputerOperations,
  ComputerStrategy,
  FOG_MODE,
  Garrison,
  JobAssignment,
  type MilitaryStrategyState,
  mapBriefOf,
  Position,
  Resource,
  Settler,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-shared/seat-roster.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../../src/systems/computer-player/index.js';
import { knownResourceTest } from '../../../src/systems/computer-player/live-resources.js';
import { playerSeesEntity } from '../../../src/systems/vision/gates.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  BARRACKS_TYPE,
  BOWMAN,
  ctxOf,
  HQ_TYPE,
  makeAiSeat,
  placeHq,
  placeResources,
  SEAT,
  STOCK_TYPE,
  STONE,
  STONE_HARVEST,
  spawnMen,
  TOWER_TYPE,
  UNARMED,
  VIKING,
} from './support.js';

/** Wide enough that the other seat's half lies beyond everything the seat's men reach in the run. */
const MAP_W = 256;
const MAP_H = 64;
const OTHER = 1;
const OTHER_HQ = { x: 230, y: 32 };
const BARRACKS_AT = { x: 30, y: 28 };
const SEAT_CIVILIANS = 6;
const SEAT_FIGHTERS = 4;
/** Where the other seat's later world stands: far off, or at the seat's door. */
const FAR = { x: 210, y: 30 };
const NEAR = { x: 40, y: 22 };
const LATER_FIGHTERS = 6;
const BAND_COLUMNS = 3;
/** Offsets of the later stock, tower and deposit from the band. */
const STOCK_DY = -10;
const TOWER_DY = 14;
const DEPOSIT_DX = -6;
const DEPOSIT_AMOUNT = 5;
/** Enough decisions for several workforce, scout, intel and posture beats. */
const DECISIONS = 12;
const RUN_TICKS = DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS;

interface Run {
  /** The seat's decided commands, by tick, decision source and content. */
  readonly commands: readonly unknown[];
  /** Its strategy record, intel memory and operations. */
  readonly memory: readonly unknown[];
  readonly posture: MilitaryStrategyState['posture'] | undefined;
}

/** A computer seat with a settlement, a barracks and fighters, and another seat's start headquarters,
 *  stepped once so the map brief has scanned the start. */
function startWorld(fogMode: number): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP_W, MAP_H) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: fogMode });
  makeAiSeat(sim, SEAT);
  placeHq(sim);
  const seatOwned = { tribe: VIKING, owner: SEAT };
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: BARRACKS_TYPE, ...BARRACKS_AT, ...seatOwned });
  spawnMen(sim, SEAT_CIVILIANS);
  spawnMen(sim, SEAT_FIGHTERS, UNARMED);
  placeResources(sim);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: OTHER, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    ...OTHER_HQ,
    tribe: VIKING,
    owner: OTHER,
  });
  sim.step();
  if (mapBriefOf(sim.world) === null) throw new Error('setup: the map brief is not taken');
  return sim;
}

/** What the other seat does after the scan around `at`: a stock, a manned tower, a band of fighters, and
 *  a stone deposit that appears beside them. Returns every entity this creates. */
function addLaterWorld(sim: Simulation, at: { x: number; y: number }): Entity[] {
  const before = sim.world.nextEntityId;
  const owned = { tribe: VIKING, owner: OTHER };
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: STOCK_TYPE,
    x: at.x,
    y: at.y + STOCK_DY,
    ...owned,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: TOWER_TYPE,
    x: at.x,
    y: at.y + TOWER_DY,
    ...owned,
  });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: BOWMAN, x: at.x, y: at.y + TOWER_DY, ...owned });
  for (let i = 0; i < LATER_FIGHTERS; i++) {
    const x = at.x + 2 * (i % BAND_COLUMNS);
    const y = at.y + 2 * Math.floor(i / BAND_COLUMNS);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: UNARMED, x, y, ...owned });
  }
  sim.enqueueSetup({
    kind: 'placeResource',
    good: STONE,
    x: at.x + DEPOSIT_DX,
    y: at.y,
    remaining: DEPOSIT_AMOUNT,
    harvestAtomic: STONE_HARVEST,
  });
  sim.step();
  const { world } = sim;
  const tower = ownedBuildings(world, OTHER).find((e) => world.get(e, Building).buildingType === TOWER_TYPE);
  const archer = ownedSettlers(world, OTHER).find((e) => world.get(e, Settler).jobType === BOWMAN);
  if (tower === undefined || archer === undefined) throw new Error('setup: the later tower and its archer');
  const post = world.get(tower, Position);
  world.add(archer, JobAssignment, { workplace: tower });
  world.add(archer, Garrison, { post: tower, returnTo: { x: post.x, y: post.y } });
  world.mut(archer, Position).x = post.x;
  world.mut(archer, Position).y = post.y;
  const later: Entity[] = [];
  for (let e = before; e < world.nextEntityId; e++) later.push(e as Entity);
  return later;
}

/** Step `sim` through the run, failing setup if the seat ever sees one of `unseen`. */
function run(sim: Simulation, unseen: readonly Entity[] = []): Run {
  for (let t = 1; t <= RUN_TICKS; t++) {
    sim.step();
    if (t % COMPUTER_DECISION_INTERVAL_TICKS !== 0) continue;
    const seen = unseen.find((e) => playerSeesEntity(sim.world, sim.fog, SEAT, e));
    if (seen !== undefined) throw new Error(`setup: the seat saw ${seen} on tick ${sim.tick}`);
  }
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no computer seat');
  return {
    // Sequence numbers are left out: the varied world's setup commands take some.
    commands: sim.commands.log.flatMap((e) =>
      e.origin === 'ai' && e.player === SEAT && e.decisionSource !== undefined
        ? [{ tick: e.applyTick, source: e.decisionSource, command: e.command }]
        : [],
    ),
    memory: [
      sim.world.tryGet(carrier, ComputerStrategy),
      sim.world.tryGet(carrier, ComputerIntel),
      sim.world.tryGet(carrier, ComputerOperations),
    ],
    posture: sim.world.tryGet(carrier, ComputerStrategy)?.military.posture,
  };
}

/** The same start run as is (`plain`) and with the other seat's later world added around `at`
 *  (`varied`). `plain` burns as many ids on bare entities and takes over `varied`'s RNG stream, so the
 *  seat's own later entities and rolls match in both and only what it may learn differs. */
function twins(fogMode: number, at: { x: number; y: number }) {
  const plain = startWorld(fogMode);
  const varied = startWorld(fogMode);
  const later = addLaterWorld(varied, at);
  const rolls = plain.rng.getState();
  const ids = plain.world.nextEntityId;
  plain.step();
  // The setup tick must be one the seat neither rolls nor creates on, or its draws and ids would shift.
  expect([plain.rng.getState(), plain.world.nextEntityId]).toEqual([rolls, ids]);
  plain.rng.setState(varied.rng.getState());
  while (plain.world.nextEntityId < varied.world.nextEntityId) plain.world.create();
  return { plain, varied, later };
}

/** The fog modes that hide the other seat: the classic one, and recon, whose terrain reads explored
 *  everywhere from the start. */
const HIDING_MODES = [
  ['classic fog of war', FOG_MODE.CLASSIC_FOG_OF_WAR],
  ['recon', FOG_MODE.RECON],
] as const;

describe('a computer seat under fog knows only what it sees', () => {
  it.each(HIDING_MODES)('decides the same whatever the other seat does out of its sight (%s)', (_, mode) => {
    const { plain, varied, later } = twins(mode, FAR);
    const deposit = later.find((e) => varied.world.has(e, Resource));
    if (deposit === undefined) throw new Error('setup: no later deposit');
    const ctx = { ...ctxOf(varied, varied.tick), ...(varied.fog ? { fog: varied.fog } : {}) };
    expect(knownResourceTest(varied.world, ctx, SEAT)?.(deposit)).toBe(false);
    const expected = run(plain);
    const actual = run(varied, later);
    // The later world stayed out of reach: it drew no shared roll and caused no extra entity.
    expect(varied.rng.getState()).toBe(plain.rng.getState());
    expect(varied.world.nextEntityId).toBe(plain.world.nextEntityId);
    const sources = new Set(expected.commands.map((c) => (c as { source: string }).source));
    expect([...sources]).toEqual(
      expect.arrayContaining([
        'collectResources',
        'houseBuild',
        'guideBuild',
        'military',
        'settlement-defence',
      ]),
    );
    expect(actual.commands).toEqual(expected.commands);
    expect(actual.memory).toEqual(expected.memory);
  });

  it('turns to defence once the same later world stands in its sight', () => {
    const { plain, varied } = twins(FOG_MODE.CLASSIC_FOG_OF_WAR, NEAR);
    const unaware = run(plain);
    const aware = run(varied);
    expect(unaware.posture).not.toBe('defend');
    expect(aware.posture).toBe('defend');
    expect(aware.commands).not.toEqual(unaware.commands);
  });
});

describe('a computer seat with the fog off', () => {
  it('sees the far army and decides on it, as a human would', () => {
    const { plain, varied } = twins(FOG_MODE.OFF, FAR);
    const unaware = run(plain);
    const aware = run(varied);
    expect(unaware.posture).not.toBe('defend');
    expect(aware.posture).toBe('defend');
  });
});
