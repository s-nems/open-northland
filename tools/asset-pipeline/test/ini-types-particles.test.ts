import { describe, expect, it } from 'vitest';
import {
  extractParticleGraphics,
  extractParticles,
  extractWeapons,
  parseIniSections,
} from '../src/decoders/ini.js';

// Mirrors `particel.cif`: both header spellings, a looped munition with a trail, the trail itself, a
// one-shot puff, and an artless record that still holds its slot.
const PARTICLES_INI = `[Particel]
name "Smoke.org"
palette "smoke"
bobmanager "data\\engine2d\\bin\\bobs\\ls_smoke.bmd"
maxvalency 1
gfxframes 0 187 188 189
animloop 0
bobtype 2
[particel]
name "Rock"
palette "rock03"
bobmanager "data\\engine2d\\bin\\bobs\\ls_smoke.bmd"
maxvalency 1
gfxframes 0 212 213 214
animloop 1
bobtype 2
munitiontype 2
spawnparticelId 2
[Particel]
name "Rock Smoke"
palette "smoke"
bobmanager "data\\engine2d\\bin\\bobs\\ls_smoke.bmd"
gfxframes 0 4 3 2 1 0
[particel]
name "snow ball"
munitiontype 3
maxvalency 32
gfxframes 0 1
valencyisdirection 1
`;

const SRC = { file: 'Data/engine2d/inis/particel/particel.cif', layer: 'base' } as const;

describe('extractParticles', () => {
  it('keeps every record in its slot, with frames, loop, munition and trail', () => {
    const particles = extractParticles(parseIniSections(PARTICLES_INI), SRC);
    expect(particles.map((p) => [p.index, p.name])).toEqual([
      [0, 'Smoke.org'],
      [1, 'Rock'],
      [2, 'Rock Smoke'],
      [3, 'snow ball'],
    ]);
    expect(particles[1]).toMatchObject({
      bmd: 'data/engine2d/bin/bobs/ls_smoke.bmd',
      paletteName: 'rock03',
      frames: [{ valency: 0, bobIds: [212, 213, 214] }],
      loop: true,
      valencyIsDirection: false,
      munitionType: 2,
      spawnParticle: 2,
    });
    expect(particles[2]?.frames).toEqual([{ valency: 0, bobIds: [4, 3, 2, 1, 0] }]);
    expect(particles[3]).toMatchObject({ bmd: undefined, munitionType: 3, valencyIsDirection: true });
  });

  it('binds the atlases the records with art draw from', () => {
    const bindings = extractParticleGraphics(parseIniSections(PARTICLES_INI));
    expect(bindings.map((b) => `${b.bmd} ${b.paletteName}`)).toEqual([
      'data/engine2d/bin/bobs/ls_smoke.bmd smoke',
      'data/engine2d/bin/bobs/ls_smoke.bmd rock03',
      'data/engine2d/bin/bobs/ls_smoke.bmd smoke',
    ]);
  });
});

describe('weapon impact smoke', () => {
  it('reads smokelifetime only where createsmoke is set', () => {
    const weapons = extractWeapons(
      parseIniSections(`[weapontype]
type 21
name "catapult"
munitiontype 2
createsmoke 1
smokelifetime 20
[weapontype]
type 22
name "sling"
smokelifetime 30
`),
      { file: 'DataCnmd/types/weapons.ini', layer: 'mod' },
    );
    expect(weapons.map((w) => w.impactSmokeTicks)).toEqual([20, undefined]);
  });
});
