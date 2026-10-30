import { describe, expect, it } from 'vitest';
import { aiControlEntity, ComputerStrategy } from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import type {
  BuildOrder,
  BuildOrderEntry,
} from '../../../../src/systems/computer-player/build-order/entries.js';
import {
  decisionMemo,
  entryStatuses,
  lineStatuses,
  stepHeld,
} from '../../../../src/systems/computer-player/build-order/progress.js';
import {
  ASSUMED_PEACE_TICKS,
  TOWER_LEAD_TICKS,
} from '../../../../src/systems/computer-player/military/deadline.js';
import {
  aiSim,
  ctxOf,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  IRON,
  makeAiSeat,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  VIKING,
} from '../support.js';

function seat(ironStock = 0, ironOnMap = true): Simulation {
  const sim = aiSim();
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    initialGoods: [{ good: IRON, amount: ironStock }],
  });
  if (ironOnMap) placeResources(sim, [RESOURCE_SPOTS.iron]);
  makeAiSeat(sim, SEAT, { houseBuild: false });
  sim.step();
  return sim;
}

function towersDue(leadTicks: number): BuildOrderEntry {
  return { kind: 'towerCoverage', building: 'tower_01', holdUntil: { kind: 'deadline', leadTicks } };
}

function held(sim: Simulation, entry: BuildOrderEntry, order: BuildOrder = oneStep(entry)): boolean {
  const ctx = ctxOf(sim);
  const owned = ownedBuildings(sim.world, SEAT);
  const memo = decisionMemo();
  const statuses = lineStatuses(sim.world, ctx, SEAT, owned, order, memo);
  return stepHeld(sim.world, ctx, SEAT, owned, order, statuses, entry, memo);
}

function oneStep(entry: BuildOrderEntry): BuildOrder {
  return { lines: [{ id: 'military', steps: [entry] }], priority: [] };
}

describe('build order progress', () => {
  it('holds a military step until its lead before the deadline, or until the defence comes first', () => {
    const sim = seat();
    expect(held(sim, towersDue(TOWER_LEAD_TICKS))).toBe(true);
    // A seat outside a lobby peace plans for the assumed one, so a lead that long has come.
    expect(held(sim, towersDue(ASSUMED_PEACE_TICKS))).toBe(false);

    const ended = seat();
    ended.enqueueSetup({ kind: 'setPeaceTime', untilTick: ended.tick, players: [SEAT] });
    ended.step();
    expect(held(ended, towersDue(TOWER_LEAD_TICKS))).toBe(false);

    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: no AI seat');
    const strategy = sim.world.mut(carrier, ComputerStrategy);
    strategy.military = { ...strategy.military, posture: 'defend', evidence: ['underAttack'] };
    expect(held(sim, towersDue(TOWER_LEAD_TICKS))).toBe(false);
  });

  it('lets a step held on a building act once the order can never raise that building', () => {
    const brewery: BuildOrderEntry = {
      kind: 'place',
      building: 'work_brewery',
      count: 1,
      needsResources: ['iron'],
    };
    const after: BuildOrderEntry = {
      kind: 'place',
      building: 'work_well_00',
      count: 1,
      holdUntil: { kind: 'built', building: 'work_brewery' },
    };
    const order: BuildOrder = {
      lines: [
        { id: 'brewery', steps: [brewery] },
        { id: 'coins', steps: [after] },
      ],
      priority: [],
    };
    // With iron on the map the brewery may still come; with none its only step is skipped for good.
    expect(held(seat(), after, order)).toBe(true);
    expect(held(seat(0, false), after, order)).toBe(false);
  });

  it('passes a collector over while its good lies stocked, hiring again under half of it', () => {
    const STOCKED = 10;
    const gatherer: BuildOrderEntry = { kind: 'collector', good: 'iron', stockedAt: STOCKED };
    const status = (stock: number) => {
      const sim = seat(stock);
      return entryStatuses(sim.world, ctxOf(sim), SEAT, [gatherer])[0];
    };
    expect(status(STOCKED)).toBe('skip');
    expect(status(STOCKED / 2)).toBe('skip');
    expect(status(STOCKED / 2 - 1)).toBe('unmet');
  });
});
