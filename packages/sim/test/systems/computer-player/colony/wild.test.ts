import { describe, expect, it } from 'vitest';
import { aiControlEntity, ComputerColony, StayPoint } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import {
  COMPUTER_DECISION_INTERVAL_TICKS,
  WORKFORCE_EVERY_DECISIONS,
} from '../../../../src/systems/ai-shared/cadence.js';
import { colonyModule } from '../../../../src/systems/computer-player/colony/index.js';
import {
  harried,
  underWildAttack,
  WILD_GIVE_UP_TICKS,
  WILD_RUN_LAPSE_TICKS,
} from '../../../../src/systems/computer-player/colony/wild.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import {
  blankColony,
  colonyContent,
  colonyState,
  colonyWorld,
  looseColonyEnv,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { CIVILIST, SEAT, STOCK_TYPE, VIKING, WOLF_TRIBE, withWolves } from '../support.js';

const SEED = 7;
/** A store of the seat's on the east island, a wolf standing beside it and two colonists across from it. */
const STORE_AT = { x: 180, y: 60 };
const WOLF_DX = 6;
const COLONIST_DX = -6;
const COLONISTS = 2;
/** Beside the seat's headquarters at home. */
const HOME_WOLF_AT = { x: 78, y: 60 };
/** How often the test looks, well inside the run's lapse. */
const LOOK_EVERY_TICKS = minutesToTicks(1);
/** The ticks between a seat's workforce beats, where the colony reads its attacks. */
const WORKFORCE_BEAT_TICKS = WORKFORCE_EVERY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The colony seat with its store on the east island, and the static land the store stands on. */
function storeWorld(): { readonly sim: Simulation; readonly land: number } {
  const sim = colonyWorld(SEED, withWolves(colonyContent()));
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: STOCK_TYPE,
    ...STORE_AT,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  sim.step();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  return { sim, land: terrain.componentOf(terrain.nodeAt(STORE_AT.x, STORE_AT.y)) };
}

/** A wolf spawned at `at`. */
function wolfAt(sim: Simulation, at: Point): Entity {
  const before = new Set(sim.world.query(StayPoint));
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: WOLF_TRIBE, ...at, count: 1 });
  sim.step();
  const wolf = [...sim.world.query(StayPoint)].find((e) => !before.has(e));
  if (wolf === undefined) throw new Error('setup: no wolf');
  return wolf;
}

const besideStore = { x: STORE_AT.x + WOLF_DX, y: STORE_AT.y };

describe('a colony under wild attack', () => {
  it('counts the attacks on its own land alone, keeps them past the give-up span, and a lapse ends the run', () => {
    const { sim, land } = storeWorld();
    wolfAt(sim, HOME_WOLF_AT);
    const colony = blankColony(land);
    const harriedAt = (tick: number): boolean =>
      harried({ ...looseColonyEnv(sim, colony), ctx: { ...ctxOf(sim), tick } }, colony);
    expect(harriedAt(sim.tick)).toBe(false);
    expect(colony.wild).toBeNull();
    const wolf = wolfAt(sim, besideStore);
    const from = sim.tick;
    for (let tick = from; tick < from + WILD_GIVE_UP_TICKS; tick += LOOK_EVERY_TICKS)
      expect(harriedAt(tick)).toBe(false);
    expect(underWildAttack(colony, from + WILD_GIVE_UP_TICKS)).toBe(true);
    expect(harriedAt(from + WILD_GIVE_UP_TICKS)).toBe(true);
    sim.world.destroy(wolf);
    const lapsed = from + WILD_GIVE_UP_TICKS + WILD_RUN_LAPSE_TICKS;
    expect(harriedAt(lapsed)).toBe(false);
    expect(underWildAttack(colony, lapsed)).toBe(false);
  });

  it('is given up by the colony module once the attacks go on past the give-up span', () => {
    const { sim, land } = storeWorld();
    for (let i = 0; i < COLONISTS; i++)
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: CIVILIST,
        x: STORE_AT.x + COLONIST_DX,
        y: STORE_AT.y + i,
        tribe: VIKING,
        owner: SEAT,
      });
    wolfAt(sim, besideStore);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.add(carrier, ComputerColony, { colonies: [blankColony(land)], rejected: [], retryAt: 0 });
    // One run a decision with the world held still: each workforce beat sees the same wolf by the store.
    const from = sim.tick;
    const end = from + WILD_GIVE_UP_TICKS + WORKFORCE_BEAT_TICKS;
    for (let tick = from; tick <= end; tick += COMPUTER_DECISION_INTERVAL_TICKS) {
      if (tick < from + WILD_GIVE_UP_TICKS) expect(colonyState(sim)?.phase).toBe('running');
      colonyModule.run(sim.world, { ...ctxOf(sim), tick }, SEAT);
    }
    expect(colonyState(sim)?.phase).toBe('abandoned');
  });
});
