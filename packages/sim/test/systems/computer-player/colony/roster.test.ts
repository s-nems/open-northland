import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../../src/ecs/world.js';
import { homeSettlers } from '../../../../src/systems/ai-shared/home-roster.js';
import { colonists } from '../../../../src/systems/computer-player/colony/roster.js';
import { editColony, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import { runningWorld } from '../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

describe('a colony', () => {
  it('counts a man listed for the line no colonist until he lands', () => {
    const { sim } = runningWorld('barracks');
    const ctx = ctxOf(sim);
    const walking = homeSettlers(sim.world, ctx, SEAT)[0] as Entity;
    const colony = editColony(sim);
    colony.rest.push(walking);
    const env = looseColonyEnv(sim, colony);
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(walking);
    expect(colonists(env)).not.toContain(walking);
  });
});
