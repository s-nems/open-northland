import { describe, expect, it } from 'vitest';
import { addPaper, type Paper, setMapPermission } from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { BuildOrderEntry } from '../../../../src/systems/computer-player/index.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  ctxOf,
  FARM_TYPE,
  HOME_TOP_TYPE,
  HOME_TYPE,
  HQ_X,
  HQ_Y,
  oneLine,
  placeHq,
  SEAT,
  STOCK_TYPE,
  VIKING,
} from '../support.js';

const BAKERY: BuildOrderEntry = { kind: 'place', building: 'work_bakery_00', count: 1 };
const HOME: BuildOrderEntry = { kind: 'place', building: 'home_level_00', count: 1 };
const ANY: Paper = { kind: 'placeAny', param: 0 };
const STORE_RADIUS = 20;
/** Past the store radius, within the seat's build reach. */
const FAR_WORKPLACE_NODES = 30;
/** A store lane at a tier above the paper's, opening past any test's clock. */
const LATE_STORE_LANE: BuildOrderEntry = {
  kind: 'storeCoverage',
  building: 'stock_02',
  radius: STORE_RADIUS,
  lane: true,
  fromTick: Number.MAX_SAFE_INTEGER,
};

/** The seat's placement this decision, holding `papers`, with `ban` locked. */
function placement(
  steps: readonly BuildOrderEntry[],
  papers: readonly Paper[],
  ban?: number,
): Extract<Command, { kind: 'placeBuilding' }> | undefined {
  const sim = aiSim(1);
  placeHq(sim);
  sim.step();
  for (const paper of papers) addPaper(sim.world, SEAT, paper);
  if (ban !== undefined)
    setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'house', typeId: ban, allowed: false });
  const commands: readonly Command[] = buildOrderModule(oneLine(steps)).run(sim.world, ctxOf(sim), SEAT);
  const placed = commands.find((c) => c.kind === 'placeBuilding');
  return placed?.kind === 'placeBuilding' ? placed : undefined;
}

describe('a computer seat spends the building papers it holds', () => {
  it('spends a paper naming the building its step raises', () => {
    const paper: Paper = { kind: 'placeHouse', param: BAKERY_TYPE };
    const placed = placement([BAKERY], [paper], BAKERY_TOP_TYPE);
    expect(placed?.buildingType).toBe(BAKERY_TYPE);
    expect(placed?.paper).toEqual(paper);
  });

  it('raises the higher tier a paper names over the locked tier it would have chosen', () => {
    const paper: Paper = { kind: 'placeHouse', param: BAKERY_TOP_TYPE };
    const placed = placement([BAKERY], [paper], BAKERY_TOP_TYPE);
    expect(placed?.buildingType).toBe(BAKERY_TOP_TYPE);
    expect(placed?.paper).toEqual(paper);
  });

  it('keeps a paper naming another building', () => {
    const placed = placement([BAKERY], [{ kind: 'placeHouse', param: HOME_TYPE }]);
    expect(placed?.buildingType).toBe(BAKERY_TOP_TYPE);
    expect(placed?.paper).toBeUndefined();
  });

  // Every fixture tier costs the same, so the three-tier home chain holds the dearest merged bill.
  it('keeps an any-building paper for the dearest building its order raises', () => {
    const bakery = placement([BAKERY, HOME], [ANY]);
    expect(bakery?.buildingType).toBe(BAKERY_TOP_TYPE);
    expect(bakery?.paper).toBeUndefined();
    const home = placement([HOME], [ANY]);
    expect(home?.buildingType).toBe(HOME_TOP_TYPE);
    expect(home?.paper).toEqual(ANY);
  });

  it('places a papered step at once, whatever holds it back', () => {
    const paper: Paper = { kind: 'placeHouse', param: BAKERY_TYPE };
    const held: BuildOrderEntry = { ...BAKERY, holdUntil: { kind: 'tick', tick: Number.MAX_SAFE_INTEGER } };
    const placed = placement([held], [paper], BAKERY_TYPE);
    expect(placed?.buildingType).toBe(BAKERY_TYPE);
    expect(placed?.paper).toEqual(paper);
  });

  it('walks a line only up to its first unmet step no paper covers', () => {
    const paper: Paper = { kind: 'placeHouse', param: BAKERY_TYPE };
    const held: BuildOrderEntry = { ...BAKERY, holdUntil: { kind: 'tick', tick: Number.MAX_SAFE_INTEGER } };
    const placed = placement([HOME, held], [paper]);
    expect(placed?.buildingType).not.toBe(BAKERY_TYPE);
    expect(placed?.paper).toBeUndefined();
  });

  it('walks past an unpapered step its line passes over while locked', () => {
    const paper: Paper = { kind: 'placeHouse', param: BAKERY_TYPE };
    const placed = placement([{ ...HOME, lockPasses: true }, BAKERY], [paper]);
    expect(placed?.buildingType).toBe(BAKERY_TYPE);
    expect(placed?.paper).toEqual(paper);
  });

  it('raises a warehouse paper where the store coverage is short, long before its step opens', () => {
    const sim = aiSim(1);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: FARM_TYPE,
      tribe: VIKING,
      x: HQ_X + FAR_WORKPLACE_NODES,
      y: HQ_Y,
      owner: SEAT,
      force: true,
    });
    sim.step();
    const paper: Paper = { kind: 'placeHouse', param: STOCK_TYPE };
    addPaper(sim.world, SEAT, paper);
    const module = buildOrderModule(oneLine([LATE_STORE_LANE]));
    const placed = module.run(sim.world, ctxOf(sim), SEAT).find((c) => c.kind === 'placeBuilding');
    expect(placed).toMatchObject({ buildingType: STOCK_TYPE, paper });
  });

  it('keeps a warehouse paper while every workplace stands near a store', () => {
    const sim = aiSim(1);
    placeHq(sim);
    sim.step();
    addPaper(sim.world, SEAT, { kind: 'placeHouse', param: STOCK_TYPE });
    const commands = buildOrderModule(oneLine([LATE_STORE_LANE])).run(sim.world, ctxOf(sim), SEAT);
    expect(commands.filter((c) => c.kind === 'placeBuilding')).toEqual([]);
  });
});
