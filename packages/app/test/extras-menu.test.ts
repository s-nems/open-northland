import { describe, expect, it } from 'vitest';
import {
  adjustCounter,
  COUNTER_MAX,
  COUNTER_MIN,
  defaultAssistantState,
  hitTestExtrasMenu,
  layoutExtrasMenu,
  toggleGrant,
} from '../src/hud/tool-panel/extras-menu.js';
import { messages } from '../src/i18n/index.js';

/** Headless tests for the extras ("chest") window model: state transitions, layout and hit routing. */

const OPTS = {
  originX: 100,
  originY: 20,
  scale: 1,
  tab: 'assistant',
  state: defaultAssistantState(),
} as const;

function centreOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe('assistant state', () => {
  it('defaults to zero counters and every grant ON', () => {
    const s = defaultAssistantState();
    expect(s.counters).toEqual({ extraWomen: 0, extraMen: 0, trainSoldiers: 0 });
    expect(s.grants).toEqual({
      giveBoots: true,
      giveWoodenTools: true,
      giveIronTools: true,
      giveMead: true,
    });
  });

  it('steps a counter and clamps at both bounds (same state object on a clamped no-op)', () => {
    let s = defaultAssistantState();
    s = adjustCounter(s, 'extraWomen', 1);
    expect(s.counters.extraWomen).toBe(1);
    expect(s.counters.extraMen).toBe(0); // siblings untouched

    expect(adjustCounter(s, 'extraMen', -1)).toBe(s); // already at the floor
    expect(adjustCounter(s, 'extraMen', -1).counters.extraMen).toBe(COUNTER_MIN);

    for (let i = 0; i < COUNTER_MAX + 10; i++) s = adjustCounter(s, 'extraWomen', 1);
    expect(s.counters.extraWomen).toBe(COUNTER_MAX);
    expect(adjustCounter(s, 'extraWomen', 1)).toBe(s); // already at the cap
  });

  it('flips a grant without touching its siblings', () => {
    const s = toggleGrant(defaultAssistantState(), 'giveMead');
    expect(s.grants.giveMead).toBe(false);
    expect(s.grants.giveBoots).toBe(true);
    expect(toggleGrant(s, 'giveMead').grants.giveMead).toBe(true);
  });
});

describe('extras menu layout', () => {
  it('lays out the headline, the tabs under it and the assistant rows below, grants gapped from counters', () => {
    const layout = layoutExtrasMenu(OPTS);
    expect(layout.title).toBe(messages().hud.extras.title);
    expect(layout.titleRect.y).toBe(layout.window.y);
    expect(layout.tabs.map((t) => t.tab)).toEqual(['assistant', 'plans']);
    expect(layout.tabs[0]?.selected).toBe(true);
    // Tabs sit side by side on one line right under the headline band.
    expect(layout.tabs[1]?.rect.y).toBe(layout.tabs[0]?.rect.y);
    expect(layout.tabs[0]?.rect.y).toBe(layout.window.y + layout.titleRect.h);

    expect(layout.counters.map((c) => c.id)).toEqual(['extraWomen', 'extraMen', 'trainSoldiers']);
    expect(layout.grants.map((g) => g.id)).toEqual([
      'giveBoots',
      'giveWoodenTools',
      'giveIronTools',
      'giveMead',
    ]);
    expect(layout.plansPlaceholder).toBeNull();

    // The grant block starts a visible gap below the last counter row (the requested "lekki odstęp").
    const lastCounterY = layout.counters[2]?.rect.y ?? 0;
    const firstGrantY = layout.grants[0]?.rect.y ?? 0;
    const counterRowH = (layout.counters[1]?.rect.y ?? 0) - (layout.counters[0]?.rect.y ?? 0);
    expect(firstGrantY - lastCounterY).toBeGreaterThan(counterRowH);

    // Everything sits inside the window rect.
    const right = layout.window.x + layout.window.w;
    const bottom = layout.window.y + layout.window.h;
    for (const c of layout.counters) {
      expect(c.plusRect.x + c.plusRect.w).toBeLessThanOrEqual(right);
      expect(c.plusRect.y + c.plusRect.h).toBeLessThanOrEqual(bottom);
    }
    for (const g of layout.grants) {
      expect(g.switchRect.x + g.switchRect.w).toBeLessThanOrEqual(right);
      expect(g.switchRect.y + g.switchRect.h).toBeLessThanOrEqual(bottom);
    }
  });

  it('labels come from the active catalog and values/faces mirror the state', () => {
    const state = toggleGrant(adjustCounter(defaultAssistantState(), 'trainSoldiers', 1), 'giveIronTools');
    const layout = layoutExtrasMenu({ ...OPTS, state });
    const hud = messages().hud.extras;
    expect(layout.counters[0]?.label).toBe(hud.extraWomen);
    expect(layout.grants[3]?.label).toBe(hud.giveMead);
    expect(layout.counters[2]?.value).toBe(1);
    expect(layout.grants[2]?.on).toBe(false);
    expect(layout.grants[0]?.on).toBe(true);
  });

  it('the plans tab shows only the placeholder and shrinks the window', () => {
    const assistant = layoutExtrasMenu(OPTS);
    const plans = layoutExtrasMenu({ ...OPTS, tab: 'plans' });
    expect(plans.counters).toEqual([]);
    expect(plans.grants).toEqual([]);
    expect(plans.plansPlaceholder?.label).toBe(messages().hud.extras.plansEmpty);
    expect(plans.window.h).toBeLessThan(assistant.window.h);
  });
});

describe('extras menu hit-test', () => {
  const layout = layoutExtrasMenu(OPTS);

  it('routes close, tabs, steppers and switches; the bare chrome is a consumed no-op', () => {
    const close = centreOf(layout.closeRect);
    expect(hitTestExtrasMenu(layout, close.x, close.y)).toEqual({ kind: 'close' });

    const plansTab = centreOf(layout.tabs[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, plansTab.x, plansTab.y)).toEqual({ kind: 'tab', tab: 'plans' });

    const minus = centreOf(layout.counters[1]?.minusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, minus.x, minus.y)).toEqual({
      kind: 'counter',
      id: 'extraMen',
      delta: -1,
    });
    const plus = centreOf(layout.counters[2]?.plusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, plus.x, plus.y)).toEqual({
      kind: 'counter',
      id: 'trainSoldiers',
      delta: 1,
    });

    const sw = centreOf(layout.grants[1]?.switchRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, sw.x, sw.y)).toEqual({ kind: 'grant', id: 'giveWoodenTools' });

    // Label area (the card's left half): inside the window but not a control.
    const card = layout.counters[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    expect(hitTestExtrasMenu(layout, card.x + 2, card.y + card.h / 2)).toEqual({ kind: 'window' });
    expect(hitTestExtrasMenu(layout, layout.window.x - 1, layout.window.y - 1)).toBeNull();
  });
});
