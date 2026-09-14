import { describe, expect, it } from 'vitest';
import {
  addPaper,
  Building,
  PAPER_SLOTS,
  type Paper,
  Papers,
  playerPaperSlots,
  Stockpile,
  takePaper,
  UnderConstruction,
} from '../../src/components/index.js';
import { ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The player's papers list (the original's special-item table) and the one thing a paper buys: a placement
 * that stands finished at once. Slot order, spending, and the placement gates the paper does and does not
 * bypass are pinned here.
 */

const P0 = 0;
const VIKING = 1;
const HQ = 1;
const SAWMILL = 2;
const WOOD = 1;
const PLANK = 2;
const SAWMILL_CAPACITY = 20;

const anyHouse: Paper = { kind: 'placeAny', param: 0 };
const sawmillPaper: Paper = { kind: 'placeHouse', param: SAWMILL };

function fresh(): Simulation {
  const sim = new Simulation({ seed: 5, content: testContent(), map: grassCellMap(16, 16) });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: P0, tribes: [VIKING] });
  return sim;
}

function buildings(sim: Simulation): Entity[] {
  return [...sim.world.query(Building)].sort((a, b) => a - b);
}

describe('the papers list', () => {
  it('fills the first hole a spent paper left, so list order survives spending', () => {
    const sim = fresh();
    const a: Paper = { kind: 'placeHouse', param: 1 };
    const b: Paper = { kind: 'placeHouse', param: 2 };
    const c: Paper = { kind: 'placeHouse', param: 3 };
    for (const p of [a, b, c]) expect(addPaper(sim.world, P0, p)).toBe(true);
    expect(takePaper(sim.world, P0, b)).toBe(true);
    expect(playerPaperSlots(sim.world, P0)).toEqual([a, null, c]);
    const d: Paper = { kind: 'learnPermit', param: 9 };
    addPaper(sim.world, P0, d);
    expect(playerPaperSlots(sim.world, P0)).toEqual([a, d, c]);
    expect(sim.papers(P0)).toEqual([a, d, c]);
  });

  it('spends the first matching slot only, and the carrier goes when the last paper is spent', () => {
    const sim = fresh();
    addPaper(sim.world, P0, anyHouse);
    addPaper(sim.world, P0, anyHouse);
    expect(takePaper(sim.world, P0, anyHouse)).toBe(true);
    expect(sim.papers(P0)).toEqual([anyHouse]);
    expect(takePaper(sim.world, P0, sawmillPaper)).toBe(false); // never held
    expect(takePaper(sim.world, P0, anyHouse)).toBe(true);
    expect(takePaper(sim.world, P0, anyHouse)).toBe(false);
    expect([...sim.world.query(Papers)]).toEqual([]);
  });

  it('holds at most PAPER_SLOTS papers per player and keeps players apart', () => {
    const sim = fresh();
    for (let i = 0; i < PAPER_SLOTS; i++) expect(addPaper(sim.world, P0, anyHouse)).toBe(true);
    expect(addPaper(sim.world, P0, anyHouse)).toBe(false);
    expect(addPaper(sim.world, 1, anyHouse)).toBe(true);
    expect(sim.papers(1)).toEqual([anyHouse]);
  });

  it('the grantPaper setup command hands a paper out', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'grantPaper', player: P0, paper: sawmillPaper });
    sim.step();
    expect(sim.papers(P0)).toEqual([sawmillPaper]);
  });
});

describe('placing with a paper', () => {
  it('a house paper stands its house finished at once and is spent', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'grantPaper', player: P0, paper: sawmillPaper });
    sim.enqueue(
      playerCommand(P0, {
        kind: 'placeBuilding',
        buildingType: SAWMILL,
        x: 8,
        y: 8,
        tribe: VIKING,
        paper: sawmillPaper,
      }),
    );
    sim.step();
    const placed = buildings(sim);
    expect(placed).toHaveLength(1);
    const e = placed[0] as Entity;
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.has(e, UnderConstruction)).toBe(false);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBeUndefined(); // no stock beyond the type's own
    expect(sim.papers(P0)).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a paper the seat does not hold, or that names another house, places nothing and spends nothing', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'grantPaper', player: P0, paper: sawmillPaper });
    const command = { kind: 'placeBuilding', x: 8, y: 8, tribe: VIKING } as const;
    sim.enqueue(playerCommand(P0, { ...command, buildingType: HQ, paper: sawmillPaper }));
    sim.enqueue(playerCommand(P0, { ...command, buildingType: SAWMILL, paper: anyHouse }));
    sim.enqueue(
      playerCommand(P0, {
        ...command,
        buildingType: SAWMILL,
        paper: { kind: 'buildPermit', param: SAWMILL },
      }),
    );
    sim.step();
    expect(buildings(sim)).toEqual([]);
    expect(sim.papers(P0)).toEqual([sawmillPaper]);
  });

  it('a stocked-house paper fills every stock slot to capacity', () => {
    const sim = fresh();
    const stocked: Paper = { kind: 'placeStockedHouse', param: SAWMILL };
    sim.enqueueSetup({ kind: 'grantPaper', player: P0, paper: stocked });
    sim.enqueue(
      playerCommand(P0, {
        kind: 'placeBuilding',
        buildingType: SAWMILL,
        x: 8,
        y: 8,
        tribe: VIKING,
        paper: stocked,
      }),
    );
    sim.step();
    const e = buildings(sim)[0] as Entity;
    const amounts = sim.world.get(e, Stockpile).amounts;
    expect(amounts.get(WOOD)).toBe(SAWMILL_CAPACITY);
    expect(amounts.get(PLANK)).toBe(SAWMILL_CAPACITY);
  });

  it('a placeAny paper spends on whatever house the seat picks', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'grantPaper', player: P0, paper: anyHouse });
    sim.enqueue(
      playerCommand(P0, {
        kind: 'placeBuilding',
        buildingType: HQ,
        x: 8,
        y: 8,
        tribe: VIKING,
        paper: anyHouse,
      }),
    );
    sim.step();
    expect(buildings(sim)).toHaveLength(1);
    expect(sim.world.get(buildings(sim)[0] as Entity, Building).built).toBe(ONE);
    expect(sim.papers(P0)).toEqual([]);
  });
});
