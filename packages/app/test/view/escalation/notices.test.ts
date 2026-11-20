import type { SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  NOTICE_SHOWN_MS,
  NoticeQueue,
  noticeText,
  sameNotice,
  siegeNoticesOf,
} from '../../../src/view/escalation/notices.js';

const ATTACK = { title: 1 };
const REINFORCEMENTS = { title: 2, detail: 3 };
const LANDING = { title: 4 };
const LIGHT_ARMOR = { title: 5, detail: 6 };

describe('siegeNoticesOf', () => {
  it('announces each attack launch, landing and gear step with the notice it carries', () => {
    const events: SimEvent[] = [
      { kind: 'mapEscalationAttackLaunched', wave: 1, seats: [0], notice: ATTACK },
      { kind: 'mapEscalationAttackLaunched', wave: 2, seats: [0], notice: REINFORCEMENTS },
      { kind: 'mapEscalationAttackLaunched', wave: 3, seats: [0] },
      { kind: 'mapEscalationLanding', wave: 3, seats: [0], notice: LANDING },
      { kind: 'mapEscalationGearStep', step: 1, notice: LIGHT_ARMOR },
      { kind: 'mapEscalationGearStep', step: 2 },
    ];
    expect(siegeNoticesOf(events)).toEqual([ATTACK, REINFORCEMENTS, LANDING, LIGHT_ARMOR]);
  });
});

describe('noticeText', () => {
  const table: Record<number, string> = { 2: 'Reinforcements!', 3: 'A fleet.', 5: 'Stronger.' };
  const mapText = (id: number): string | undefined => table[id];

  it('reads the title and detail from the map strings, showing none without a title', () => {
    expect(noticeText(REINFORCEMENTS, mapText)).toEqual({ title: 'Reinforcements!', detail: 'A fleet.' });
    expect(noticeText(LIGHT_ARMOR, mapText)).toEqual({ title: 'Stronger.' });
    expect(noticeText(ATTACK, mapText)).toBeNull();
  });
});

describe('NoticeQueue', () => {
  it('shows one notice at a time for its span, then the next, dropping a repeat that still waits', () => {
    const queue = new NoticeQueue(sameNotice);
    expect(queue.current(0)).toBeNull();
    queue.push(ATTACK);
    queue.push(REINFORCEMENTS);
    queue.push({ ...REINFORCEMENTS });
    expect(queue.current(10)?.notice).toBe(ATTACK);
    expect(queue.current(10 + NOTICE_SHOWN_MS - 1)?.notice).toBe(ATTACK);
    expect(queue.current(10 + NOTICE_SHOWN_MS)?.notice).toBe(REINFORCEMENTS);
    expect(queue.current(10 + 2 * NOTICE_SHOWN_MS)).toBeNull();
  });
});
