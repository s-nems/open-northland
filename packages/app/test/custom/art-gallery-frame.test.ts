import { readFileSync } from 'node:fs';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { galleryCharacterFrame } from '../../src/custom/art-gallery/preview-character-frame.js';

const binding = {
  start: 24,
  dirs: 8,
  stride: 3,
  subtick: true,
  ticksPerFrame: 2,
  frameDurations: [2, 6, 2],
};

describe('gallery animation controls', () => {
  it('advances fractional pose holds without quantizing them to simulation ticks', () => {
    const mining = {
      start: 0,
      dirs: 8,
      stride: 16,
      subtick: true,
      frameDurations: Array.from({ length: 16 }, () => 1.8),
    };
    const state = { direction: 0, playing: true };
    expect(galleryCharacterFrame(mining, state, 1.79 / TICKS_PER_SECOND)).toBe(0);
    expect(galleryCharacterFrame(mining, state, 1.81 / TICKS_PER_SECOND)).toBe(1);
    const observed = new Set(
      Array.from({ length: 144 }, (_, i) => galleryCharacterFrame(mining, state, i / 60)),
    );
    expect([...observed]).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it.each([
    'man-silver',
    'man-forkbeard',
    'man-redmane',
    'man-ravenknot',
  ])('keeps %s mining at sixteen poses with one slow swing and contact aligned with the strike sound at elapsed tick nineteen', (name) => {
    const recipe = JSON.parse(
      readFileSync(`docs/art/characters/appearances/${name}/recipe.json`, 'utf8'),
    ) as {
      clips: {
        name: string;
        frames: number;
        duration: number;
        samplePhases: number[];
        frameDurations: number[];
      }[];
    };
    const clip = recipe.clips.find((entry) => entry.name === 'mining');
    expect(clip).toBeDefined();
    if (!clip) return;
    expect(clip.frames).toBe(16);
    expect(clip.samplePhases).toHaveLength(16);
    const holds = clip.frameDurations.map((seconds) => seconds * TICKS_PER_SECOND);
    const duration = holds.reduce((sum, hold) => sum + hold, 0);
    expect(duration).toBeCloseTo(29);
    expect(clip.duration * TICKS_PER_SECOND).toBeCloseTo(duration);
    const ref = { start: 0, dirs: 8, stride: 16, subtick: true, frameDurations: holds };
    const state = { direction: 0, playing: true };
    const impact = galleryCharacterFrame(ref, state, 18 / TICKS_PER_SECOND);
    expect(clip.samplePhases[impact]).toBe(0.375);
    expect(galleryCharacterFrame(ref, state, 29 / TICKS_PER_SECOND)).toBe(0);
    expect(clip.frameDurations[impact]).toBe(0.0625);
    expect(clip.frameDurations[impact + 1]).toBe(0.6875);
    expect(clip.frameDurations[4]).toBeCloseTo(5 / 12);
    expect(
      Math.max(...clip.frameDurations.filter((_, index) => index !== impact + 1 && index !== 4)),
    ).toBeLessThanOrEqual(0.125);
  });

  it('plays the selected direction using authored pose holds', () => {
    const state = { direction: 2, playing: true, frame: 2 };
    expect(galleryCharacterFrame(binding, state, 1 / TICKS_PER_SECOND)).toBe(30);
    expect(galleryCharacterFrame(binding, state, 7 / TICKS_PER_SECOND)).toBe(31);
    expect(galleryCharacterFrame(binding, state, 8 / TICKS_PER_SECOND)).toBe(32);
    expect(galleryCharacterFrame(binding, state, 10 / TICKS_PER_SECOND)).toBe(30);
  });

  it('steps stored poses while paused, independently of pose duration', () => {
    expect(galleryCharacterFrame(binding, { direction: 5, playing: false, frame: 5 }, 0)).toBe(41);
  });

  it('keeps the playback clock when paused without a manual frame', () => {
    expect(galleryCharacterFrame(binding, { direction: 0, playing: false }, 7 / TICKS_PER_SECOND)).toBe(25);
  });
});
