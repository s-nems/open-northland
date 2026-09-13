import { describe, expect, it } from 'vitest';
import { ownCharacterManifest } from '../src/character.js';

const manifest = {
  id: 'test',
  name: 'Test',
  width: 80,
  height: 60,
  cellWidth: 10,
  cellHeight: 20,
  columns: 8,
  anchorX: 5,
  anchorY: 18,
  scale: 0.5,
  walkFrames: 1,
  idleFrames: 1,
  idleDuration: 1,
  walkDuration: 1,
  atomicClips: [{ atomicId: 1, frames: 1, duration: 1 }],
  sourceBasis: 'Synthetic fixture',
};

describe('character atlas contract', () => {
  it('uses the same timing validation for walk and work clips', () => {
    const ordered = {
      ...manifest,
      walkFrameOrder: [0, 0],
      walkFrameDurations: [0.8, 0.2],
      atomicClips: [{ atomicId: 1, frames: 1, duration: 1, frameOrder: [0, 0], frameDurations: [0.1, 0.9] }],
    };
    expect(() => ownCharacterManifest.parse(ordered)).not.toThrow();
    expect(() => ownCharacterManifest.parse({ ...ordered, walkFrameOrder: [1, 0] })).toThrow(
      'outside stored poses',
    );
    expect(() =>
      ownCharacterManifest.parse({
        ...ordered,
        atomicClips: [{ ...ordered.atomicClips[0], frameDurations: [0.1] }],
      }),
    ).toThrow('Pose holds');
  });
  it('reuses stored idle poses while validating every playback step and hold', () => {
    const ordered = { ...manifest, idleFrameOrder: [0, 0], idleFrameDurations: [0.8, 0.2] };
    expect(() => ownCharacterManifest.parse(ordered)).not.toThrow();
    expect(() => ownCharacterManifest.parse({ ...ordered, idleFrameOrder: [0, 1] })).toThrow(
      'outside stored poses',
    );
    expect(() => ownCharacterManifest.parse({ ...ordered, idleFrameDurations: [1] })).toThrow('Pose holds');
    expect(() => ownCharacterManifest.parse({ ...ordered, idleFrameDurations: undefined })).toThrow(
      'explicit step durations',
    );
  });
  it('accounts for all directions and atomic clips, including a partially filled last row', () => {
    expect(() => ownCharacterManifest.parse(manifest)).not.toThrow();
    expect(() => ownCharacterManifest.parse({ ...manifest, columns: 10, width: 100 })).not.toThrow();
    expect(() => ownCharacterManifest.parse({ ...manifest, height: 40 })).toThrow('clip coverage');
    expect(() => ownCharacterManifest.parse({ ...manifest, width: 81 })).toThrow('clip coverage');
  });

  it('rejects anchors outside a cell at the shared browser and pipeline boundary', () => {
    for (const change of [{ anchorX: -1 }, { anchorX: 11 }, { anchorY: -1 }, { anchorY: 21 }])
      expect(() => ownCharacterManifest.parse({ ...manifest, ...change })).toThrow('anchor outside');
  });
});
