import { describe, expect, it } from 'vitest';
import { MissionObjectId, Settler } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import { MID_GAME_FROM_TICKS, minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import {
  ASSUMED_PEACE_TICKS,
  BARRACKS_LEAD_TICKS,
} from '../../../../src/systems/computer-player/military/deadline.js';
import {
  DEMOBILIZE_UNTIL_TICK,
  demobilizeEarlySoldiers,
} from '../../../../src/systems/computer-player/workforce/demobilize.js';
import {
  aiSim,
  BARRACKS_TYPE,
  BUILDER,
  ctxOf,
  HQ_X,
  HQ_Y,
  makeAiSeat,
  placeHq,
  SEAT,
  SPEARMAN,
  spawnMen,
  VIKING,
} from '../support.js';

/** The soldiers a seat is placed with, beside a few civilians. */
const START_SOLDIERS = 3;
const START_CIVILIANS = 2;
/** A barracks clear of the headquarters. */
const BARRACKS_AT = { x: HQ_X + 10, y: HQ_Y };
/** Long enough for the seat's first workforce decisions to run and their trade changes to land. */
const SETTLE_TICKS = 400;
/** Past the start window, early in a seat's opening, when a chest may hand it soldiers. */
const CHEST_OPENED_TICK = minutesToTicks(20);
/** From when the seat's army stops waiting under the peace a seat plans for. */
const ARMY_RAISED_TICK = ASSUMED_PEACE_TICKS - BARRACKS_LEAD_TICKS;
/** A lobby peace long enough that the army still waits through the mid game. */
const LONG_PEACE_TICKS = minutesToTicks(180);

function startSeat(options: { readonly barracks?: boolean } = {}): Simulation {
  const sim = aiSim();
  placeHq(sim);
  if (options.barracks === true) {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      ...BARRACKS_AT,
      tribe: VIKING,
      owner: SEAT,
    });
  }
  spawnMen(sim, START_SOLDIERS, SPEARMAN);
  spawnMen(sim, START_CIVILIANS);
  makeAiSeat(sim, SEAT);
  sim.step();
  return sim;
}

function soldiers(sim: Simulation): Entity[] {
  return ownedSettlers(sim.world, SEAT).filter((e) => sim.world.get(e, Settler).jobType === SPEARMAN);
}

const retrades = (commands: readonly PlayerCommand[]): PlayerCommand[] =>
  commands.filter((c) => c.kind === 'setJob');

describe('demobilizeEarlySoldiers', () => {
  it("turns the seat's start soldiers into builders, who stay builders", () => {
    const sim = startSeat();
    const start = soldiers(sim);
    expect(start).toHaveLength(START_SOLDIERS);
    expect(demobilizeEarlySoldiers(sim.world, ctxOf(sim, sim.tick), SEAT, BUILDER)).toEqual(
      start.map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })),
    );
    sim.run(SETTLE_TICKS);
    expect(soldiers(sim)).toEqual([]);
    for (const e of start) expect(sim.world.get(e, Settler).jobType).not.toBe(SPEARMAN);
  });

  it('turns soldiers the seat gains in its opening into builders while its army waits', () => {
    const sim = startSeat();
    const gained = soldiers(sim);
    expect(DEMOBILIZE_UNTIL_TICK).toBeLessThan(CHEST_OPENED_TICK);
    expect(demobilizeEarlySoldiers(sim.world, ctxOf(sim, CHEST_OPENED_TICK), SEAT, BUILDER)).toEqual(
      gained.map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })),
    );
  });

  it('leaves the soldiers alone once the army is raised, past the opening, or while a barracks stands', () => {
    const sim = startSeat();
    expect(demobilizeEarlySoldiers(sim.world, ctxOf(sim, ARMY_RAISED_TICK), SEAT, BUILDER)).toEqual([]);
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: LONG_PEACE_TICKS, players: [SEAT] });
    sim.step();
    expect(demobilizeEarlySoldiers(sim.world, ctxOf(sim, ARMY_RAISED_TICK), SEAT, BUILDER)).toHaveLength(
      START_SOLDIERS,
    );
    expect(demobilizeEarlySoldiers(sim.world, ctxOf(sim, MID_GAME_FROM_TICKS), SEAT, BUILDER)).toEqual([]);
    const drilling = startSeat({ barracks: true });
    expect(demobilizeEarlySoldiers(drilling.world, ctxOf(drilling, drilling.tick), SEAT, BUILDER)).toEqual(
      [],
    );
  });

  it('keeps a soldier a map script addresses', () => {
    const sim = startSeat();
    const [scripted, ...rest] = soldiers(sim);
    if (scripted === undefined) throw new Error('setup: a start soldier');
    sim.world.add(scripted, MissionObjectId, { id: 1 });
    const commands = retrades(demobilizeEarlySoldiers(sim.world, ctxOf(sim, sim.tick), SEAT, BUILDER));
    expect(commands.map((c) => ('entity' in c ? c.entity : null))).toEqual(rest);
  });
});
