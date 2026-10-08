import type { Entity, SimEvent } from '@open-northland/sim';
import { expect, it } from 'vitest';
import {
  BLOOD_COAT_LIFETIME,
  BloodCoats,
  MAX_BLOOD_COAT_AMOUNT,
  MAX_BLOOD_COATS,
} from '../src/data/effects/blood-coats.js';

const hit: SimEvent = {
  kind: 'combatHit',
  damage: 250,
  targetMaxHealth: 1000,
  attacker: 1 as Entity,
  target: 2 as Entity,
  weaponMainType: 3,
  at: { hx: 4, hy: 6 },
};
const shot: SimEvent = {
  kind: 'projectileHit',
  damage: 250,
  targetMaxHealth: 1000,
  shooter: 3 as Entity,
  projectile: 10 as Entity,
  target: 4 as Entity,
  munitionType: 1,
  at: { hx: 4, hy: 6 },
};
const amount = (packed: number) => packed % 256;
const dryness = (packed: number) => Math.floor(packed / 256) % 256;

it('coats victims and melee attackers, but never remote shooters or blows against structures', () => {
  const coats = new BloodCoats();
  coats.ingest([hit, shot, { ...hit, attacker: 5 as Entity, target: 6 as Entity, structure: true }], 12);
  expect(amount(coats.packed(2, 12))).toBeGreaterThan(amount(coats.packed(1, 12)));
  expect(amount(coats.packed(1, 12))).toBeGreaterThan(0);
  expect(amount(coats.packed(4, 12))).toBeGreaterThan(0);
  for (const ref of [3, 5, 6, 10]) expect(coats.packed(ref, 12)).toBe(0);
});

it('accumulates coverage, refreshes wetness, keeps each pattern stable and fades on game time', () => {
  const coats = new BloodCoats();
  coats.ingest([hit], 0);
  const first = coats.packed(2, 0);
  expect(dryness(first)).toBe(0);
  const dried = coats.packed(2, 600);
  expect(dryness(dried)).toBe(255);
  expect(Math.abs(amount(dried) * 2 - amount(first))).toBeLessThanOrEqual(1);
  coats.ingest([hit], 600);
  const second = coats.packed(2, 600);
  expect(amount(second)).toBeGreaterThan(amount(first));
  expect(amount(second)).toBeLessThan(Math.round(MAX_BLOOD_COAT_AMOUNT * 255));
  expect(dryness(second)).toBe(0);
  expect(Math.floor(second / 65536)).toBe(Math.floor(first / 65536));
  expect(new Float32Array([second])[0]).toBe(second);
  expect(amount(coats.packed(2, 2100))).toBeLessThan(amount(second));
  expect(coats.packed(2, 600 + BLOOD_COAT_LIFETIME)).toBe(0);
});

it('clears coats and ignores impacts while blood is disabled', () => {
  const coats = new BloodCoats();
  coats.ingest([hit], 0);
  coats.setEnabled(false);
  expect(coats.packed(2, 0)).toBe(0);
  coats.ingest([hit], 1);
  coats.setEnabled(true);
  expect(coats.packed(2, 2)).toBe(0);
  coats.ingest([shot], 3);
  expect(coats.packed(4, 3)).toBeGreaterThan(0);
});

it('bounds off-screen history and evicts the oldest untouched coat', () => {
  const coats = new BloodCoats();
  coats.ingest(
    Array.from({ length: MAX_BLOOD_COATS }, (_, i) => ({ ...shot, target: i as Entity })),
    0,
  );
  coats.ingest([{ ...shot, target: 0 as Entity }], 1);
  coats.ingest([{ ...shot, target: MAX_BLOOD_COATS as Entity }], 2);
  expect(coats.packed(0, 2)).toBeGreaterThan(0);
  expect(coats.packed(1, 2)).toBe(0);
  coats.ingest([], BLOOD_COAT_LIFETIME + 1);
  expect(coats.packed(0, BLOOD_COAT_LIFETIME + 1)).toBe(0);
  expect(coats.packed(MAX_BLOOD_COATS, BLOOD_COAT_LIFETIME + 1)).toBe(0); // fully faded before retirement
});

it('accumulates actual wounds rather than hit counts, with a lower ceiling for long fights', () => {
  const grazes = new BloodCoats();
  const wound = new BloodCoats();
  grazes.ingest(
    Array.from({ length: 100 }, () => ({ ...hit, damage: 1 })),
    0,
  );
  wound.ingest([{ ...hit, damage: 100 }], 0);
  for (const ref of [1, 2]) expect(amount(grazes.packed(ref, 0))).toBe(amount(wound.packed(ref, 0)));
  expect(amount(grazes.packed(2, 0))).toBeLessThan(20);
  wound.ingest(
    Array.from({ length: 20 }, () => ({ ...hit, damage: 1000 })),
    1,
  );
  expect(amount(wound.packed(2, 1))).toBe(Math.round(MAX_BLOOD_COAT_AMOUNT * 255));
});

it('neither bloodies nor refreshes a coat from protected hits, and lets old stains fade during grazing hits', () => {
  const coats = new BloodCoats();
  coats.ingest([{ ...hit, damage: 0 }], 0);
  expect(coats.packed(2, 0)).toBe(0);
  coats.ingest([hit], 1);
  const dried = coats.packed(2, 601);
  coats.ingest([{ ...hit, damage: 0 }], 601);
  expect(coats.packed(2, 601)).toBe(dried);
  for (let tick = 721; tick <= 2401; tick += 120) coats.ingest([{ ...hit, damage: 1 }], tick);
  expect(amount(coats.packed(2, 2401))).toBeLessThan(amount(dried) / 3);
});
