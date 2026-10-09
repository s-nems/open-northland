import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_LIFETIME_TICKS,
  COLLAPSE_SMOKE_LEAD_TICKS,
  COLLAPSE_TICKS,
  collapseProgress,
  collapseRemovalAge,
} from '../src/data/effects/collapse.js';
import { dismantleMask, removalTime } from '../src/data/effects/dismantle.js';
import {
  dismantleChips,
  dismantleDustOrigins,
  MAX_DISMANTLE_DUST,
  poseDismantleChip,
  poseDismantleDust,
} from '../src/data/effects/dismantle-debris.js';

describe('reverse construction', () => {
  it('removes later construction first across stage windows and clears time-zero foundations', () => {
    expect(removalTime(255, [20, 100], 1)).toBeCloseTo(0.035);
    expect(removalTime(255, [0, 70], 1)).toBeCloseTo(0.305);
    expect(removalTime(0, [20, 100], 1)).toBeCloseTo(0.755);
    expect(removalTime(0, [0, 70], 1)).toBeCloseTo(0.935);
    // A half-built stage starts reversing at its own last built pixel, not the completed roof.
    expect(removalTime(128, [0, 100], 0.5)).toBeCloseTo(0.035);
    expect(removalTime(0, [0, 100], 0.5)).toBeCloseTo(0.935);
    expect(removalTime(255, [50, 20], 1)).toBeCloseTo(removalTime(0, [50, 20], 1));
  });

  it('reads authored pixel order at the original atlas coordinates after a cropped capture', () => {
    const values = new Uint8Array(8 * 6);
    values[2 * 8 + 3] = 255;
    values[2 * 8 + 4] = 64;
    const mask = dismantleMask(
      2,
      1,
      {
        frame: { x: 2, y: 1, width: 4, height: 4, offsetX: -2, offsetY: -4 },
        times: { width: 8, height: 6, values },
        window: [0, 100],
        built: 1,
        seed: 9,
      },
      1,
      1,
    );
    expect(mask[0]).toBe(9);
    expect(mask[4]).toBe(181);
    expect(mask[3]).toBe(255);
    expect(mask[7]).toBe(255);
  });

  it('keeps a roof-to-foundation fallback bounded when construction data is unavailable', () => {
    const mask = dismantleMask(20, 20, {
      frame: { x: 0, y: 0, width: 20, height: 20, offsetX: -10, offsetY: -20 },
      built: 1,
      seed: 5,
    });
    const roof = Array.from({ length: 20 }, (_, x) => mask[x * 4] ?? 0);
    const foot = Array.from({ length: 20 }, (_, x) => mask[(19 * 20 + x) * 4] ?? 0);
    expect(Math.max(...roof)).toBeLessThan(Math.min(...foot));
    expect(Math.min(...roof)).toBeGreaterThan(0);
    expect(Math.max(...foot)).toBeLessThan(255);
  });
});

describe('demolition debris', () => {
  it('emits only from existing pixels, at their removal time, then lands and clears every chip', () => {
    const pixels = new Uint8ClampedArray(40 * 40 * 4);
    const mask = pixels.slice();
    for (let y = 4; y < 30; y++)
      for (let x = 10; x < 30; x++) {
        pixels.set([140, 100, 60, 255], (y * 40 + x) * 4);
        mask[(y * 40 + x) * 4] = 128;
      }
    const chips = dismantleChips(pixels, mask, 40, 40, 31);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(12);
    const pose = { x: 0, y: 0, alpha: 0, rotation: 0 };
    for (const chip of chips) {
      expect(pixels[(chip.y * 40 + chip.x) * 4 + 3]).toBe(255);
      expect(chip.colour).toBe(0x8c643c);
      expect(chip.birth).toBeCloseTo(collapseRemovalAge(128 / 255));
      expect(
        collapseProgress({ entity: 1, typeId: 1, tribe: 1, hx: 0, hy: 0, spawnTick: 0 }, chip.birth),
      ).toBeCloseTo(128 / 255);
      poseDismantleChip(pose, chip, 0, 40);
      expect(pose.alpha).toBe(0);
      poseDismantleChip(pose, chip, chip.birth + 8, 40);
      expect(pose.y).toBe(40);
      expect(pose.alpha).toBe(1);
      poseDismantleChip(pose, chip, COLLAPSE_LIFETIME_TICKS, 40);
      expect(pose.alpha).toBe(0);
    }
  });
});

describe('demolition dust', () => {
  const origins = Array.from({ length: 32 }, (_, i) => ({
    x: -50 + (i % 8) * 12,
    y: -200 + i * 6,
    birth: collapseRemovalAge(i / 32),
    seed: i * 71 + 9,
    colour: 0x8c643c,
  }));

  it('selects actual break points throughout the sequence within a fixed particle budget', () => {
    const selected = dismantleDustOrigins(origins, 9);
    expect(selected).toEqual(dismantleDustOrigins(origins, 9));
    expect(dismantleDustOrigins([], 9)).toEqual([]);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(MAX_DISMANTLE_DUST);
    expect(new Set(selected).size).toBe(selected.length);
    for (const origin of selected) expect(origins).toContain(origin);
    expect(selected.some((origin) => origin.birth < COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS / 2)).toBe(
      true,
    );
    expect(selected.some((origin) => origin.birth > COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS * 0.75)).toBe(
      true,
    );
    expect(selected).not.toEqual(dismantleDustOrigins(origins, 37));
  });

  it('covers the structure before removal, lingers afterward and clears without repeating', () => {
    const pose = { x: 0, y: 0, rotation: 0, alpha: 0, scaleX: 0, scaleY: 0 };
    let lingering = false;
    for (const origin of dismantleDustOrigins(origins, 9)) {
      poseDismantleDust(pose, origin, 0, 100);
      expect(pose.alpha).toBe(0);
      expect(pose.x).toBe(origin.x);
      expect(pose.y).toBe(origin.y);
      poseDismantleDust(pose, origin, COLLAPSE_SMOKE_LEAD_TICKS, 100);
      expect(pose.alpha).toBeGreaterThan(0.4);
      expect(pose.alpha).toBeLessThan(0.99);
      expect(Math.abs(pose.y - origin.y)).toBeLessThan(25);
      const again = { ...pose };
      poseDismantleDust(again, origin, COLLAPSE_SMOKE_LEAD_TICKS, 100);
      expect(again).toEqual(pose);
      poseDismantleDust(pose, origin, COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS + 50, 100);
      lingering ||= pose.alpha > 0.1;
      for (const age of [COLLAPSE_LIFETIME_TICKS, COLLAPSE_LIFETIME_TICKS + 10]) {
        poseDismantleDust(pose, origin, age, 100);
        expect(pose.alpha).toBe(0);
      }
    }
    expect(lingering).toBe(true);
  });
});
