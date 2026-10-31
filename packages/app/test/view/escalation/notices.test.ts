import type { SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { NOTICE_SHOWN_MS, NoticeQueue, siegeNoticesOf } from '../../../src/view/escalation/notices.js';

describe('siegeNoticesOf', () => {
  it('announces each attack launch under the key it carries, every landing and gear step', () => {
    const events: SimEvent[] = [
      { kind: 'mapEscalationAttackLaunched', wave: 1, seats: [0], noticeKey: 'forteca.attack' },
      { kind: 'mapEscalationAttackLaunched', wave: 2, seats: [0], noticeKey: 'forteca.reinforcements' },
      { kind: 'mapEscalationAttackLaunched', wave: 3, seats: [0] },
      { kind: 'mapEscalationLanding', wave: 3, seats: [0], noticeKey: 'forteca.landing' },
      { kind: 'mapEscalationGearStep', step: 1, noticeKey: 'forteca.gear.lightArmor' },
    ];
    expect(siegeNoticesOf(events)).toEqual([
      'fortecaAttack',
      'fortecaReinforcements',
      'fortecaLanding',
      'fortecaLightArmor',
    ]);
  });
});

describe('NoticeQueue', () => {
  it('shows one notice at a time for its span, then the next, dropping a repeat that still waits', () => {
    const queue = new NoticeQueue<string>();
    expect(queue.current(0)).toBeNull();
    queue.push('a');
    queue.push('b');
    queue.push('b');
    expect(queue.current(10)?.notice).toBe('a');
    expect(queue.current(10 + NOTICE_SHOWN_MS - 1)?.notice).toBe('a');
    expect(queue.current(10 + NOTICE_SHOWN_MS)?.notice).toBe('b');
    expect(queue.current(10 + 2 * NOTICE_SHOWN_MS)).toBeNull();
  });
});
