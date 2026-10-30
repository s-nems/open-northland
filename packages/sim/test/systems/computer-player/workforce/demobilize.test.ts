import { describe, expect, it } from 'vitest';
import { MissionObjectId, mapBriefOf, Settler } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../src/core/loop.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import { seatTerritoryOf } from '../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import {
  DEMOBILIZE_UNTIL_TICK,
  demobilizeStartSoldiers,
  EARLY_ATTACK_BEFORE_TICKS,
  START_CORE_SOLDIERS,
} from '../../../../src/systems/computer-player/workforce/demobilize.js';
import type { MissionScript } from '../../../../src/systems/missions/index.js';
import { SUCCESSFUL_IF } from '../../../../src/systems/missions/index.js';
import {
  aiSim,
  BARRACKS_TYPE,
  BOWMAN,
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

/** A walk the map's script sends at the seat's start anchor `afterTicks` into the game. */
function attackOn(sim: Simulation, afterTicks: number): MissionScript {
  const anchor = seatTerritoryOf(mapBriefOf(sim.world), SEAT)?.anchor;
  if (anchor === undefined) throw new Error('setup: the seat has no start in the map brief');
  return {
    missions: [
      {
        successfullIf: SUCCESSFUL_IF.all,
        active: true,
        visible: false,
        goals: [{ opcode: 'TimeGone', seconds: afterTicks / TICKS_PER_SECOND }],
        results: [{ opcode: 'SendHuman', humanId: 1, point: anchor }],
      },
    ],
  };
}

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

describe('demobilizeStartSoldiers', () => {
  it("turns the seat's start soldiers into builders, who stay builders", () => {
    const sim = startSeat();
    const start = soldiers(sim);
    expect(start).toHaveLength(START_SOLDIERS);
    expect(demobilizeStartSoldiers(sim.world, ctxOf(sim, sim.tick), SEAT, BUILDER)).toEqual(
      start.map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })),
    );
    sim.run(SETTLE_TICKS);
    expect(soldiers(sim)).toEqual([]);
    for (const e of start) expect(sim.world.get(e, Settler).jobType).not.toBe(SPEARMAN);
  });

  it('leaves the soldiers alone once the start window closes or a barracks stands', () => {
    const sim = startSeat();
    expect(demobilizeStartSoldiers(sim.world, ctxOf(sim, DEMOBILIZE_UNTIL_TICK), SEAT, BUILDER)).toEqual([]);
    const drilling = startSeat({ barracks: true });
    expect(demobilizeStartSoldiers(drilling.world, ctxOf(drilling, drilling.tick), SEAT, BUILDER)).toEqual(
      [],
    );
  });

  it('keeps a soldier a map script addresses', () => {
    const sim = startSeat();
    const [scripted, ...rest] = soldiers(sim);
    if (scripted === undefined) throw new Error('setup: a start soldier');
    sim.world.add(scripted, MissionObjectId, { id: 1 });
    const commands = retrades(demobilizeStartSoldiers(sim.world, ctxOf(sim, sim.tick), SEAT, BUILDER));
    expect(commands.map((c) => ('entity' in c ? c.entity : null))).toEqual(rest);
  });

  it('keeps an armed core, archers first, when a scripted attack is forecast early', () => {
    const sim = startSeat();
    spawnMen(sim, START_CORE_SOLDIERS, BOWMAN);
    sim.step();
    const spearmen = soldiers(sim);
    const archers = ownedSettlers(sim.world, SEAT).filter(
      (e) => sim.world.get(e, Settler).jobType === BOWMAN,
    );
    const early = { ...ctxOf(sim, sim.tick), missions: attackOn(sim, EARLY_ATTACK_BEFORE_TICKS / 2) };
    const retraded = retrades(demobilizeStartSoldiers(sim.world, early, SEAT, BUILDER));
    // Every spearman goes to the sites; the archers fill the core.
    expect(retraded.map((c) => ('entity' in c ? c.entity : null))).toEqual(spearmen);
    expect(archers).toHaveLength(START_CORE_SOLDIERS);
    const late = { ...ctxOf(sim, sim.tick), missions: attackOn(sim, 2 * EARLY_ATTACK_BEFORE_TICKS) };
    expect(retrades(demobilizeStartSoldiers(sim.world, late, SEAT, BUILDER))).toHaveLength(
      START_SOLDIERS + START_CORE_SOLDIERS,
    );
  });
});
