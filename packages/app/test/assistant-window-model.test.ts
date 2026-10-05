import { describe, expect, it } from 'vitest';
import {
  birthNotes,
  counterFace,
  counterFromFace,
  counterRange,
  PRESS_HOLD_TICKS,
  PressHold,
  trainingNotes,
  UNLIMITED_FACE,
  weaponStocked,
} from '../src/hud/dom/assistant-window/model.js';
import { assistantBookingsOf } from '../src/view/assistant-situation.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const finite = (value: number) => ({ value, infinite: false });
const endless = (value = 0) => ({ value, infinite: true });

describe('assistant counter faces', () => {
  it('gives ∞ only to the kinds the sim lets run forever, within the sim clamp', () => {
    expect(counterRange('extraWomen')).toEqual({ min: 0, max: 100 });
    expect(counterRange('extraMen')).toEqual({ min: 0, max: 100, unlimited: UNLIMITED_FACE });
    expect(counterRange('trainBow').unlimited).toBe(UNLIMITED_FACE);
  });

  it('shows ∞ over the retained value and keeps that value when ∞ is set', () => {
    expect(counterFace(endless(7))).toBe(UNLIMITED_FACE);
    expect(counterFace(finite(7))).toBe(7);
    expect(counterFromFace(finite(7), UNLIMITED_FACE)).toEqual(endless(7));
    expect(counterFromFace(endless(7), 0)).toEqual(finite(0));
  });
});

describe('assistant status notes', () => {
  it('says nothing for an idle birth counter', () => {
    expect(birthNotes(finite(0), 0)).toEqual([]);
  });

  it('splits a birth counter into children on the way and orders waiting for a couple', () => {
    expect(birthNotes(finite(3), 2)).toEqual([
      { key: 'expected', count: 2 },
      { key: 'needsCouple', count: 1 },
    ]);
    expect(birthNotes(finite(2), 2)).toEqual([{ key: 'expected', count: 2 }]);
  });

  it('keeps telling a booked child after the counter was run down to zero', () => {
    expect(birthNotes(finite(0), 1)).toEqual([{ key: 'expected', count: 1 }]);
  });

  it('only says an endless counter waits while nothing is booked', () => {
    expect(birthNotes(endless(), 0)).toEqual([{ key: 'needsCouple', count: null }]);
    expect(birthNotes(endless(), 1)).toEqual([{ key: 'expected', count: 1 }]);
  });

  it('follows recruits from the barracks to the weapon, then names what blocks the rest', () => {
    const facts = { drilling: 1, arming: 1, weaponStocked: true };
    expect(trainingNotes(finite(4), facts)).toEqual([
      { key: 'drilling', count: 1 },
      { key: 'fetchingWeapon', count: 1 },
      { key: 'needsMen', count: 2 },
    ]);
    expect(trainingNotes(finite(2), { ...facts, weaponStocked: false })).toEqual([
      { key: 'drilling', count: 1 },
      { key: 'needsWeapon', count: 1 },
    ]);
  });

  it('says an endless training counter waits only while nobody is booked', () => {
    const idle = { drilling: 0, arming: 0, weaponStocked: null };
    expect(trainingNotes(finite(3), idle)).toEqual([{ key: 'needsMen', count: 3 }]);
    expect(trainingNotes(endless(), idle)).toEqual([{ key: 'needsMen', count: null }]);
    expect(trainingNotes(endless(), { ...idle, drilling: 1 })).toEqual([{ key: 'drilling', count: 1 }]);
    expect(trainingNotes(finite(0), idle)).toEqual([]);
  });
});

const SEAT = 1;
const OTHER = 2;

const wife = (id: number, player: number, sex: 'female' | 'male'): Ent => ({
  id,
  components: { Owner: { player }, AssistantChildOrder: { sex } },
});
const recruit = (id: number, player: number, intent: string, armed: boolean, drilling: boolean): Ent => ({
  id,
  components: {
    Owner: { player },
    AssistantRecruit: { intent, armed },
    ...(drilling ? { TrainingOrder: { house: 0 } } : {}),
  },
});

describe('assistant bookings off the snapshot', () => {
  it("counts only the seat's own bookings, by sex and by stage", () => {
    const snapshot = snapshotOf([
      wife(1, SEAT, 'female'),
      wife(2, SEAT, 'female'),
      wife(3, SEAT, 'male'),
      wife(4, OTHER, 'female'),
      recruit(5, SEAT, 'trainSword', false, true),
      recruit(6, SEAT, 'trainSword', false, false),
      recruit(7, SEAT, 'trainSword', true, false), // armed: only the armor leg is left
      recruit(8, SEAT, 'trainSoldiers', false, true),
      recruit(9, OTHER, 'trainBow', false, true),
    ]);
    const bookings = assistantBookingsOf(snapshot, SEAT);
    expect(bookings.daughters).toBe(2);
    expect(bookings.sons).toBe(1);
    expect(bookings.drilling).toEqual({ trainSoldiers: 1, trainSword: 1, trainSpear: 0, trainBow: 0 });
    expect(bookings.arming).toEqual({ trainSoldiers: 0, trainSword: 1, trainSpear: 0, trainBow: 0 });
  });
});

describe('weapon stock for a class', () => {
  it('counts the weaker weapon only while its switch allows it', () => {
    expect(weaponStocked(1, 0, false)).toBe(true);
    expect(weaponStocked(0, 2, true)).toBe(true);
    expect(weaponStocked(0, 2, false)).toBe(false);
    expect(weaponStocked(0, 0, true)).toBe(false);
  });
});

describe('assistant press hold', () => {
  it('lets a second quick press step on from the first before the sim shows either', () => {
    const hold = new PressHold<string, number>((a, b) => a === b);
    hold.hold('men', 1, 0, 10);
    expect(hold.shown('men', 0, 11)).toBe(1); // the first press is still travelling
    hold.hold('men', hold.shown('men', 0, 11) + 1, 0, 11);
    expect(hold.shown('men', 1, 12)).toBe(2); // the first landed, the second has not
    expect(hold.shown('men', 2, 13)).toBe(2);
    expect(hold.shown('men', 5, 14)).toBe(5); // matched once: the live value leads again
  });

  it('holds a press made away and back until both commands have landed', () => {
    const hold = new PressHold<string, boolean>((a, b) => a === b);
    hold.hold('mead', true, false, 0);
    hold.hold('mead', false, false, 1); // pressed again before the first landed
    expect(hold.shown('mead', false, 2)).toBe(false);
    expect(hold.shown('mead', true, 3)).toBe(false); // the first command landed, the second not yet
    expect(hold.shown('mead', false, 4)).toBe(false);
    expect(hold.shown('mead', true, 5)).toBe(true); // answered: the live value leads again
  });

  it('gives way to the live value once the hold runs out', () => {
    const hold = new PressHold<string, number>((a, b) => a === b);
    hold.hold('men', 3, 2, 0);
    expect(hold.shown('men', 2, PRESS_HOLD_TICKS)).toBe(3);
    expect(hold.shown('men', 2, PRESS_HOLD_TICKS + 1)).toBe(2);
  });
});
