// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeContext } from '../../../../src/hud/dom/knowledge/context.js';
import { createTreeView, type TreeScales } from '../../../../src/hud/dom/knowledge/tree-view.js';
import { createKnowledgeBase } from '../../../../src/hud/knowledge/base.js';
import { knowledgeContent } from '../../../support/knowledge-content.js';

vi.mock('../../../../src/hud/dom/knowledge/entry-view.js', () => ({
  renderEntry: () => document.createElement('div'),
}));

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

function mount(scales: TreeScales = { goods: 100, buildings: 100 }) {
  const view = createTreeView(context, 'goods', { scales, onClosePane: () => undefined });
  document.body.append(view.element);
  const slider = view.element.querySelector<HTMLInputElement>('.kn-zoom input');
  if (slider === null) throw new Error('no slider');
  return { view, slider, scales };
}

describe('the tree', () => {
  afterEach(() => document.body.replaceChildren());

  it('writes an amount as x3, apart from its icon', () => {
    const { view } = mount();
    const amounts = [...view.element.querySelectorAll('.kn-card__amount')].map((a) => a.textContent);
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) expect(amount).toMatch(/^x\d+$/);
  });

  it('keeps the scale on steps, inside its limits, for the next mount', () => {
    const { view, slider, scales } = mount();
    slider.value = '200';
    slider.dispatchEvent(new Event('input'));
    expect(scales.goods).toBe(130);
    view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, ctrlKey: true, cancelable: true }));
    expect(scales.goods).toBe(125);
    expect(mount(scales).slider.value).toBe('125');
  });

  it('leaves a plain wheel to the scroll', () => {
    const { view, scales } = mount();
    view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    expect(scales.goods).toBe(100);
  });
});
