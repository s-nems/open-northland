import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../src/index.js';
import { homeBuildings, homeSettlers } from '../../../src/systems/ai-shared/home-roster.js';
import { ownedBuildings, ownedSettlers } from '../../../src/systems/ai-shared/seat-roster.js';
import { homeStockOf } from '../../../src/systems/computer-player/colony/stock.js';
import { seatStockOf } from '../../../src/systems/stores/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

const SEAT = 0;

describe('the home view of a seat with no colony', () => {
  it('hands back the shared rosters and stock object themselves', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const ctx = ctxOf(sim);
    expect(homeBuildings(sim.world, ctx, SEAT)).toBe(ownedBuildings(sim.world, SEAT));
    expect(homeSettlers(sim.world, ctx, SEAT)).toBe(ownedSettlers(sim.world, SEAT));
    expect(homeStockOf(sim.world, ctx, SEAT)).toBe(seatStockOf(sim.world, SEAT));
  });
});
