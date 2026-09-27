import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  NO_PANEL_HOVER,
  panelClickAt,
  panelHoverAt,
  sameHover,
} from '../src/hud/details-panel/pointer-intent.js';
import { center, panelModelOf, viewOfKind } from './support/details-panel.js';

const signpost: EntitySnapshot = { id: 7, components: { Signpost: {} } };
const closedGate: EntitySnapshot = {
  id: 8,
  components: {
    Palisade: {
      gfxIndex: 696,
      tribe: 1,
      built: ONE,
      gate: { open: false, counterpartGfxIndex: 700 },
    },
    Health: { hitpoints: 75, max: 100 },
  },
};

describe('details panel click intents', () => {
  it('resolves the demolish button of a signpost into its order', () => {
    const sign = viewOfKind(panelModelOf(signpost), 'signpost');
    const sp = center(sign.layout.button.rect);
    expect(panelClickAt(sign, sp.x, sp.y)).toEqual({
      kind: 'demolishSignpost',
      entityId: 7,
    });
  });

  it('reports palisade health and routes the gate and demolish controls', () => {
    const model = panelModelOf(closedGate);
    expect(model).toMatchObject({
      kind: 'palisade',
      entityId: 8,
      builtPct: 100,
      gateOpen: false,
      underConstruction: false,
    });
    if (model.kind !== 'palisade') throw new Error('expected a palisade model');
    expect(model.health?.pct).toBe(75);
    const view = viewOfKind(model, 'palisade');
    expect(view.layout.progress).toBeNull();

    const intents = view.layout.buttons.map((button) => {
      const p = center(button.rect);
      return panelClickAt(view, p.x, p.y);
    });
    expect(intents).toEqual([
      { kind: 'setPalisadeGate', entityId: 8, open: true },
      { kind: 'demolishPalisade', entityId: 8 },
    ]);
  });

  it('writes the palisade hitpoints on their own row, clear of the bar, the progress and the buttons', () => {
    const view = viewOfKind(
      panelModelOf({ ...closedGate, components: { ...closedGate.components, UnderConstruction: {} } }),
      'palisade',
    );
    const { healthLabel, health, progress, buttons } = view.layout;
    if (progress === null) throw new Error('expected a progress row');
    expect(healthLabel.y + healthLabel.h).toBeLessThanOrEqual(health.y);
    expect(health.y + health.h).toBeLessThanOrEqual(progress.y);
    expect(progress.y + progress.h).toBeLessThanOrEqual(buttons[0]?.rect.y ?? Number.NaN);
  });

  it('keeps an unfinished gate shut, and lets a damaged gate open and close', () => {
    const unfinished = viewOfKind(
      panelModelOf({
        ...closedGate,
        components: { ...closedGate.components, UnderConstruction: {} },
      }),
      'palisade',
    );
    const unfinishedIntents = unfinished.layout.buttons.map((button) => {
      const p = center(button.rect);
      return panelClickAt(unfinished, p.x, p.y);
    });
    expect(unfinished.layout.buttons.map((button) => button.enabled)).toEqual([false, true]);
    expect(unfinished.layout.progress).not.toBeNull();
    expect(unfinishedIntents).toEqual([null, { kind: 'demolishPalisade', entityId: 8 }]);

    const damaged = viewOfKind(
      panelModelOf({
        ...closedGate,
        components: { ...closedGate.components, Damaged: { lastHitTick: 3 } },
      }),
      'palisade',
    );
    expect(damaged.model).toMatchObject({ underConstruction: false });
    expect(damaged.layout.progress).toBeNull();
    expect(damaged.layout.buttons.map((button) => button.enabled)).toEqual([true, true]);
  });

  it('resolves nothing for a disabled button or a point on inert chrome', () => {
    const view = viewOfKind(
      panelModelOf({ ...closedGate, components: { ...closedGate.components, UnderConstruction: {} } }),
      'palisade',
    );
    const gate = view.layout.buttons[0];
    if (gate === undefined || gate.enabled) throw new Error('expected a disabled gate button');
    const p = center(gate.rect);
    expect(panelClickAt(view, p.x, p.y)).toBeNull();
    expect(panelClickAt(view, view.layout.panel.x - 50, view.layout.panel.y - 50)).toBeNull();
  });
});

describe('details panel hover state', () => {
  it('reports the hovered button, and nothing off the panel', () => {
    const view = viewOfKind(panelModelOf(closedGate), 'palisade');
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
