// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { BuildingPanelModel } from '../../../../src/hud/details-panel/model/index.js';
import type { BuildingPanelDeps } from '../../../../src/hud/dom/building-panel/actions.js';
import { createPortraitSection, orderViews } from '../../../../src/hud/dom/building-panel/portrait.js';
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
  it('places a same-sized Prioritize tile directly after Demolish for construction sites', () => {
    const model = { ...warmBuildingModel([]), entityId: BUILDING };
    const views = orderViews(model);
    const demolish = views.findIndex((view) => view.order === 'demolish');
    const prioritize = views[demolish + 1];
    expect(demolish).toBeGreaterThanOrEqual(0);
    expect(prioritize?.order).toBe('prioritize');
    expect(prioritize?.label).toBe(messages().hud.buildingPanel.orders.prioritize);
    expect(prioritize?.pressed).toBe(true);
    expect(prioritize?.enabled).toBe(true);

    const finished = orderViews({ ...model, construction: null });
    expect(finished.some((view) => view.order === 'prioritize')).toBe(false);
  });

  it('toggles between the former High priority and the normal state', () => {
    const model = { ...warmBuildingModel([]), entityId: BUILDING };
    const { section, setConstructionPriority, update } = setup(model);
    const prioritizeButton = (): HTMLButtonElement | undefined =>
      [...section.element.querySelectorAll<HTMLButtonElement>('.on-order--tile')].find(
        (button) => button.textContent?.trim() === messages().hud.buildingPanel.orders.prioritize,
      );

    prioritizeButton()?.click();
    expect(setConstructionPriority).toHaveBeenNthCalledWith(1, BUILDING, 'normal');

    const site = model.construction;
    if (site === null) throw new Error('warm model has no construction site');
    update({ ...model, construction: { ...site, priority: 'normal' } });
    expect(prioritizeButton()?.getAttribute('aria-pressed')).toBe('false');

    prioritizeButton()?.click();
    expect(setConstructionPriority).toHaveBeenNthCalledWith(2, BUILDING, 'high');
  });
});
