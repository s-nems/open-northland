import type { ContentSet } from '@open-northland/data';
import type { UnlockKind, UnlockStatus } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeSettlement, knowledgeStatusOf } from '../../../src/hud/knowledge/settlement.js';
import { messages } from '../../../src/i18n/index.js';
import { GOOD, HOUSE, knowledgeContent, VIKING } from '../../support/knowledge-content.js';

const OPEN: UnlockStatus = {
  allowed: true,
  enabled: true,
  enablingJobs: [],
  requiredJobs: [],
  requiredGoods: [],
};
const BANNED: UnlockStatus = { ...OPEN, allowed: false, enabled: false };
const LOCKED: UnlockStatus = {
  ...OPEN,
  enabled: false,
  requiredGoods: [{ good: GOOD.iron, jobs: [] }],
};

const content: ContentSet = knowledgeContent();
const SEAT = 2;

describe('the settlement Knowledge reads', () => {
  it('tells a map ban from a discovery still to make', () => {
    expect(knowledgeStatusOf(content, OPEN).kind).toBe('available');
    expect(knowledgeStatusOf(content, BANNED).kind).toBe('mapForbidden');
    expect(knowledgeStatusOf(content, LOCKED)).toEqual({
      kind: 'locked',
      missing: [messages().goods.iron],
    });
  });

  it('reads each status for its seat and tribe, once per refresh, and never asks in between', async () => {
    const unlockStatus = vi.fn(
      (kind: UnlockKind, typeId: number): Promise<UnlockStatus> =>
        Promise.resolve(kind === 'house' && typeId === HOUSE.druid ? BANNED : OPEN),
    );
    const settlement = createKnowledgeSettlement({
      content,
      tribe: VIKING,
      seat: () => SEAT,
      unlockStatus,
      progressOf: () => () => null,
    });
    await settlement.refresh();
    const asked = unlockStatus.mock.calls.length;
    expect(unlockStatus).toHaveBeenCalledWith('house', HOUSE.druid, VIKING, SEAT);
    expect(settlement.status('building', HOUSE.druid).kind).toBe('mapForbidden');
    expect(settlement.status('job', 1).kind).toBe('available');
    expect(unlockStatus).toHaveBeenCalledTimes(asked);
  });

  it('a watcher with no seat reads everything open', async () => {
    const unlockStatus = vi.fn(() => Promise.resolve(BANNED));
    const settlement = createKnowledgeSettlement({
      content,
      tribe: VIKING,
      seat: () => null,
      unlockStatus,
      progressOf: () => () => null,
    });
    await settlement.refresh();
    expect(unlockStatus).not.toHaveBeenCalled();
    expect(settlement.status('building', HOUSE.druid).kind).toBe('available');
  });
});
