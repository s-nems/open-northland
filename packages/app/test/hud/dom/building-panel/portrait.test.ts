// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { BuildingPanelModel } from '../../../../src/hud/details-panel/model/index.js';
import type { BuildingPanelDeps } from '../../../../src/hud/dom/building-panel/actions.js';
import {
  createPortraitSection,
  MAX_ORDER_TILES,
  orderViews,
} from '../../../../src/hud/dom/building-panel/portrait.js';
import { warmBuildingModel } from '../../../../src/hud/dom/building-panel/warm-model.js';
import { messages } from '../../../../src/i18n/index.js';

const BUILDING = 7;

function setup(model: BuildingPanelModel) {
  let current = model;
  const setConstructionPriority = vi.fn();
  const section = createPortraitSection(
    {
      building: {
        upgrade: vi.fn(),
        cancelUpgrade: vi.fn(),
        demolish: vi.fn(),
        setConstructionPriority,
      },
      windows: { residentsFor: vi.fn(), knowledge: vi.fn() },
    } as unknown as BuildingPanelDeps,
    () => current,
    document.createElement('button'),
  );
  section.update(model);
  return {
    section,
    setConstructionPriority,
    update(next: BuildingPanelModel): void {
      current = next;
      section.update(next);
    },
  };
}

describe('building panel Prioritize order', () => {
  const site = { ...warmBuildingModel([]), entityId: BUILDING };
  const ordersOf = (model: BuildingPanelModel): string[] => orderViews(model).map((view) => view.order);

  it('gives a site Prioritize in place of the Upgrade it would refuse', () => {
    expect(ordersOf(site)).toEqual(['workers', 'knowledge', 'demolish', 'prioritize']);
    expect(orderViews(site)[3]).toMatchObject({ pressed: true, enabled: true });
    expect(ordersOf({ ...site, construction: null })).not.toContain('prioritize');
  });

  it('keeps Cancel on a building being upgraded and still fits the grid', () => {
    if (site.orders === null) throw new Error('warm model has no orders');
    const upgrading = { ...site, orders: { ...site.orders, cancelUpgrade: true } };
    expect(ordersOf(upgrading)).toEqual(['workers', 'demolish', 'prioritize', 'cancelUpgrade']);
    expect(ordersOf(upgrading).length).toBeLessThanOrEqual(MAX_ORDER_TILES);
  });

  it('toggles the mark with each press', () => {
    const { section, setConstructionPriority, update } = setup(site);
    const prioritizeButton = (): HTMLButtonElement | undefined =>
      [...section.element.querySelectorAll<HTMLButtonElement>('.on-order--tile')].find(
        (button) => button.textContent?.trim() === messages().hud.buildingPanel.orders.prioritize,
      );

    prioritizeButton()?.click();
    expect(setConstructionPriority).toHaveBeenNthCalledWith(1, BUILDING, false);

    const construction = site.construction;
    if (construction === null) throw new Error('warm model has no construction site');
    update({ ...site, construction: { ...construction, prioritized: false } });
    expect(prioritizeButton()?.getAttribute('aria-pressed')).toBe('false');

    prioritizeButton()?.click();
    expect(setConstructionPriority).toHaveBeenNthCalledWith(2, BUILDING, true);
  });
});
