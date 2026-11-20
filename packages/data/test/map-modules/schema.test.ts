import { describe, expect, it } from 'vitest';
import { MapGearSchedule, MapSiege } from '../../src/index.js';
import { MODULES } from './fixture.js';

if (MODULES.siege === undefined || MODULES.gearSchedule === undefined)
  throw new Error('no fixture siege and gear to vary');
const siege = MODULES.siege;
const gear = MODULES.gearSchedule;
/** One man past the most an attack may send on foot over all its targets. */
const OVER_LAUNCH_MEN = 1001;

describe('MapSiege', () => {
  it('refuses a schedule out of order, a seat targeted twice, a raider that is no raider or a refill above its max', () => {
    const { attacks, guard, stronghold } = siege;
    const [target, other] = attacks.targets;
    if (target === undefined || other === undefined) throw new Error('no two fixture targets to vary');
    for (const bad of [
      { attacks: { ...attacks, launches: [...attacks.launches].reverse() } },
      { attacks: { ...attacks, targets: [target, target] } },
      { attacks: { ...attacks, targets: [target, { ...other, raider: target.raider }] } },
      { attacks: { ...attacks, targets: [{ ...target, raider: stronghold.seat }] } },
      { attacks: { ...attacks, targets: [target, { ...other, raider: target.seat }] } },
      { guard: { ...guard, refill: { ...guard.refill, baseMen: guard.refill.maxMen + 1 } } },
    ]) {
      expect(MapSiege.safeParse({ ...siege, ...bad }).success).toBe(false);
    }
  });

  it('refuses a refill pulse quicker than its floor', () => {
    const { guard } = siege;
    const quick = { ...guard, refill: { ...guard.refill, everySeconds: 1 } };
    expect(MapSiege.safeParse({ ...siege, guard: quick }).success).toBe(false);
  });

  it('refuses an attack whose men on foot, over all its targets, pass the cap', () => {
    const { attacks } = siege;
    const perTarget = Math.ceil(OVER_LAUNCH_MEN / attacks.targets.length);
    const crowd = { ...attacks, repeat: { ...attacks.repeat, waves: [{ landMen: perTarget, ships: 0 }] } };
    expect(MapSiege.safeParse({ ...siege, attacks: crowd }).success).toBe(false);
  });

  it('reads exactly its own revision', () => {
    expect(MapSiege.safeParse({ ...siege, version: 2 }).success).toBe(false);
  });
});

describe('MapGearSchedule', () => {
  it('refuses steps out of order', () => {
    expect(MapGearSchedule.safeParse({ ...gear, steps: [...gear.steps].reverse() }).success).toBe(false);
  });
});
