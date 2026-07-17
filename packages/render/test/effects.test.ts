import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  BLOOD_LIFETIME_TICKS,
  BLOOD_RISE,
  BONES_LIFETIME_TICKS,
  bloodDroplet,
  type CombatEffect,
  effectAlpha,
  effectKey,
  foldCombatEffects,
  MAX_ACTIVE_EFFECTS,
} from '../src/data/effects.js';
import { CombatEffectsLayer } from '../src/gpu/overlays/effects-layer.js';
import { cameraViewport, makeElevationField } from '../src/index.js';

/**
 * The combat-feedback marks: the pure event→ground-litter fold (blood on a landed blow, bones on a death)
 * plus its tick-based decay. Render-only and deterministic — a miss emits no hit event so it leaves no
 * blood, and the fold is a pure function of (marks, events, tick), the "what is on the ground" decision the
 * GPU layer just draws. The `Container`/`Graphics` retained pool builds without a GL context, so the
 * layer's node bookkeeping is agent-checkable too.
 */

const at = (x: number, y: number) => ({ x, y });
const asEntity = (id: number): Entity => id as Entity;
const combatHit = (target: number, weaponMainType?: number): SimEvent => ({
  kind: 'combatHit',
  attacker: asEntity(1),
  target: asEntity(target),
  at: at(4, 6),
  ...(weaponMainType !== undefined ? { weaponMainType } : {}),
});
const projectileHit = (target: number): SimEvent => ({
  kind: 'projectileHit',
  projectile: asEntity(9),
  shooter: asEntity(1),
  target: asEntity(target),
  munitionType: 1,
  at: at(4, 6),
});
const died = (entity: number, withPos = true): SimEvent =>
  withPos
    ? { kind: 'settlerDied', entity: asEntity(entity), cause: 'damage', player: 0, at: at(8, 10) }
    : { kind: 'settlerDied', entity: asEntity(entity), cause: 'damage', player: 0 };

describe('foldCombatEffects', () => {
  it('spawns a blood mark for a melee or ranged hit, and a bones mark for a positioned death', () => {
    const out = foldCombatEffects([], [combatHit(2), projectileHit(3), died(4)], 100);
    expect(out.map((e) => e.kind)).toEqual(['blood', 'blood', 'bones']);
    expect(out.every((e) => e.spawnTick === 100)).toBe(true);
    // Blood sits at the victim's node, bones at the death node.
    expect(out[0]).toMatchObject({ hx: 4, hy: 6 });
    expect(out[2]).toMatchObject({ hx: 8, hy: 10 });
  });

  it('leaves no blood for a frame with no hit event (a miss is simply not an event)', () => {
    // A whiffed swing resolves nothing in the sim, so no combatHit reaches here — nothing to fold.
    expect(foldCombatEffects([], [], 5)).toEqual([]);
    // Non-combat events don't spawn marks either.
    const out = foldCombatEffects([], [{ kind: 'settlerBorn', entity: asEntity(1) }], 5);
    expect(out).toEqual([]);
  });

  it('drops a death with no position (no `at` → nowhere to place bones)', () => {
    expect(foldCombatEffects([], [died(4, false)], 1)).toEqual([]);
  });

  it('expires a mark once past its lifetime, keeping younger ones', () => {
    const marks = foldCombatEffects([], [combatHit(2), died(3)], 0);
    // One blood + one bone at tick 0. Advance past blood's lifetime but within bones' — blood expires.
    const later = foldCombatEffects(marks, [], BLOOD_LIFETIME_TICKS + 1);
    expect(later.map((e) => e.kind)).toEqual(['bones']);
    // Past bones' lifetime too — everything is gone.
    expect(foldCombatEffects(later, [], BONES_LIFETIME_TICKS + 2)).toEqual([]);
  });

  it('caps the live list, dropping the oldest first', () => {
    // Carry a full cap of OLD bones (deaths at tick 0, still within their long lifetime), then flood the
    // next tick with fresh hits — the overflow drops the oldest (front) marks, holding the list at the cap.
    const old = foldCombatEffects(
      [],
      Array.from({ length: MAX_ACTIVE_EFFECTS }, (_, i) => died(1000 + i)),
      0,
    );
    expect(old.length).toBe(MAX_ACTIVE_EFFECTS);
    const flooded = foldCombatEffects(
      old,
      Array.from({ length: 30 }, (_, i) => combatHit(i)),
      1,
    );
    expect(flooded.length).toBe(MAX_ACTIVE_EFFECTS);
    // The 30 freshest are the tick-1 blood marks; the 30 oldest tick-0 bones were dropped off the front.
    expect(flooded.at(-1)?.kind).toBe('blood');
    expect(flooded[0]?.spawnTick).toBe(0); // still bones from tick 0, but the earliest 30 are gone
    expect(flooded.filter((e) => e.kind === 'bones').length).toBe(MAX_ACTIVE_EFFECTS - 30);
  });
});

describe('effectAlpha', () => {
  const blood: CombatEffect = { kind: 'blood', hx: 0, hy: 0, spawnTick: 0, seed: 1 };
  it('holds full opacity then fades to zero across the lifetime', () => {
    expect(effectAlpha(blood, 0)).toBe(1);
    expect(effectAlpha(blood, 1)).toBe(1); // still within the hold window
    expect(effectAlpha(blood, BLOOD_LIFETIME_TICKS)).toBe(0); // fully faded at the end
    const mid = effectAlpha(blood, Math.round(BLOOD_LIFETIME_TICKS * 0.7));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
  it('gives bones a much longer life than blood', () => {
    const bones: CombatEffect = { kind: 'bones', hx: 0, hy: 0, spawnTick: 0, seed: 1 };
    expect(effectAlpha(bones, BLOOD_LIFETIME_TICKS)).toBe(1); // bones still fresh when blood is gone
    expect(BONES_LIFETIME_TICKS).toBeGreaterThan(BLOOD_LIFETIME_TICKS);
  });
});

describe('bloodDroplet — the spray falls from the wound to the feet', () => {
  it('starts at the wound and falls DOWN to pool at the feet over time', () => {
    const start = bloodDroplet(1234, 0, 0);
    expect(start.y).toBeCloseTo(0, 5); // at the wound (local origin), before any fall
    expect(start.landed).toBe(false);
    // Far past the fall time: on the ground, flattened into a pool at exactly the feet (BLOOD_RISE below).
    const settled = bloodDroplet(1234, 0, 100);
    expect(settled.landed).toBe(true);
    expect(settled.y).toBeCloseTo(BLOOD_RISE, 5);
    expect(settled.stretchY).toBeLessThan(1); // a pool is flat, not a streak
    expect(settled.stretchX).toBeGreaterThan(1); // spread horizontally
  });

  it('monotonically descends and never falls past the feet', () => {
    let prevY = Number.NEGATIVE_INFINITY;
    for (let age = 0; age <= 40; age++) {
      const d = bloodDroplet(77, 2, age);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(BLOOD_RISE + 1e-9); // clamped at the ground
      expect(d.y).toBeGreaterThanOrEqual(prevY - 1e-9); // never rises back up
      prevY = d.y;
    }
  });

  it('is deterministic and varies per droplet (seeded, no Math.random)', () => {
    expect(bloodDroplet(9, 1, 3)).toEqual(bloodDroplet(9, 1, 3)); // reproducible for a ?shot
    expect(bloodDroplet(9, 1, 3).x).not.toBe(bloodDroplet(9, 2, 3).x); // different droplets fan out
  });
});

describe('effectKey', () => {
  it('is stable per mark and distinct across kind / tick / seed', () => {
    const a: CombatEffect = { kind: 'blood', hx: 0, hy: 0, spawnTick: 3, seed: 7 };
    expect(effectKey(a)).toBe(effectKey({ ...a }));
    expect(effectKey(a)).not.toBe(effectKey({ ...a, kind: 'bones' }));
    expect(effectKey(a)).not.toBe(effectKey({ ...a, spawnTick: 4 }));
    expect(effectKey(a)).not.toBe(effectKey({ ...a, seed: 8 }));
  });
});

describe('CombatEffectsLayer', () => {
  const flat = makeElevationField(undefined, 0, 0);
  // A viewport that frames a wide area around the origin so the projected marks are on-screen.
  const vp = cameraViewport({ offsetX: 400, offsetY: 300, scale: 1 }, 800, 600, 512);

  it('mints one retained node per live mark, split by role, and retires expired ones', () => {
    const layer = new CombatEffectsLayer();
    layer.ingest([combatHit(2), died(3)], 0);
    layer.draw(flat, vp, 0);
    // Blood goes in the overlay (over sprites), bones on the ground (under sprites).
    expect(layer.overlayContainer.children.length).toBe(1); // blood
    expect(layer.groundContainer.children.length).toBe(1); // bones
    // Advance past the blood lifetime: the blood node is retired, the bone node stays.
    layer.ingest([], BLOOD_LIFETIME_TICKS + 1);
    layer.draw(flat, vp, BLOOD_LIFETIME_TICKS + 1);
    expect(layer.overlayContainer.children.length).toBe(0);
    expect(layer.groundContainer.children.length).toBe(1);
    layer.destroy();
  });
});
