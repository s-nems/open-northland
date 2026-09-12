import { describe, expect, it } from 'vitest';
import {
  ownCharacterAtlas,
  ownCharacterBinding,
  ownCharacterManifest,
  ownCharacterShadowAtlas,
} from '../src/content/own-assets/character-manifest.js';

const manifest = ownCharacterManifest.parse({
  id: 'test',
  name: 'Test',
  width: 1152,
  height: 5376,
  cellWidth: 96,
  cellHeight: 112,
  columns: 12,
  anchorX: 48,
  anchorY: 96,
  scale: 0.5,
  walkFrames: 12,
  idleFrames: 60,
  walkDuration: 31 / 30,
  idleDuration: 5,
  sourceBasis: 'Synthetic fixture',
});
describe('own character atlas', () => {
  it('binds repeated idle steps without multiplying stored body or shadow frames', () => {
    const ordered = ownCharacterManifest.parse({
      ...manifest,
      height: 1120,
      idleFrames: 2,
      idleFrameOrder: [0, 1, 0],
      idleFrameDurations: [2, 0.5, 2.5],
      shadow: {
        sprite: 'shadow.png',
        width: 120,
        height: 150,
        cellWidth: 10,
        cellHeight: 15,
        columns: 12,
        anchorX: 5,
        anchorY: 12,
      },
    });
    expect(ownCharacterBinding(ordered).idle).toMatchObject({
      frameOrder: [0, 1, 0],
      frameDurations: [24, 6, 30],
    });
    expect(ownCharacterAtlas(ordered).frames.size).toBe(112);
    expect(ownCharacterShadowAtlas(ordered)?.frames.size).toBe(112);
  });
  it('binds construction without replacing walking, waiting or unrelated actions', () => {
    const work = ownCharacterManifest.parse({
      ...manifest,
      height: 6272,
      atomicClips: [{ atomicId: 39, frames: 12, duration: 1.25 }],
    });
    const binding = ownCharacterBinding(work);
    const workStart = 8 * (work.walkFrames + work.idleFrames);
    expect(ownCharacterAtlas(work).frames.size).toBe(672);
    expect(binding.byAtomic?.[39]).toEqual({
      start: workStart,
      dirs: 8,
      stride: 12,
      subtick: false,
      ticksPerFrame: 1.25,
    });
    expect(binding.byAtomic?.[24]).toBeUndefined();
    expect(binding.idle).toEqual(ownCharacterBinding(manifest).idle);
    expect(binding.moving).toEqual(ownCharacterBinding(manifest).moving);
  });
  it('rejects ambiguous atomic bindings and invalid pose holds', () => {
    const clip = { atomicId: 39, frames: 12, duration: 1.25 };
    expect(ownCharacterManifest.safeParse({ ...manifest, atomicClips: [clip, clip] }).success).toBe(false);
    expect(
      ownCharacterManifest.safeParse({ ...manifest, atomicClips: [{ ...clip, frameDurations: [1.25] }] })
        .success,
    ).toBe(false);
    expect(
      ownCharacterManifest.safeParse({
        ...manifest,
        atomicClips: [{ ...clip, frameDurations: Array(12).fill(1) }],
      }).success,
    ).toBe(false);
  });
  it('requires one positive measured stride per facing', () => {
    const calibrated = { ...manifest, walkTravelPerCycle: [36, 48, 36, 36, 48, 36, 24, 24] };
    expect(ownCharacterBinding(ownCharacterManifest.parse(calibrated)).moving).toMatchObject({
      travelPerCycle: calibrated.walkTravelPerCycle,
    });
    expect(ownCharacterManifest.safeParse({ ...calibrated, walkTravelPerCycle: [48] }).success).toBe(false);
    expect(
      ownCharacterManifest.safeParse({ ...calibrated, walkTravelPerCycle: [0, 48, 36, 36, 48, 36, 24, 24] })
        .success,
    ).toBe(false);
  });
  it('validates authored pose holds and converts seconds to simulation tick units', () => {
    const sparse = { ...manifest, height: 1120, idleFrames: 2, idleFrameDurations: [4.75, 0.25] };
    expect(ownCharacterManifest.safeParse(sparse).success).toBe(true);
    expect(ownCharacterBinding(sparse).idle).toMatchObject({ frameDurations: [57, 3] });
    expect(ownCharacterManifest.safeParse({ ...sparse, idleFrameDurations: [5] }).success).toBe(false);
    expect(ownCharacterManifest.safeParse({ ...sparse, idleFrameDurations: [4, 0.25] }).success).toBe(false);
    expect(ownCharacterManifest.safeParse({ ...sparse, idleFrameDurations: [5, 0] }).success).toBe(false);
  });
  it('covers eight directions and anchors every full appearance at the feet', () => {
    const atlas = ownCharacterAtlas(manifest);
    expect(atlas.frames.size).toBe(576);
    expect(atlas.frames.get(575)).toEqual({
      x: 1056,
      y: 5264,
      width: 96,
      height: 112,
      offsetX: -48,
      offsetY: -96,
    });
    expect(ownCharacterBinding(manifest).idle).toEqual({
      subtick: false,
      start: 96,
      dirs: 8,
      stride: 60,
      ticksPerFrame: 1,
    });
    expect(ownCharacterBinding(manifest).moving).toEqual({
      subtick: false,
      start: 0,
      dirs: 8,
      stride: 12,
      ticksPerFrame: 31 / 30,
    });
  });
  it('rejects a truncated atlas', () => {
    expect(() => ownCharacterAtlas({ ...manifest, height: 112 })).toThrow('coverage');
  });
});

it('keeps independent shadow geometry synchronized with body frame ids', () => {
  const shadow = {
    sprite: 'shadow.png',
    width: 1920,
    height: 1920,
    cellWidth: 80,
    cellHeight: 80,
    columns: 24,
    anchorX: 20,
    anchorY: 32,
  };
  const m = ownCharacterManifest.parse({ ...manifest, shadow });
  const atlas = ownCharacterShadowAtlas(m);
  expect(atlas && [...atlas.frames.keys()]).toEqual([...ownCharacterAtlas(m).frames.keys()]);
  expect(atlas?.frames.get(575)).toEqual({
    x: 1840,
    y: 1840,
    width: 80,
    height: 80,
    offsetX: -20,
    offsetY: -32,
  });
  expect(ownCharacterShadowAtlas(manifest)).toBeUndefined();
  expect(ownCharacterManifest.safeParse({ ...m, shadow: { ...shadow, height: 1840 } }).success).toBe(false);
  expect(ownCharacterManifest.safeParse({ ...m, shadow: { ...shadow, anchorX: -1 } }).success).toBe(false);
});
