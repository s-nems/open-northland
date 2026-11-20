// @vitest-environment jsdom
import type { SimEvent } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { mountSiegePresentation } from '../../../src/view/escalation/index.js';
import { NOTICE_SHOWN_MS } from '../../../src/view/escalation/notices.js';

afterEach(() => document.body.replaceChildren());

describe('mountSiegePresentation', () => {
  it('shows a notice raised again while it stands as a fresh one once the first runs out', () => {
    const plane = document.createElement('div');
    document.body.append(plane);
    let nowMs = 0;
    const siege = mountSiegePresentation({
      host: { mapEscalation: () => null },
      variant: null,
      plane,
      mapText: () => 'Ships are landing!',
      setAttackNight: () => {},
      setModeMark: () => {},
      playAttackMusic: () => {},
      now: () => nowMs,
    });
    const landing: SimEvent[] = [{ kind: 'mapEscalationLanding', wave: 1, seats: [0], notice: { title: 1 } }];
    siege.onEvents(landing);
    siege.frame();
    const first = plane.firstElementChild;
    nowMs = NOTICE_SHOWN_MS / 2;
    siege.onEvents(landing);
    siege.frame();
    expect(plane.firstElementChild).toBe(first);
    nowMs = NOTICE_SHOWN_MS;
    siege.frame();
    expect(plane.children).toHaveLength(1);
    expect(plane.firstElementChild).not.toBe(first);
    siege.dispose();
  });
});
