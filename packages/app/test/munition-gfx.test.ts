import type { ParticleGfx } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import {
  buildMunitionBinding,
  munitionAtlasStems,
  resolveMunitionRefs,
} from '../src/content/munition-gfx.js';

const ARROW = 1;
const ROCK = 2;
const SMOKE_BMD = 'data/engine2d/bin/bobs/ls_smoke.bmd';

function particle(index: number, fields: Partial<ParticleGfx> & Pick<ParticleGfx, 'name'>): ParticleGfx {
  return { index, frames: [], loop: false, valencyIsDirection: false, ...fields };
}

/** The shipped records' shape: an arrow that spawns itself, a rock trailing its own puff, the landing
 *  smoke, and an artless snowball. */
const ir: ContentIr = {
  particles: [
    particle(0, {
      name: 'arrow',
      bmd: 'data/engine2d/bin/bobs/test_arrow.bmd',
      paletteName: 'rock01',
      frames: [
        { valency: 0, bobIds: [0] },
        { valency: 1, bobIds: [1] },
      ],
      loop: true,
      valencyIsDirection: true,
      munitionType: ARROW,
      spawnParticle: 0,
    }),
    particle(1, {
      name: 'Smoke.org',
      bmd: SMOKE_BMD,
      paletteName: 'smoke',
      frames: [{ valency: 0, bobIds: [187, 188] }],
    }),
    particle(2, {
      name: 'Rock',
      bmd: SMOKE_BMD,
      paletteName: 'rock03',
      frames: [{ valency: 0, bobIds: [212, 213] }],
      loop: true,
      munitionType: ROCK,
      spawnParticle: 3,
    }),
    particle(3, {
      name: 'Rock Smoke',
      bmd: SMOKE_BMD,
      paletteName: 'smoke',
      frames: [{ valency: 0, bobIds: [4, 3] }],
    }),
    particle(4, { name: 'snow ball', munitionType: 3, frames: [{ valency: 0, bobIds: [1] }] }),
  ],
};

describe('munition sprites', () => {
  it('binds each munition to its particle, its trail to the spawned record and the landing smoke by name', () => {
    const refs = resolveMunitionRefs(ir);
    expect(refs.byMunition[ARROW]).toEqual({
      layer: 'test_arrow.rock01',
      valencies: [[0], [1]],
      loop: true,
      directional: true,
    });
    expect(refs.byMunition[ROCK]?.layer).toBe('ls_smoke.rock03');
    expect(refs.byMunition[3]).toBeUndefined(); // no art
    expect(refs.trailByMunition[ROCK]?.valencies).toEqual([[4, 3]]);
    expect(refs.trailByMunition[ARROW]).toBeUndefined(); // an arrow spawning itself leaves no trail
    expect(refs.impactSmoke?.valencies).toEqual([[187, 188]]);
    // The spawned record is named by its index, not its place in the list.
    const shuffled = resolveMunitionRefs({ particles: [...(ir.particles ?? [])].reverse() });
    expect(shuffled.trailByMunition[ROCK]?.valencies).toEqual([[4, 3]]);
    expect(shuffled.trailByMunition[ARROW]).toBeUndefined();
    expect([...munitionAtlasStems(refs)].sort()).toEqual([
      'ls_smoke.rock03',
      'ls_smoke.smoke',
      'test_arrow.rock01',
    ]);
  });

  it('keeps only the sprites whose atlas loaded, and binds nothing without a shot sprite', () => {
    const refs = resolveMunitionRefs(ir);
    const binding = buildMunitionBinding(refs, new Set(['ls_smoke.rock03']));
    expect(Object.keys(binding?.byMunition ?? {})).toEqual([String(ROCK)]);
    expect(binding?.trailByMunition).toEqual({});
    expect(binding?.impactSmoke).toBeUndefined();
    expect(buildMunitionBinding(refs, new Set(['ls_smoke.smoke']))).toBeUndefined();
    expect(buildMunitionBinding(resolveMunitionRefs(null), new Set())).toBeUndefined();
  });
});
