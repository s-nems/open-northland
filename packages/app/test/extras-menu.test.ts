import { describe, expect, it } from 'vitest';
import {
  adjustCounter,
  COUNTER_MAX,
  COUNTER_MIN,
  defaultAssistantState,
  hitTestExtrasMenu,
  layoutExtrasMenu,
  toggleGrant,
  toggleInfinity,
} from '../src/hud/tool-panel/extras-menu.js';
import { messages } from '../src/i18n/index.js';

/** Headless tests for the extras ("chest") window model: state transitions, layout and hit routing. */

const OPTS = {
  originX: 100,
  originY: 20,
  scale: 1,
  state: defaultAssistantState(),
} as const;

const COUNTER_ROW_IDS = [
  'extraWomen',
  'extraMen',
  'trainSoldiers',
  'trainSwordsmen',
  'trainSpearmen',
  'trainArchers',
] as const;

function centreOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe('assistant state', () => {
  it('defaults to six zeroed finite counters and every grant ON', () => {
    const s = defaultAssistantState();
    expect(Object.keys(s.counters)).toEqual([...COUNTER_ROW_IDS]);
    for (const id of COUNTER_ROW_IDS) expect(s.counters[id]).toEqual({ value: 0, infinite: false });
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
    expect(s.counters.extraWomen.value).toBe(1);
    expect(s.counters.extraMen.value).toBe(0); // siblings untouched

    expect(adjustCounter(s, 'extraMen', -1)).toBe(s); // already at the floor
    expect(adjustCounter(s, 'extraMen', -1).counters.extraMen.value).toBe(COUNTER_MIN);

    for (let i = 0; i < COUNTER_MAX + 10; i++) s = adjustCounter(s, 'extraWomen', 1);
    expect(s.counters.extraWomen.value).toBe(COUNTER_MAX);
    expect(COUNTER_MAX).toBe(100);
    expect(adjustCounter(s, 'extraWomen', 1)).toBe(s); // already at the cap
  });

  it('a coarse step lands mid-range and clamps at the cap, never overshooting', () => {
    let s = defaultAssistantState();
    for (let i = 0; i < 11; i++) s = adjustCounter(s, 'trainArchers', 10);
    expect(s.counters.trainArchers.value).toBe(COUNTER_MAX);
    expect(adjustCounter(s, 'trainArchers', -10).counters.trainArchers.value).toBe(COUNTER_MAX - 10);
  });

  it('toggles infinity on the queue rows; the first step off infinity only surfaces the value', () => {
    let s = adjustCounter(defaultAssistantState(), 'trainSoldiers', 5);
    s = toggleInfinity(s, 'trainSoldiers');
    expect(s.counters.trainSoldiers).toEqual({ value: 5, infinite: true });
    expect(toggleInfinity(s, 'trainSoldiers').counters.trainSoldiers.infinite).toBe(false);

    // The lemniscate hides the number: a blind step must not land on an unpredictable stored±1.
    s = adjustCounter(s, 'trainSoldiers', -1);
    expect(s.counters.trainSoldiers).toEqual({ value: 5, infinite: false });
    expect(adjustCounter(s, 'trainSoldiers', -1).counters.trainSoldiers.value).toBe(4);
  });

  it('refuses infinity on extraWomen (it outranks the son queue)', () => {
    const s = defaultAssistantState();
    expect(toggleInfinity(s, 'extraWomen')).toBe(s);
  });

  it('flips a grant without touching its siblings', () => {
    const s = toggleGrant(defaultAssistantState(), 'giveMead');
    expect(s.grants.giveMead).toBe(false);
    expect(s.grants.giveBoots).toBe(true);
    expect(toggleGrant(s, 'giveMead').grants.giveMead).toBe(true);
  });
});

describe('extras menu layout', () => {
  it('lays out the headline, the assistant tab under it and the rows below, grants gapped from counters', () => {
    const layout = layoutExtrasMenu(OPTS);
    expect(layout.title).toBe(messages().hud.extras.title);
    expect(layout.titleRect.y).toBe(layout.window.y);
    // The one tab left (the papers are the construction window's page) sits right under the headline.
    expect(layout.tabs.map((t) => [t.label, t.selected])).toEqual([
      [messages().hud.extras.assistantTab, true],
    ]);
    expect(layout.tabs[0]?.rect.y).toBe(layout.window.y + layout.titleRect.h);

    expect(layout.counters.map((c) => c.id)).toEqual([...COUNTER_ROW_IDS]);
    expect(layout.grants.map((g) => g.id)).toEqual([
      'giveBoots',
      'giveWoodenTools',
      'giveIronTools',
      'giveMead',
    ]);

    // The grant block starts a visible gap below the last counter row (the requested "lekki odstęp").
    const lastCounterY = layout.counters[5]?.rect.y ?? 0;
    const firstGrantY = layout.grants[0]?.rect.y ?? 0;
    const counterRowH = (layout.counters[1]?.rect.y ?? 0) - (layout.counters[0]?.rect.y ?? 0);
    expect(firstGrantY - lastCounterY).toBeGreaterThan(counterRowH);

    // Everything sits inside the window rect.
    const right = layout.window.x + layout.window.w;
    const bottom = layout.window.y + layout.window.h;
    for (const c of layout.counters) {
      expect(c.plusRect.x + c.plusRect.w).toBeLessThanOrEqual(right);
      expect(c.plusRect.y + c.plusRect.h).toBeLessThanOrEqual(bottom);
      if (c.infinityRect !== null) expect(c.infinityRect.x).toBeGreaterThanOrEqual(layout.window.x);
    }
    for (const g of layout.grants) {
      expect(g.switchRect.x + g.switchRect.w).toBeLessThanOrEqual(right);
      expect(g.switchRect.y + g.switchRect.h).toBeLessThanOrEqual(bottom);
    }
  });

  it('gives every queue row an infinity toggle left of its stepper - but not extraWomen', () => {
    const layout = layoutExtrasMenu(OPTS);
    for (const c of layout.counters) {
      if (c.id === 'extraWomen') {
        expect(c.infinityRect).toBeNull();
        continue;
      }
      expect(c.infinityRect).not.toBeNull();
      if (c.infinityRect !== null) {
        expect(c.infinityRect.x + c.infinityRect.w).toBeLessThanOrEqual(c.minusRect.x);
      }
    }
  });

  it('labels come from the active catalog and values/faces mirror the state', () => {
    const state = toggleGrant(
      toggleInfinity(adjustCounter(defaultAssistantState(), 'trainSoldiers', 1), 'trainArchers'),
      'giveIronTools',
    );
    const layout = layoutExtrasMenu({ ...OPTS, state });
    const hud = messages().hud.extras;
    expect(layout.counters[0]?.label).toBe(hud.extraWomen);
    expect(layout.counters[3]?.label).toBe(hud.trainSwordsmen);
    expect(layout.grants[3]?.label).toBe(hud.giveMead);
    expect(layout.counters[2]?.value).toBe(1);
    expect(layout.counters[5]?.infinite).toBe(true);
    expect(layout.grants[2]?.on).toBe(false);
    expect(layout.grants[0]?.on).toBe(true);
  });
});

describe('extras menu hit-test', () => {
  const layout = layoutExtrasMenu(OPTS);

  it('routes close, steppers, infinity toggles and switches; the bare chrome is a consumed no-op', () => {
    const close = centreOf(layout.closeRect);
    expect(hitTestExtrasMenu(layout, close.x, close.y)).toEqual({ kind: 'close' });

    // The one tab is not a control: a press on it reads as the window body.
    const tab = centreOf(layout.tabs[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, tab.x, tab.y)).toEqual({ kind: 'window' });

    const minus = centreOf(layout.counters[1]?.minusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, minus.x, minus.y)).toEqual({
      kind: 'counter',
      id: 'extraMen',
      delta: -1,
    });
    const plus = centreOf(layout.counters[4]?.plusRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, plus.x, plus.y)).toEqual({
      kind: 'counter',
      id: 'trainSpearmen',
      delta: 1,
    });

    const infinity = centreOf(layout.counters[2]?.infinityRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, infinity.x, infinity.y)).toEqual({
      kind: 'counterInfinity',
      id: 'trainSoldiers',
    });

    const sw = centreOf(layout.grants[1]?.switchRect ?? { x: 0, y: 0, w: 0, h: 0 });
    expect(hitTestExtrasMenu(layout, sw.x, sw.y)).toEqual({ kind: 'grant', id: 'giveWoodenTools' });

    // Label area (the card's left half): inside the window but not a control.
    const card = layout.counters[0]?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    expect(hitTestExtrasMenu(layout, card.x + 2, card.y + card.h / 2)).toEqual({ kind: 'window' });
    expect(hitTestExtrasMenu(layout, layout.window.x - 1, layout.window.y - 1)).toBeNull();
  });
});
