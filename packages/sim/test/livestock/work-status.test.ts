import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/world.js';
import { BREEDING_PAIR } from '../../src/systems/economy/production.js';
import { breederAt, COW_GOOD, cowAt, farmAt, HERD_CAPACITY, livestockSim, WATER, WHEAT } from './support.js';

const P0 = 0;
const FARM_AT = { hx: 20, hy: 20 } as const;
/** Enough of both breeding inputs for a cycle. */
const STOCKED: Array<[number, number]> = [
  [WATER, 2],
  [WHEAT, 4],
];
/** The wheat one breeding cycle takes (the fixture recipe's two). */
const WHEAT_PER_CYCLE = 2;

/** A farm with a breeder bound to it and `adults` grown cows plus `young` calves in its herd. */
function breederWithHerd(
  stock: Array<[number, number]>,
  adults: number,
  young = 0,
): { sim: ReturnType<typeof livestockSim>; breeder: Entity } {
  const sim = livestockSim();
  const farm = farmAt(sim, FARM_AT.hx, FARM_AT.hy, { owner: P0, stock });
  const breeder = breederAt(sim, FARM_AT.hx, FARM_AT.hy, farm);
  for (let i = 0; i < adults; i++) cowAt(sim, FARM_AT.hx + 2 + i, FARM_AT.hy, { owner: P0, farm });
  for (let i = 0; i < young; i++)
    cowAt(sim, FARM_AT.hx, FARM_AT.hy + 2 + i, { owner: P0, farm, young: true });
  return { sim, breeder };
}

describe('Simulation.workStatus - why a breeder does not breed', () => {
  it('names the missing animals, not the water and wheat, for a farm with none', () => {
    const { sim, breeder } = breederWithHerd([], 0);
    expect(sim.workStatus(breeder)).toEqual({
      kind: 'herdNotReady',
      goodType: COW_GOOD,
      wait: 'noAnimals',
      adults: 0,
      young: 0,
    });
  });

  it('names a lone animal short of the breeding pair, even with the inputs stocked', () => {
    const { sim, breeder } = breederWithHerd(STOCKED, 1);
    expect(sim.workStatus(breeder)).toEqual({
      kind: 'herdNotReady',
      goodType: COW_GOOD,
      wait: 'tooFew',
      adults: 1,
      young: 0,
    });
  });

  it('holds no partly stocked input for a herd short of the pair', () => {
    const { sim, breeder } = breederWithHerd([[WHEAT, 1]], 1);
    expect(sim.workStatus(breeder)?.kind).toBe('herdNotReady');
  });

  it('waits for the young to grow when the herd only lacks grown animals', () => {
    const { sim, breeder } = breederWithHerd(STOCKED, 1, 1);
    expect(sim.workStatus(breeder)).toMatchObject({ kind: 'herdNotReady', wait: 'youngGrowing' });
  });

  it('waits on a full herd rather than a full shelf', () => {
    const { sim, breeder } = breederWithHerd(STOCKED, BREEDING_PAIR, HERD_CAPACITY - BREEDING_PAIR);
    expect(sim.workStatus(breeder)).toMatchObject({ kind: 'herdNotReady', wait: 'herdFull' });
  });

  it('names the water a standing pair waits for', () => {
    const { sim, breeder } = breederWithHerd([[WHEAT, WHEAT_PER_CYCLE]], BREEDING_PAIR);
    expect(sim.workStatus(breeder)).toMatchObject({
      kind: 'waitingInput',
      goodType: COW_GOOD,
      missingInputs: [{ goodType: WATER, required: 1, available: 0, missing: 1 }],
    });
  });

  it('reports nothing in the way while grown animals past the pair await slaughter', () => {
    const { sim, breeder } = breederWithHerd([], BREEDING_PAIR + 1);
    expect(sim.workStatus(breeder)).toBeUndefined();
  });
});
