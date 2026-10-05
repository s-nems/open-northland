import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSettlerBobId } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  ANIMAL_BODY_IMAGELIB,
  ANIMAL_PALETTE_BY_TRIBE,
  animalBodyStem,
} from '../../src/catalog/animal-roster.js';
import { animalBinding } from '../../src/content/animal-gfx/bindings.js';
import { animalWalkVariants } from '../../src/content/animal-gfx/extras.js';
import { sequencesFor } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('additional wildlife frames in generated content', () => {
  it.each([
    [11, 'animal_deer_male_wait_1', 'idle'],
    [19, 'animal_sheep_wait', 'idle'],
    [20, 'animal_wolf_wait_normal', 'idle'],
    [25, 'animal_lion_male_walk_bak', 'moving'],
    [31, 'animal_duck_swim', 'moving'],
  ] as const)('tribe %i reaches every frame of %s without empty sprites', (tribe, name, state) => {
    const ir = rawIrUnderTest() as ContentIr;
    const sequences = sequencesFor(ir, ANIMAL_BODY_IMAGELIB);
    const binding = animalBinding(ir, tribe, sequences);
    const seq = sequences.get(name);
    const palette = ANIMAL_PALETTE_BY_TRIBE.get(tribe);
    if (binding === null || seq === undefined || palette === undefined)
      throw new Error(`missing tribe ${tribe}`);
    const atlas = JSON.parse(
      readFileSync(join(contentDir(), 'bobs', `${animalBodyStem(palette)}.atlas.json`), 'utf8'),
    ) as { frames: { bobId: number; rect: { width: number; height: number } }[] };
    const drawn = new Set(
      atlas.frames.filter((f) => f.rect.width > 0 && f.rect.height > 0).map((f) => f.bobId),
    );
    const variants = animalWalkVariants(tribe, binding, sequences) ?? [binding];
    const selected = new Set<number>();
    for (const variant of variants)
      for (let facing = 0; facing < 8; facing++)
        for (let tick = 0; tick < 400; tick++) {
          const id = resolveSettlerBobId(
            variant,
            { kind: 'settler', ref: 0, x: 0, y: 0, depth: 0, state, facing },
            tick,
            tick,
            tick,
          );
          expect(drawn.has(id), `tribe ${tribe} bob ${id}`).toBe(true);
          selected.add(id);
        }
    expect(
      Array.from({ length: seq.length }, (_, i) => seq.start + i).filter((id) => !selected.has(id)),
    ).toEqual([]);
  });
});
