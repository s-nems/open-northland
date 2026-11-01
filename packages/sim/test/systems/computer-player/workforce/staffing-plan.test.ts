import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { setStockAmount } from '../../../../src/components/index.js';
import { contentIndex } from '../../../../src/core/content-index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { AI_PROFILES } from '../../../../src/systems/computer-player/difficulty.js';
import { gamePhase } from '../../../../src/systems/computer-player/game-phase.js';
import { DEFAULT_BUILD_ORDER, supplyLines } from '../../../../src/systems/computer-player/index.js';
import { buildingStaffing } from '../../../../src/systems/computer-player/workforce/staffing-plan.js';
import { SeatSupply } from '../../../../src/systems/computer-player/workforce/supply.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  aiSim,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_Y,
  JOINERY_TYPE,
  MILLER,
  placeHq,
  SEAT,
  VIKING,
  WOOD,
} from '../support.js';

/** Free fixture slots for the lower pottery's goods. */
const BRICK = 26;
const TILE = 27;
/** The joinery's bill per material, so both goods carry supply lines. */
const MATERIAL_BILL_UNITS = 3;

/** The fixture joinery recast as the lower pottery, bricks and tiles from wood, with the tile gated behind
 *  a trade nobody of the seat holds while `tileUnearned`. */
function potteryContent(tileUnearned: boolean): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: BRICK, id: 'brick', weight: 1 },
      { typeId: TILE, id: 'tile', weight: 1 },
    ],
    buildings: base.buildings.map((b) =>
      b.typeId === JOINERY_TYPE
        ? {
            ...b,
            id: 'work_pottery_00',
            recipes: [BRICK, TILE].map((good) => ({
              inputs: [{ goodType: WOOD, amount: 1 }],
              outputs: [{ goodType: good, amount: 1 }],
              ticks: 180,
            })),
            construction: [
              { goodType: BRICK, amount: MATERIAL_BILL_UNITS },
              { goodType: TILE, amount: MATERIAL_BILL_UNITS },
            ],
          }
        : b,
    ),
    tribes: base.tribes.map((t) =>
      t.typeId !== VIKING || !tileUnearned
        ? t
        : { ...t, jobEnables: [...t.jobEnables, { jobType: MILLER, kind: 'good' as const, targetId: TILE }] },
    ),
  });
}

/** The lower pottery's operators, worked by one potter, with bricks and tiles in store at their glut. */
function potteryOperators(tileUnearned: boolean): number | undefined {
  const content = potteryContent(tileUnearned);
  const sim = aiSim(1, content);
  placeHq(sim);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: JOINERY_TYPE,
    x: 40,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
  });
  sim.step();
  const ctx = { ...ctxOf(sim), content };
  const lines = supplyLines(content, DEFAULT_BUILD_ORDER, gamePhase(ctx.tick));
  const hq = entityOfBuilding(sim, HQ_TYPE);
  for (const good of [BRICK, TILE]) {
    const glut = lines.get(good)?.glut;
    if (glut === undefined) throw new Error('setup: bricks and tiles take lines');
    setStockAmount(sim.world, hq, good, glut);
  }
  const owned = ownedBuildings(sim.world, SEAT);
  const supply = SeatSupply.of(sim.world, ctx, SEAT, owned, DEFAULT_BUILD_ORDER);
  const seat = { player: SEAT, owned, supply, profile: AI_PROFILES.hard };
  const type = contentIndex(content).buildings.get(JOINERY_TYPE);
  if (type === undefined) throw new Error('setup: no pottery type');
  const pottery = entityOfBuilding(sim, JOINERY_TYPE);
  return buildingStaffing(sim.world, ctx, seat, pottery, type, { operators: 1, carriers: 0 })?.operatorTarget;
}

describe('buildingStaffing', () => {
  it('keeps the potter at work with his goods at glut until the tile is discovered, and rests him after', () => {
    expect(potteryOperators(true)).toBe(1);
    expect(potteryOperators(false)).toBe(0);
  });
});
