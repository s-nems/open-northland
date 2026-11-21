import type { SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  DEFLECTION_TICKS,
  type Deflection,
  type DeflectionPose,
  Deflections,
  deflectionPose,
  GLANCE_TICKS,
  MAX_DEFLECTIONS,
} from '../../../src/data/effects/deflection.js';
import { SHOT_STRIKE_HEIGHT_PX } from '../../../src/data/scene/projectiles/arc.js';

const ARROW = 1;
const SHOOTER = 3;
const TARGET = 4;
const TICK = 100;
/** Half-cell nodes due east of each other on one row. */
const FROM = { hx: 10, hy: 20 };
const AT = { hx: 30, hy: 20 };

const launched = (projectile: number, at = FROM): SimEvent =>
  ({
    kind: 'projectileLaunched',
    projectile,
    shooter: SHOOTER,
    target: TARGET,
    munitionType: ARROW,
    at,
  }) as SimEvent;
const blocked = (projectile: number): SimEvent =>
  ({
    kind: 'arrowBlocked',
    projectile,
    shooter: SHOOTER,
    target: TARGET,
    munitionType: ARROW,
    soundType: 1,
    at: AT,
  }) as SimEvent;

const poseAt = (d: Deflection, age: number): DeflectionPose => {
  const out = { dx: 0, dy: 0, lift: 0, spin: 0, alpha: 0 };
  deflectionPose(d, age, out);
  return out;
};

function blockedEastward(projectile: number): Deflection {
  const store = new Deflections();
  store.ingest([launched(projectile)], TICK - 5);
  store.ingest([blocked(projectile)], TICK);
  const [d] = store.values;
  if (d === undefined) throw new Error('no deflection');
  return d;
}

describe('a blocked arrow', () => {
  it('glances from the strike to the ground beside the target, half turned, then fades out', () => {
    const d = blockedEastward(2);
    expect(d.heading).toBeCloseTo(0);
    const strike = poseAt(d, 0);
    expect(Math.hypot(strike.dx, strike.dy)).toBe(0);
    expect(strike).toMatchObject({ lift: SHOT_STRIKE_HEIGHT_PX, alpha: 1 });
    expect(poseAt(d, GLANCE_TICKS / 4).lift).toBeGreaterThan(SHOT_STRIKE_HEIGHT_PX); // it hops first
    const landed = poseAt(d, GLANCE_TICKS);
    expect(landed.lift).toBeCloseTo(0);
    expect(Math.abs(landed.spin)).toBeCloseTo(Math.PI);
    // Flying east, it glances square to its flight, a little back toward the shooter.
    expect(Math.abs(landed.dy)).toBeGreaterThan(Math.abs(landed.dx));
    expect(landed.dx).toBeLessThan(0);
    expect(poseAt(d, DEFLECTION_TICKS - GLANCE_TICKS / 2).alpha).toBeLessThan(1);
    expect(poseAt(d, DEFLECTION_TICKS).alpha).toBe(0);
  });

  it('glances to one side or the other by projectile id, the same way every time', () => {
    const even = poseAt(blockedEastward(2), GLANCE_TICKS);
    const odd = poseAt(blockedEastward(3), GLANCE_TICKS);
    expect(Math.sign(even.dy)).toBe(-Math.sign(odd.dy));
    expect(Math.sign(even.spin)).toBe(-Math.sign(odd.spin));
    expect(poseAt(blockedEastward(2), GLANCE_TICKS)).toEqual(even);
  });
});

describe('Deflections', () => {
  it('keeps at most its cap, retiring the oldest, and drops each once faded', () => {
    const store = new Deflections();
    const events = Array.from({ length: MAX_DEFLECTIONS + 2 }, (_, i) => blocked(i));
    store.ingest(events, TICK);
    expect(store.values).toHaveLength(MAX_DEFLECTIONS);
    expect(store.values[0]?.projectile).toBe(2);
    store.ingest([blocked(99)], TICK + 1);
    store.expire(TICK + DEFLECTION_TICKS);
    expect(store.values.map((d) => d.projectile)).toEqual([99]);
    store.expire(TICK + 1 + DEFLECTION_TICKS);
    expect(store.values).toHaveLength(0);
  });

  it('forgets a launch whose arrow struck, so a reused id does not inherit its heading', () => {
    const store = new Deflections();
    store.ingest([launched(5, { hx: 30, hy: 4 })], TICK - 5);
    store.ingest([{ kind: 'projectileMissed', projectile: 5 } as SimEvent], TICK - 1);
    store.ingest([blocked(5)], TICK);
    expect(store.values[0]?.heading).toBe(0);
  });
});
