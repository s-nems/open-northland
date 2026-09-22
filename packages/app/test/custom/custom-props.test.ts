import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CustomPropManifest,
  customPropAtlas,
  customPropFlagBinding,
  customPropFrameIndex,
  customPropManifest,
  customPropNames,
  customPropResourceBinding,
  customPropStumpBinding,
} from '../../src/custom/content/prop-manifest.js';

const sources = ['woodland', 'rocks', 'bushes', 'meadows', 'ferns', 'mushrooms'].map(
  (pack) => new URL(`../../../../docs/art/terrain/${pack}/`, import.meta.url),
);
const entries = sources.flatMap((source) =>
  readdirSync(source)
    .filter((n) => n.endsWith('.runtime.json'))
    .map((file) => ({
      source,
      manifest: customPropManifest.parse(JSON.parse(readFileSync(new URL(file, source), 'utf8'))),
    })),
);
const manifests = entries.map((e) => e.manifest);

describe('own woodland props', () => {
  it('keeps separate grey and khaki palettes through every depletion frame', () => {
    const names = customPropNames(manifests);
    for (const number of ['01', '02', '03', '04', '05', '07', '08', '13']) {
      for (const suffix of ['', ' rest']) {
        const grey = names.get(`stones ${number} grey${suffix}`);
        const khaki = names.get(`stones ${number} khaki${suffix}`);
        if (!grey || !khaki) throw new Error('Missing rock palette pair');
        expect(grey.id).not.toBe(khaki.id);
        expect(grey.frames).toEqual(khaki.frames);
        expect(grey.scale).toBe(khaki.scale);
        const pack = new URL('../../../../docs/art/terrain/rocks/', import.meta.url);
        const darkBytes = readFileSync(new URL(grey.image, pack));
        const lightBytes = readFileSync(new URL(khaki.image, pack));
        expect(darkBytes.equals(lightBytes)).toBe(false);
        if (grey.kind === 'resource') {
          const binding = customPropResourceBinding(
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
              prop.frames?.map((_, bob) => ({ layer: `custom-prop-${prop.id}`, bob })),
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
      const delivered = new URL(`../../src/assets/custom/props/${m.id}/`, import.meta.url);
      expect(readFileSync(new URL(m.image, delivered)).equals(bytes)).toBe(true);
      expect(
        customPropManifest.parse(JSON.parse(readFileSync(new URL('runtime.json', delivered), 'utf8'))),
      ).toEqual(m);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([m.width, m.height]);
      expect(bytes[25]).toBe(6);
      const frame = customPropAtlas(m).frames.get(0);
      expect(frame).toBeDefined();
      expect((frame?.offsetX ?? 0) + (m.frames?.[0]?.anchor.x ?? m.anchor.x)).toBe(0);
      expect((frame?.offsetY ?? 0) + (m.frames?.[0]?.anchor.y ?? m.anchor.y)).toBe(0);
    }
  });

  it('preserves exact variants when map resources move to live rendering', () => {
    const byName = customPropNames(manifests);
    const binding = customPropResourceBinding(
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
      [0, 1, 2].map((bob) => ({ layer: `custom-prop-${byName.get('pine 01')?.id}`, bob })),
    );
    expect(binding.byGfxIndex?.[11]).toEqual([0, 1, 2].map((bob) => ({ layer: 'custom-prop-pine-b', bob })));
    expect(binding.byGfxIndex?.[12]).toBeUndefined();
    expect(binding.byGfxIndex?.[13]).toBeUndefined();
    expect(binding.default).toBe(99);
    expect(customPropResourceBinding(99, null, manifests).byGfxIndex).toEqual({});
    expect(customPropStumpBinding(undefined, manifests)).toEqual({
      byGood: {},
      default: { layer: 'custom-prop-stump', bob: 0 },
    });
    expect(customPropStumpBinding(undefined, [])).toBeUndefined();
  });

  it('selects the same low-to-full ladder for map placements and live resources', () => {
    const rock = manifests.find((m) => m.id === 'rock-02');
    if (!rock?.frames) throw new Error('Missing rock ladder');
    expect(rock.frames).toHaveLength(5);
    expect([1, 2, 5, 0, 100, undefined].map((level) => customPropFrameIndex(level, 5))).toEqual([
      0, 1, 4, 4, 4, 4,
    ]);
    const binding = customPropResourceBinding(
      99,
      { landscapeGfx: [{ index: 5, logicType: 15, editName: 'stones 02 grey' }] },
      [rock],
    );
    expect(binding.byGfxIndex?.[5]).toEqual(
      rock.frames.map((_, bob) => ({ layer: 'custom-prop-rock-02', bob })),
    );
    expect(rock.frames[0]?.width).toBeLessThan(rock.frames[4]?.width ?? 0);
    expect(
      customPropManifest.safeParse({ ...rock, frames: [{ ...rock.frames[0], x: rock.width }] }).success,
    ).toBe(false);
  });

  it('rejects ambiguous joins and invalid export geometry', () => {
    const m = manifests[0];
    if (!m) throw new Error('Missing fixture');
    expect(() => customPropNames([m, m])).toThrow('Duplicate');
    expect(() => customPropNames([m, { ...m, id: 'duplicate-name' }])).toThrow('Duplicate');
    expect(customPropManifest.safeParse({ ...m, anchor: { x: m.width + 1, y: 0 } }).success).toBe(false);
    expect(customPropManifest.safeParse({ ...m, image: '../other.png' }).success).toBe(false);
    expect(customPropManifest.safeParse({ ...m, scale: 0 }).success).toBe(false);
  });
});

describe('custom delivery flag', () => {
  const frame = (i: number) => ({ x: i * 80, y: 0, width: 80, height: 64, anchor: { x: 14, y: 58 } });
  const flag: CustomPropManifest = {
    id: 'work-flag',
    kind: 'flag',
    image: 'work-flag.png',
    width: 240,
    height: 64,
    anchor: { x: 14, y: 58 },
    scale: 0.5,
    frames: [frame(0), frame(1), frame(2)],
    editNames: ['player01 work extern 01'],
    sourceBasis: 'test',
  };
  const fallback = { byGood: {}, flag: [7] as const, default: 0 };

  it('binds the flag prop frames as the stockpile wave loop in atlas order', () => {
    expect(customPropFlagBinding(fallback, [flag])).toEqual({
      ...fallback,
      flag: [0, 1, 2].map((bob) => ({ layer: 'custom-prop-work-flag', bob })),
    });
    expect(customPropFlagBinding(fallback, [])).toBe(fallback);
    expect(() => customPropFlagBinding(fallback, [flag, { ...flag, id: 'other' }])).toThrow('Multiple');
  });

  it('requires wave frames on a flag prop', () => {
    expect(customPropManifest.safeParse(flag).success).toBe(true);
    const { frames: _frames, ...still } = flag;
    expect(customPropManifest.safeParse(still).success).toBe(false);
  });
});
