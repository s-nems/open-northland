import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { NO_PANEL_HOVER, panelHoverAt, sameHover } from '../src/hud/details-panel/pointer-intent.js';
import { center, panelModelOf, viewOfKind } from './support/details-panel.js';

const wall: EntitySnapshot = {
  id: 8,
  components: {
    Palisade: {
      gfxIndex: 696,
      tribe: 1,
      built: ONE,
      gate: null,
    },
    Health: { hitpoints: 75, max: 100 },
  },
};

describe('details panel click intents', () => {
  it('writes the palisade hitpoints on their own row, clear of the bar, the progress and the buttons', () => {
    const view = viewOfKind(
      panelModelOf({ ...wall, components: { ...wall.components, UnderConstruction: {} } }),
      'palisade',
    );
    const { healthLabel, health, progress, buttons } = view.layout;
    if (progress === null) throw new Error('expected a progress row');
    expect(healthLabel.y + healthLabel.h).toBeLessThanOrEqual(health.y);
    expect(health.y + health.h).toBeLessThanOrEqual(progress.y);
    expect(progress.y + progress.h).toBeLessThanOrEqual(buttons[0]?.rect.y ?? Number.NaN);
  });
});

describe('details panel hover state', () => {
  it('reports the hovered button, and nothing off the panel', () => {
    const view = viewOfKind(panelModelOf(wall), 'palisade');
    const demolish = view.layout.buttons.find((b) => b.action === 'demolish-palisade');
    if (demolish === undefined) throw new Error('expected a demolish button');
    const p = center(demolish.rect);

    const hover = panelHoverAt(view, p.x, p.y);
    expect(hover.action).toBe('demolish-palisade');
    expect(sameHover(hover, NO_PANEL_HOVER)).toBe(false);

    const far = panelHoverAt(view, view.layout.panel.x - 50, view.layout.panel.y - 50);
    expect(sameHover(far, NO_PANEL_HOVER)).toBe(true);
  });
});
