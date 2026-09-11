import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ownPropAtlas,
  ownPropFrameIndex,
  ownPropManifest,
  ownPropNames,
  ownPropResourceBinding,
  ownPropStumpBinding,
} from '../src/content/own-assets/prop-manifest.js';

const sources = ['woodland', 'rocks', 'bushes', 'meadows', 'ferns', 'mushrooms'].map(
  (pack) => new URL(`../../../docs/art/terrain/${pack}/`, import.meta.url),
);
const entries = sources.flatMap((source) =>
  readdirSync(source)
    .filter((n) => n.endsWith('.runtime.json'))
    .map((file) => ({
      source,
      manifest: ownPropManifest.parse(JSON.parse(readFileSync(new URL(file, source), 'utf8'))),
    })),
);
const manifests = entries.map((e) => e.manifest);

describe('own woodland props', () => {
  it('keeps separate grey and khaki palettes through every depletion frame', () => {
    const names = ownPropNames(manifests);
    for (const number of ['01', '02', '03', '04', '05', '07', '08', '13']) {
      for (const suffix of ['', ' rest']) {
        const grey = names.get(`stones ${number} grey${suffix}`);
        const khaki = names.get(`stones ${number} khaki${suffix}`);
        if (!grey || !khaki) throw new Error('Missing rock palette pair');
        expect(grey.id).not.toBe(khaki.id);
        expect(grey.frames).toEqual(khaki.frames);
        expect(grey.scale).toBe(khaki.scale);
        const pack = new URL('../../../docs/art/terrain/rocks/', import.meta.url);
        const darkBytes = readFileSync(new URL(grey.image, pack));
        const lightBytes = readFileSync(new URL(khaki.image, pack));
        expect(darkBytes.equals(lightBytes)).toBe(false);
        if (grey.kind === 'resource') {
          const binding = ownPropResourceBinding(
            99,
            {
              landscapeGfx: [
                { index: 1, logicType: 15, editName: `stones ${number} grey` },
                { index: 2, logicType: 15, editName: `stones ${number} khaki` },
              ],
            },
            manifests,
          );
          for (const [index, prop] of [
            [1, grey],
            [2, khaki],
          ] as const) {
            expect(binding.byGfxIndex?.[index]).toEqual(
              prop.frames?.map((_, bob) => ({ layer: `own-prop-${prop.id}`, bob })),
            );
          }
        }
      }
    }
  });

  it('ships RGBA exports with matching geometry and ground anchors', () => {
    expect(manifests).toHaveLength(94);
    for (const { source, manifest: m } of entries) {
      const bytes = readFileSync(new URL(m.image, source));
      const delivered = new URL(`../src/assets/own/props/${m.id}/`, import.meta.url);
      expect(readFileSync(new URL(m.image, delivered)).equals(bytes)).toBe(true);
      expect(
        ownPropManifest.parse(JSON.parse(readFileSync(new URL('runtime.json', delivered), 'utf8'))),
      ).toEqual(m);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([m.width, m.height]);
      expect(bytes[25]).toBe(6);
      const frame = ownPropAtlas(m).frames.get(0);
      expect(frame).toBeDefined();
      expect((frame?.offsetX ?? 0) + (m.frames?.[0]?.anchor.x ?? m.anchor.x)).toBe(0);
      expect((frame?.offsetY ?? 0) + (m.frames?.[0]?.anchor.y ?? m.anchor.y)).toBe(0);
    }
  });

  it('preserves exact variants when map resources move to live rendering', () => {
    const byName = ownPropNames(manifests);
    const binding = ownPropResourceBinding(
      99,
      {
        landscapeGfx: [
          { index: 10, logicType: 4, editName: 'pine 01' },
          { index: 11, logicType: 4, editName: 'pine 02' },
          { index: 12, logicType: 4, editName: 'snow pine 01' },
          { index: 13, logicType: 1, editName: 'tree debris medium' },
        ],
      },
      manifests,
    );
    expect(binding.byGfxIndex?.[10]).toEqual(
      [0, 1, 2].map((bob) => ({ layer: `own-prop-${byName.get('pine 01')?.id}`, bob })),
    );
    expect(binding.byGfxIndex?.[11]).toEqual([0, 1, 2].map((bob) => ({ layer: 'own-prop-pine-b', bob })));
    expect(binding.byGfxIndex?.[12]).toBeUndefined();
    expect(binding.byGfxIndex?.[13]).toBeUndefined();
    expect(binding.default).toBe(99);
    expect(ownPropResourceBinding(99, null, manifests).byGfxIndex).toEqual({});
    expect(ownPropStumpBinding(undefined, manifests)).toEqual({
      byGood: {},
      default: { layer: 'own-prop-stump', bob: 0 },
    });
    expect(ownPropStumpBinding(undefined, [])).toBeUndefined();
  });

  it('selects the same low-to-full ladder for map placements and live resources', () => {
    const rock = manifests.find((m) => m.id === 'rock-02');
    if (!rock?.frames) throw new Error('Missing rock ladder');
    expect(rock.frames).toHaveLength(5);
    expect([1, 2, 5, 0, 100, undefined].map((level) => ownPropFrameIndex(level, 5))).toEqual([
      0, 1, 4, 4, 4, 4,
    ]);
    const binding = ownPropResourceBinding(
      99,
      { landscapeGfx: [{ index: 5, logicType: 15, editName: 'stones 02 grey' }] },
      [rock],
    );
    expect(binding.byGfxIndex?.[5]).toEqual(
      rock.frames.map((_, bob) => ({ layer: 'own-prop-rock-02', bob })),
    );
    expect(rock.frames[0]?.width).toBeLessThan(rock.frames[4]?.width ?? 0);
    expect(
      ownPropManifest.safeParse({ ...rock, frames: [{ ...rock.frames[0], x: rock.width }] }).success,
    ).toBe(false);
  });

  it('rejects ambiguous joins and invalid export geometry', () => {
    const m = manifests[0];
    if (!m) throw new Error('Missing fixture');
    expect(() => ownPropNames([m, m])).toThrow('Duplicate');
    expect(() => ownPropNames([m, { ...m, id: 'duplicate-name' }])).toThrow('Duplicate');
    expect(ownPropManifest.safeParse({ ...m, anchor: { x: m.width + 1, y: 0 } }).success).toBe(false);
    expect(ownPropManifest.safeParse({ ...m, image: '../other.png' }).success).toBe(false);
    expect(ownPropManifest.safeParse({ ...m, scale: 0 }).success).toBe(false);
  });
});
