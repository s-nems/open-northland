import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { aiControlEntity, SeatRoom, Stockpile } from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import { homeBuildings } from '../../../../src/systems/ai-shared/home-roster.js';
import { filledTowersWait } from '../../../../src/systems/computer-player/build-order/filled-towers.js';
import { FIT_PER_HOME } from '../../../../src/systems/computer-player/build-order/room.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  aiSim,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  makeAiSeat,
  placeHq,
  RESOURCE_SPOTS,
  SEAT,
} from '../support.js';

const STONE = RESOURCE_SPOTS.stone.good;
const WOOD = RESOURCE_SPOTS.wood.good;
const LOWER_TOWER_TYPE = 99;
const TOWER_STONE = 6;
const TOWER_WOOD = 2;

const base = aiContent();
const content = parseContentSet({
  ...base,
  buildings: [
    ...base.buildings,
    {
      typeId: LOWER_TOWER_TYPE,
      id: 'tower_00',
      kind: 'tower',
      construction: [
        { goodType: STONE, amount: TOWER_STONE },
        { goodType: WOOD, amount: TOWER_WOOD },
      ],
    },
  ],
});

/** A seat whose last review saw `freeZones` and whose base stores `stone` and `wood`. */
function seat(freeZones: number, stone: number, wood: number): Simulation {
  const sim = aiSim(1, content);
  placeHq(sim);
  makeAiSeat(sim, SEAT);
  sim.step();
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: an AI seat');
  sim.world.add(carrier, SeatRoom, { freeZones, homes: 0, reviewTick: Number.MAX_SAFE_INTEGER });
  const hq = entityOfBuilding(sim, HQ_TYPE);
  if (sim.world.has(hq, Stockpile)) sim.world.remove(hq, Stockpile);
  sim.world.add(hq, Stockpile, {
    amounts: new Map([
      [STONE, stone],
      [WOOD, wood],
    ]),
  });
  return sim;
}

function waits(sim: Simulation): boolean {
  const ctx = { ...ctxOf(sim, sim.tick), content };
  return filledTowersWait(sim.world, ctx, SEAT, homeBuildings(sim.world, ctx, SEAT));
}

describe('filled towers', () => {
  it('wait while a home still fits, then go up from the stone and wood the store spares', () => {
    expect(waits(seat(FIT_PER_HOME, TOWER_STONE, TOWER_WOOD))).toBe(true);
    expect(waits(seat(0, TOWER_STONE, TOWER_WOOD))).toBe(false);
    expect(waits(seat(0, TOWER_STONE - 1, TOWER_WOOD))).toBe(true);
  });
});
