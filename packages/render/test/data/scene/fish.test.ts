import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildSpriteScene } from '../../../src/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';

describe('fish swarm scene items', () => {
  it('classifies a persistent FishSwarm as a fish draw item at its water position', () => {
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: 12, continent: 3, shore: 8 } })]),
    );
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({ kind: 'fish', ref: 7, swarmCount: 12 });
  });

  it("caps an overfull swarm's drawn fish at the sim's swarm maximum", () => {
    const overfull = systems.MAX_FISH_PER_SWARM + 5;
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: overfull, continent: 3, shore: 8 } })]),
    );
    expect(scene[0]?.swarmCount).toBe(systems.MAX_FISH_PER_SWARM);
  });

  it('does not draw a depleted persistent swarm', () => {
    const scene = buildSpriteScene(
      snapshotOf([entity(7, 1.5, 2, { FishSwarm: { count: 0, continent: 3, shore: 8 } })]),
    );
    expect(scene).toEqual([]);
  });
});
