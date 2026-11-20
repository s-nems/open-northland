import { components, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../../../src/game/sandbox/content/index.js';
import { spawnMapResources, spawnVariantLandscapeObjects } from '../../../src/game/sandbox/map-spawn.js';
import { MINES, mineFixture } from '../../support/mine-deposit.js';

const { Resource, MineDeposit } = components;

describe('a deposit yield', () => {
  it('multiplies a boosted good by its factor, shrink ladder included, and no other good', () => {
    const factor = 3;
    const gold = MINES.find((mine) => mine.id === 'gold');
    if (gold === undefined) throw new Error('missing gold fixture');
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { objects, ir } = mineFixture(gold.id, gold.logicType, gold.states);

    spawnMapResources(sim, objects, ir, { [gold.id]: factor, stone: factor * factor });

    const spawned = [...sim.world.query(Resource)].map((e) => ({
      remaining: sim.world.get(e, Resource).remaining,
      initial: sim.world.get(e, MineDeposit).initial,
    }));
    expect(spawned).toEqual(
      Array.from({ length: gold.states }, (_, i) => ({
        remaining: (i + 1) * factor,
        initial: gold.states * factor,
      })),
    );
  });

  it('places a variant’s own object full-grown and boosted like a map placement, and refuses an unworked one', () => {
    const factor = 3;
    const gold = MINES.find((mine) => mine.id === 'gold');
    if (gold === undefined) throw new Error('missing gold fixture');
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const { objects, ir } = mineFixture(gold.id, gold.logicType, gold.states);
    const object = objects.types[0] ?? '';

    const [node] = spawnVariantLandscapeObjects(sim, ir, [{ object, hx: 20, hy: 8 }], { [gold.id]: factor });
    if (node === undefined) throw new Error('nothing placed');
    expect(sim.world.get(node, Resource).remaining).toBe(gold.states * factor);
    expect(sim.world.get(node, MineDeposit).initial).toBe(gold.states * factor);
    expect(() => spawnVariantLandscapeObjects(sim, ir, [{ object: 'fern 01', hx: 20, hy: 12 }], {})).toThrow(
      /fern 01/,
    );
  });
});
