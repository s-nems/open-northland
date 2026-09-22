import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LandscapeGfx } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { customBushBinding } from '../../../src/custom/content/bush-binding.js';
import {
  customPropManifest,
  customPropNames,
  customPropResourceBinding,
} from '../../../src/custom/content/prop-manifest.js';
import { contentDir, hasRealIr, rawIrUnderTest } from '../../content/helpers.js';

describe.runIf(hasRealIr())('own woodland content joins', () => {
  it('joins every declared slot and carries every harvestable into the live sprite binding', () => {
    const manifests = ['woodland', 'rocks', 'bushes', 'meadows', 'ferns', 'mushrooms'].flatMap((pack) => {
      const source = new URL(`../../../../../docs/art/terrain/${pack}/`, import.meta.url);
      return readdirSync(source)
        .filter((n) => n.endsWith('.runtime.json'))
        .map((file) => customPropManifest.parse(JSON.parse(readFileSync(new URL(file, source), 'utf8'))));
    });
    const ir = z.object({ landscapeGfx: z.array(LandscapeGfx) }).parse(rawIrUnderTest());
    const rows = new Map(ir.landscapeGfx.map((r) => [r.editName, r]));
    const content = {
      landscapeGfx: ir.landscapeGfx.map((row) => ({
        index: row.index,
        logicType: row.logicType,
        ...(row.editName === undefined ? {} : { editName: row.editName }),
      })),
    };
    const bushes = customBushBinding(undefined, content, manifests);
    if (typeof bushes !== 'object') throw new Error('Missing own berry bush families');
    for (const species of ['01', '02']) {
      const ripe = rows.get(`bush ${species} fruits`);
      if (!ripe) throw new Error('Missing real bush slot');
      expect(ripe.logicType).toBe(11);
      expect(bushes.byGfxIndex?.[ripe.index]).toEqual(
        ['empty', 'flower', 'fruits'].map((stage) => ({
          layer: `custom-prop-bush-${species}-${stage}`,
          bob: 0,
        })),
      );
    }
    const binding = customPropResourceBinding(99, content, manifests);
    for (const [name, m] of customPropNames(manifests)) {
      const row = rows.get(name);
      expect(row, name).toBeDefined();
      if (!row) throw new Error(`Missing ${name}`);
      if (/^(grass |fern |mushroom (?!pile))/.test(name)) {
        const atlas = JSON.parse(
          readFileSync(
            join(
              contentDir(),
              `bobs/${name.startsWith('mushroom ') ? 'ls_mushrooms' : 'ls_meadows'}.${row.paletteName}.atlas.json`,
            ),
            'utf8',
          ),
        ) as {
          frames: {
            bobId: number;
            rect: { width: number; height: number };
            offsetX: number;
            offsetY: number;
          }[];
        };
        const original = atlas.frames.find((frame) => frame.bobId === row.frames[0]?.bobIds[0]);
        if (!original) throw new Error(`Missing meadow frame for ${name}`);
        expect(m.scale).toBe(0.5);
        expect([m.width * m.scale, m.height * m.scale]).toEqual([original.rect.width, original.rect.height]);
        expect([m.anchor.x * m.scale, m.anchor.y * m.scale]).toEqual([-original.offsetX, -original.offsetY]);
      }
      if (m.kind === 'resource') {
        expect([4, 15]).toContain(row.logicType);
        expect(binding.byGfxIndex?.[row.index]).toEqual(
          Array.from({ length: m.frames?.length ?? 1 }, (_, bob) => ({ layer: `custom-prop-${m.id}`, bob })),
        );
        if (m.frames) expect(m.frames).toHaveLength(row.frames.length);
      } else {
        expect([1, 8, 9, 10, 11, 36]).toContain(row.logicType);
        expect(binding.byGfxIndex?.[row.index]).toBeUndefined();
      }
    }
    expect(customPropNames(manifests).get('beech 01')?.id).toBe('beech-a');
    expect(customPropNames(manifests).has('snow pine 01')).toBe(false);
  });
});
