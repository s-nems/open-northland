import type { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { resolveSettlerBobId } from '../../src/data/sprites/settler.js';
import { characterGaitRate } from '../../src/gpu/sprite-pool/character-layers.js';
import { type MotionTrack, trackMotion } from '../../src/gpu/sprite-pool/motion.js';
import type { SettlerCharacterSet } from '../../src/gpu/sprite-sheet.js';

const body = { source: {} as TextureSource, atlas: { width: 0, height: 0, frames: new Map() } };
const moving = {
  start: 0,
  dirs: 2,
  stride: 16,
  ticksPerFrame: 0.75,
  subtick: true,
  travelPerCycle: [48, 24],
};
const binding = { idle: 32, moving };
const characters: SettlerCharacterSet = {
  default: { body, binding, scale: 0.5 },
  byJob: { 7: { body, binding: { idle: 0, moving: 1 } } },
};
const item: DrawItem = { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, state: 'moving', facing: 0 };
function fresh(): MotionTrack {
  return {
    tick: -1,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    drawX: 0,
    drawY: 0,
    gaitPhase: 0,
    prevGaitPhase: 0,
    stillTicks: 0,
    snapDistance: 128,
  };
}

describe('measured walk travel', () => {
  it('keeps phase tied to distance across speed changes, turns and catch-up ticks', () => {
    const track = fresh();
    const rate = characterGaitRate(characters, item);
    trackMotion(track, 0, 0, 0, 1, rate);
    trackMotion(track, 1, 3, 0, 1, rate);
    expect(resolveSettlerBobId(binding, item, 1, track.gaitPhase)).toBe(2);
    trackMotion(track, 7, 12, 0, 0.5, rate);
    expect(resolveSettlerBobId(binding, item, 7, track.gaitPhase)).toBe(8);
    expect(track.drawX).toBe(7.5);
    const turned = { ...item, facing: 1 };
    trackMotion(track, 8, 12, 6, 1, characterGaitRate(characters, turned));
    expect(track.gaitPhase).toBe(12);
    expect(resolveSettlerBobId(binding, turned, 8, track.gaitPhase)).toBe(16);
    trackMotion(track, 9, 12, 6, 1, rate);
    expect(track.gaitPhase).toBe(12);
    trackMotion(track, 10, 500, 6, 1, rate);
    expect(track.gaitPhase).toBe(12);
  });
  it('preserves movement anchors and interpolates the planted-foot clock with them', () => {
    const original = fresh(),
      calibrated = fresh();
    trackMotion(original, 0, 0, 0, 1);
    trackMotion(calibrated, 0, 0, 0, 1, 0.5);
    trackMotion(original, 1, 6, 0, 0.25);
    trackMotion(calibrated, 1, 6, 0, 0.25, 0.5);
    expect(calibrated.drawX).toBe(original.drawX);
    const clock = calibrated.prevGaitPhase * 0.75 + calibrated.gaitPhase * 0.25;
    const footBackwardTravel = (clock / 12) * 24;
    expect(calibrated.drawX - footBackwardTravel).toBeCloseTo(0);
  });
  it('uses the held facing and leaves uncalibrated jobs on their existing clock', () => {
    expect(
      characterGaitRate(characters, { kind: 'settler', ref: 1, x: 0, y: 0, depth: 0, state: 'moving' }, 1),
    ).toBe(1);
    expect(characterGaitRate(characters, { ...item, jobType: 7 })).toBeUndefined();
    expect(characterGaitRate(undefined, item)).toBeUndefined();
  });
  it('uses a carrying clip calibration when a good changes the stride', () => {
    const loaded = {
      ...characters,
      default: {
        ...characters.default,
        binding: {
          ...binding,
          carrying: { moving: { ...moving, travelPerCycle: [24, 12] } },
        },
      },
    };
    expect(characterGaitRate(loaded, { ...item, carrying: true })).toBe(1);
    expect(characterGaitRate(loaded, item)).toBe(0.5);
  });
});
