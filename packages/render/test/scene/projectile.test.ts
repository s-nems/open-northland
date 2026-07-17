import { describe, expect, it } from 'vitest';
import { PROJECTILE_ARC_PEAK_FRACTION, PROJECTILE_ARC_PEAK_MAX_PX } from '../../src/data/scene/index.js';
import { buildScene, ONE, tileToScreen } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

/**
 * Unit tests for {@link buildScene}'s ballistic arc + aim: the peak lift at mid-chord, the long-shot
 * cap, the tangent tilt past mid-flight, and the rule that the arc rides the LIFT channel only, never
 * the depth key.
 */

describe('buildScene — projectile arc & aim', () => {
  it('classifies an in-flight Projectile and aims its rotation at the target', () => {
    // The shot at (1,1) homes on a target one column EAST (2,1): the screen heading is (+x, 0) → 0 rad.
    const shot = entity(1, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.ref).toBe(1);
    expect(arrow?.rotation).toBeCloseTo(0); // points screen-east, along the flight
  });

  it('a projectile whose target left the snapshot draws with no rotation (never a throw)', () => {
    const shot = entity(1, 1, 1, {
      Projectile: { target: 99, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'projectile')?.rotation).toBeUndefined();
  });

  /** A Projectile payload homing on `target`, loosed from origin tile (ox, oy). */
  function projectileFrom(target: number, ox: number, oy: number): Record<string, unknown> {
    return {
      Projectile: {
        target,
        source: 3,
        damage: 34,
        speed: 8,
        munitionType: 1,
        originX: ox * ONE,
        originY: oy * ONE,
      },
    };
  }

  it('lobs a projectile with a readable origin: peak lift at mid-chord, level tangent, depth untouched', () => {
    // Origin (0,1) → target (2,1) on one row: chord = 2 cells = 136 px. The shot sits exactly halfway
    // (1,1) → p = 0.5: lift = the parabola's peak (chord × the peak fraction), tangent slope 0 → the
    // rotation is the flat straight-line heading (east).
    const shot = entity(1, 1, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    // A flat control shot (no readable origin → no arc) on the SAME cell: the arc must ride the LIFT
    // channel only, never the depth key, so mid-lob occlusion order can't reshuffle.
    const flatShot = entity(4, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot, target, flatShot]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile' && d.ref === 1);
    const chord = tileToScreen(2, 1).x - tileToScreen(0, 1).x;
    expect(arrow?.lift).toBeCloseTo(chord * PROJECTILE_ARC_PEAK_FRACTION); // 4·peak·½·½ = peak at mid-flight
    expect(arrow?.rotation).toBeCloseTo(0); // level at the apex — still the straight heading
    const flat = scene.find((d) => d.kind === 'projectile' && d.ref === 4);
    expect(arrow?.depth).toBe(flat?.depth); // arc never moves the depth key
  });

  it('caps the lob peak on a long chord (a max-range shot must not leave the screen)', () => {
    // Origin (0,1) → target (12,1): chord = 12 cells = 816 px, whose fractional peak (~98 px) exceeds
    // the cap — the drawn peak clamps to PROJECTILE_ARC_PEAK_MAX_PX exactly at mid-flight (6,1).
    const shot = entity(1, 6, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 12, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const chord = tileToScreen(12, 1).x - tileToScreen(0, 1).x;
    expect(chord * PROJECTILE_ARC_PEAK_FRACTION).toBeGreaterThan(PROJECTILE_ARC_PEAK_MAX_PX); // the cap really binds
    expect(scene.find((d) => d.kind === 'projectile')?.lift).toBeCloseTo(PROJECTILE_ARC_PEAK_MAX_PX);
  });

  it('tilts a descending projectile nose-DOWN along the arc tangent past mid-flight', () => {
    // Same 2-cell chord, shot ¾ of the way (1.5, 1): the parabola is falling, so the drawn heading
    // tilts screen-down (positive rotation toward an eastbound target) instead of the flat 0.
    const shot = entity(1, 1.5, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.rotation ?? 0).toBeGreaterThan(0);
    expect(arrow?.lift ?? 0).toBeGreaterThan(0); // still airborne
  });
});
