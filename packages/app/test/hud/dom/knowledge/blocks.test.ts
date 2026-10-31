// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { type ArticleScope, renderBlock } from '../../../../src/hud/dom/knowledge/blocks.js';
import type { KnowledgeContext, KnowledgeMotion } from '../../../../src/hud/dom/knowledge/context.js';
import { filmBlock } from '../../../../src/hud/dom/knowledge/entry-parts.js';
import type { ArticleBlock } from '../../../../src/hud/knowledge/articles.js';
import { createKnowledgeBase } from '../../../../src/hud/knowledge/base.js';
import { knowledgeContent } from '../../../support/knowledge-content.js';

const figure = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/hud/dom/knowledge/figures/index.js', () => ({
  renderFigure: (...args: unknown[]) => {
    figure(...args);
    return document.createElement('figure');
  },
}));

const context = {
  base: createKnowledgeBase(knowledgeContent()),
  art: { goodIcon: () => undefined, motion: null },
  settlement: null,
  tribe: () => 1,
  go: () => undefined,
  onPageLeft: () => undefined,
  leavePage: () => undefined,
} as unknown as KnowledgeContext;

const scope: ArticleScope = {
  context,
  articles: { groups: [] },
  dataBlock: () => document.createElement('div'),
};

const render = (block: ArticleBlock): HTMLElement => renderBlock(block, scope);

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

describe('links', () => {
  const text = 'Mało [[good:wood|Drewna]] tu.';

  it('keeps the inflected label in its own language', () => {
    const link = render({ p: text }).querySelector<HTMLElement>('[data-go]');
    expect(link?.dataset.go).toBe('good:wood');
    expect(link?.textContent).toBe('Drewna');
  });

  it('escapes what an article writes', () => {
    expect(render({ p: '<img src=x>' }).querySelector('img')).toBeNull();
  });
});

describe('filter table', () => {
  const block: ArticleBlock = {
    table: {
      filter: 'Szukaj',
      head: ['Komunikat', 'Co'],
      rows: [
        ['"Żółta łąka"', 'a'],
        ['"Inny"', 'b'],
      ],
    },
  };

  it('matches without diacritics and reports an empty result', () => {
    const host = render(block);
    const input = host.querySelector('input');
    if (input === null) throw new Error('no field');
    expect(input.placeholder).toBe('Szukaj');
    const shown = () => [...host.querySelectorAll('tbody tr')].filter((row) => !(row as HTMLElement).hidden);
    input.value = 'zolta laka';
    input.dispatchEvent(new Event('input'));
    expect(shown()).toHaveLength(1);
    input.value = 'nic takiego';
    input.dispatchEvent(new Event('input'));
    expect(shown()).toHaveLength(0);
    expect(host.querySelector<HTMLElement>('.kn-empty')?.hidden).toBe(false);
  });
});

describe('other blocks', () => {
  it('folds an FAQ with native details', () => {
    const details = render({ faq: [['Q', 'A']] }).querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Q');
  });

  it('hands a figure to the figure renderer', () => {
    render({ figure: { id: 'exp-curve', caption: 'Krzywa' } });
    expect(figure).toHaveBeenCalledWith(context, 'exp-curve', 'Krzywa');
  });
});
