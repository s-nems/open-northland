import { describe, expect, it } from 'vitest';
import { Settler, Sheltering } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { cellAnchorNode } from '../../../../src/index.js';
import { BattleFront } from '../../../../src/systems/conflict/battle-alert.js';
import type { ShelterSites } from '../../../../src/systems/defence/index.js';
import { navigationLimitFor } from '../../../../src/systems/index.js';
import { planShelter } from '../../../../src/systems/settlers/drives/shelter.js';
import { ctxOf } from '../../../fixtures/context.js';
import {
  ACROSS_CELL,
  buildingOn,
  nodeOfCell,
  ORIGIN_CELL,
  RIVER_PLAYER,
  riverSim,
  settlerOn,
  UP_THE_BANK_CELL,
} from '../../../fixtures/river-bank.js';

const WOODCUTTER = 1;
const HEADQUARTERS = 1;

describe('a civilian running for shelter', () => {
  /** The shelter a civilian on the river's east bank claims: one across the water, one up its own bank. */
  function claimed(confined: boolean): 'across' | 'upTheBank' | null {
    const { sim, terrain } = riverSim(confined);
    const across = buildingOn(sim, ACROSS_CELL, HEADQUARTERS);
    const upTheBank = buildingOn(sim, UP_THE_BANK_CELL, HEADQUARTERS);
    const site = (entity: Entity, cell: { x: number; y: number }) => {
      const anchor = cellAnchorNode(cell.x, cell.y);
      return { entity, hx: anchor.hx, hy: anchor.hy, free: 1 };
    };
    const shelters: ShelterSites = new Map([
      [RIVER_PLAYER, [site(across, ACROSS_CELL), site(upTheBank, UP_THE_BANK_CELL)]],
    ]);
    const civilian = settlerOn(sim, ORIGIN_CELL, WOODCUTTER);
    const from = cellAnchorNode(ORIGIN_CELL.x, ORIGIN_CELL.y);
    planShelter(
      sim.world,
      ctxOf(sim),
      terrain,
      civilian,
      sim.world.get(civilian, Settler),
      nodeOfCell(terrain, ORIGIN_CELL),
      from.hx,
      from.hy,
      navigationLimitFor(sim.world, sim.content, terrain, civilian),
      shelters,
      new BattleFront(sim.world, ctxOf(sim)),
    );
    const shelter = sim.world.tryGet(civilian, Sheltering)?.shelter;
    return shelter === across ? 'across' : shelter === upTheBank ? 'upTheBank' : null;
  }

  it('takes the shelter with the shorter walk, not the nearer one across a river', () => {
    expect(claimed(true)).toBe('upTheBank');
    // With no walk measured the line decides.
    expect(claimed(false)).toBe('across');
  });
});
