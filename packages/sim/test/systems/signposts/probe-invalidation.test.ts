import { describe, expect, it } from 'vitest';
import { stampOwner } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';
import { stampPost } from './support.js';

/**
 * The signpost placement probe (`Simulation.signpostProbe`) reads the current signpost network, and a
 * post can change hands without rising or falling: after that, the probe must answer for the world as it
 * stands.
 */

const P0 = 0;
const P1 = 1;

describe('signpostProbe after a post changes hands', () => {
  it('measures the spacing against the posts each player holds now', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 2) });
    const post = stampPost(sim, 10, 0, P0);
    // Two tiles east: inside the 16-node spacing of the post, whoever holds it.
    const NEAR = { x: 24, y: 0 };
    const overlayKey = sim.signpostBlockerVersion();
    // The receiver asks on both sides of the handover, as its overlay and its AI scout do.
    expect(sim.signpostProbe(P1)?.canPlace(NEAR.x, NEAR.y)).toBe(true);

    stampOwner(sim.world, post, P1);

    expect(sim.signpostProbe(P1)?.canPlace(NEAR.x, NEAR.y)).toBe(false);
    expect(sim.signpostProbe(P0)?.canPlace(NEAR.x, NEAR.y)).toBe(true);
    expect(sim.signpostBlockerVersion()).not.toBe(overlayKey);
  });
});
