// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { type ArticleScope, renderBlock } from '../../../../src/hud/dom/knowledge/blocks.js';
import type { KnowledgeContext } from '../../../../src/hud/dom/knowledge/context.js';
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
} as unknown as KnowledgeContext;

const scope = (nativeText: boolean): ArticleScope => ({
  context,
  nativeText,
  articles: { language: 'pol', groups: [] },
  dataBlock: () => document.createElement('div'),
});

const render = (block: ArticleBlock, nativeText = true): HTMLElement => renderBlock(block, scope(nativeText));

describe('links', () => {
  const text = 'Mało [[good:wood|Drewna]] tu.';

  it('keeps the inflected label in its own language', () => {
    const link = render({ p: text }).querySelector<HTMLElement>('[data-go]');
    expect(link?.dataset.go).toBe('good:wood');
    expect(link?.textContent).toBe('Drewna');
  });

  it("shows the reader's name over fallback text", () => {
    expect(render({ p: text }, false).querySelector('[data-go]')?.textContent).toBe(
      context.base.goodById.get('wood')?.name,
    );
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
