// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeContext, KnowledgeMotion } from '../../../../../src/hud/dom/knowledge/context.js';
import { filmBlock } from '../../../../../src/hud/dom/knowledge/entries/parts.js';
import { createKnowledgeBase } from '../../../../../src/hud/knowledge/base.js';
import { knowledgeContent } from '../../../../support/knowledge-content.js';

const context: KnowledgeContext = {
  base: createKnowledgeBase(knowledgeContent()),
  art: {
    goodIcon: () => undefined,
    buildingThumb: () => false,
    animalPicture: () => false,
    motion: null,
  },
  settlement: null,
  tribe: () => 1,
  go: () => undefined,
  onPageLeft: () => undefined,
  leavePage: () => undefined,
};

describe('filmBlock', () => {
  const clip = { kind: 'job', jobType: 1, tribe: 1, action: 'walk' } as const;
  const leaving: (() => void)[] = [];
  const stop = vi.fn();
  const withMotion = (motion: KnowledgeMotion): KnowledgeContext =>
    ({
      ...context,
      art: { ...context.art, motion },
      onPageLeft: (release: () => void) => leaving.push(release),
    }) as KnowledgeContext;

  it('hands each playing film to the page, and makes no block when none plays', () => {
    const played = filmBlock(withMotion({ play: () => stop }), [{ clip }, { clip }]);
    expect(played?.node.querySelectorAll('.kn-motion__clip')).toHaveLength(2);
    for (const release of leaving) release();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(filmBlock(withMotion({ play: () => null }), [{ clip }])).toBeNull();
  });
});
