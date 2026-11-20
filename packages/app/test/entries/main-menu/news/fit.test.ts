// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { fitPanel } from '../../../../src/entries/main-menu/news/fit.js';

/** jsdom lays nothing out: each column reports its content as `content(fit)` px in a room of `room` px,
 *  and each block ends at its given bottom. */
function panelOf(room: number, content: (fit: number) => number, blockBottoms: readonly number[]) {
  const panel = document.createElement('section');
  const fitNow = (): number => Number(panel.style.getPropertyValue('--news-fit') || '1');
  const column = document.createElement('div');
  const heading = document.createElement('button');
  const body = document.createElement('div');
  const blocks = blockBottoms.map((bottom) => {
    const block = document.createElement('article');
    block.getBoundingClientRect = () => DOMRect.fromRect({ y: bottom - 10, height: 10 });
    return block;
  });
  body.append(...blocks);
  column.append(heading, body);
  panel.append(column);
  Object.defineProperty(column, 'clientHeight', { get: () => room });
  Object.defineProperty(column, 'scrollHeight', { get: () => Math.max(room, Math.round(content(fitNow()))) });
  column.getBoundingClientRect = () => DOMRect.fromRect({ height: room });
  return { panel, heading, blocks, fitNow };
}

describe('news panel fit', () => {
  it('shrinks the content until the column holds it, and keeps every block', () => {
    const { panel, blocks, fitNow } = panelOf(80, (fit) => 100 * fit, [40, 80]);
    fitPanel(panel);
    expect(fitNow()).toBe(0.8);
    expect(blocks.map((block) => block.inert)).toEqual([false, false]);
  });

  it('keeps the heading of a column without room for any block', () => {
    const { panel, heading, blocks } = panelOf(80, (fit) => Math.max(100 * fit, 90), [90]);
    fitPanel(panel);
    expect([heading.inert, blocks[0]?.inert]).toEqual([false, true]);
  });

  it('stops once the floor holds and drops the blocks past the cap', () => {
    const { panel, heading, blocks, fitNow } = panelOf(80, (fit) => Math.max(100 * fit, 90), [50, 90]);
    fitPanel(panel);
    expect(fitNow()).toBe(0.85);
    expect(blocks.map((block) => block.inert)).toEqual([false, true]);
    expect(heading.inert).toBe(false);
  });

  it('leaves a panel that fits at full size', () => {
    const { panel, fitNow } = panelOf(200, (fit) => 100 * fit, [50]);
    fitPanel(panel);
    expect(panel.style.getPropertyValue('--news-fit')).toBe('');
    expect(fitNow()).toBe(1);
  });
});
