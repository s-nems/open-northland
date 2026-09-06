import type { HypertextBook } from '@open-northland/data';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { MissionBrief } from '../src/game/mission-brief.js';
import type { Rect } from '../src/hud/geometry.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import { createMissionWindow, layoutMissionWindow } from '../src/hud/tool-panel/mission/index.js';

/**
 * The mission window controller over a stubbed context (no Pixi text): it opens on the task tab and
 * holds the pause, its tabs switch content, a history link opens its page, the Up/Down buttons page
 * through overflow, and the closer dismisses it.
 */

const SCREEN = { width: 1024, height: 768 };
/** Every stub paragraph is this tall (design px). */
const LINE_H = 10;
const RUN_W = 40;

function stubContext(): { ctx: PanelContext; made: string[]; placedY: Map<string, number> } {
  const made: string[] = [];
  const placedY = new Map<string, number>();
  const layout = buildToolPanelLayout(1);
  const ctx: PanelContext = {
    layout,
    scale: layout.scale,
    makeText: (text) => {
      made.push(text);
      return { container: new Container(), width: RUN_W, place: () => undefined, destroy: () => undefined };
    },
    makeParagraph: (text) => {
      made.push(text);
      return {
        container: new Container(),
        width: RUN_W,
        height: LINE_H,
        place: (_x, y) => placedY.set(text, y),
        destroy: () => undefined,
      };
    },
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => SCREEN,
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return { ctx, made, placedY };
}

const BOOK: HypertextBook = {
  start: 'index',
  pages: {
    index: [
      { kind: 'text', style: 'title', text: 'HISTORY', align: 'center' },
      { kind: 'text', style: 'body', text: 'Seven wonders', align: 'center', link: 'mythology_00' },
    ],
    mythology_00: [
      { kind: 'text', style: 'title', text: 'SEVEN WONDERS', align: 'center' },
      { kind: 'text', style: 'body', text: 'Back', link: 'index' },
    ],
  },
};

const BRIEF: MissionBrief = {
  title: 'SANDSTORM',
  blocks: [{ kind: 'text', style: 'body', text: 'Body' }],
  goals: [{ text: 'Win', rule: 'skirmish', done: false }],
};

function mount(brief: MissionBrief = BRIEF) {
  const { ctx, made, placedY } = stubContext();
  const opened: boolean[] = [];
  const window = createMissionWindow({
    ctx,
    container: new Container(),
    art: null,
    brief: () => brief,
    history: BOOK,
    onOpenChange: (open) => opened.push(open),
  });
  const layout = layoutMissionWindow(SCREEN, null);
  return { window, made, placedY, opened, layout };
}

const middle = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

describe('createMissionWindow', () => {
  it('opens on the task tab with the chrome strings, holding the pause, and claims only the window', () => {
    const { window, made, opened, layout } = mount();
    window.toggle();
    expect(opened).toEqual([true]);
    for (const text of ['Misja', 'Zadanie', 'Cele', 'Historia', 'SANDSTORM', 'Body']) {
      expect(made).toContain(text);
    }
    expect(made).not.toContain('Win');
    const { window: rect } = layout;
    expect(window.claims(rect.x + 1, rect.y + 1)).toBe(true);
    expect(window.claims(rect.x - 1, rect.y + 1)).toBe(false);
  });

  it('switches to the goals tab on its tab, printing the heading and the bullets', () => {
    const { window, made, layout } = mount();
    window.toggle();
    made.length = 0;
    const goalsTab = layout.tabs.find((t) => t.tab === 'goals');
    expect(goalsTab).toBeDefined();
    if (goalsTab === undefined) return;
    expect(window.handleClick(...middle(goalsTab.rect))).toBe(true);
    expect(made).toEqual(expect.arrayContaining(['Cele Misji', 'o', 'Win']));
    expect(made).not.toContain('Body');
  });

  it('follows a link in the history book and back to the index', () => {
    const { window, made, layout } = mount();
    window.toggle();
    const historyTab = layout.tabs.find((t) => t.tab === 'history');
    expect(historyTab).toBeDefined();
    if (historyTab === undefined) return;
    made.length = 0;
    window.handleClick(...middle(historyTab.rect));
    expect(made).toEqual(expect.arrayContaining(['HISTORY', 'Seven wonders']));
    const { viewport } = layout;
    // The link is the second paragraph: below the title and its gap, centred in the viewport.
    made.length = 0;
    window.handleClick(viewport.x + viewport.w / 2, viewport.y + LINE_H + 6 + 5);
    expect(made).toEqual(expect.arrayContaining(['SEVEN WONDERS', 'Back']));
    // A click beside a left-aligned link's glyphs is not a jump.
    made.length = 0;
    window.handleClick(viewport.x + RUN_W + 10, viewport.y + LINE_H + 6 + 5);
    expect(made).toEqual([]);
    window.handleClick(viewport.x + 5, viewport.y + LINE_H + 6 + 5);
    expect(made).toEqual(expect.arrayContaining(['HISTORY']));
  });

  it('pages through overflowing content with the Down and Up buttons', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => ({
      kind: 'text' as const,
      style: 'body' as const,
      text: `P${i}`,
    }));
    const { window, placedY, layout } = mount({ title: '', blocks, goals: [] });
    window.toggle();
    const { viewport } = layout;
    expect(placedY.get('P0')).toBe(viewport.y);
    window.handleClick(...middle(layout.scrollDown));
    expect(placedY.get('P0')).toBe(viewport.y - 60);
    window.handleClick(...middle(layout.scrollUp));
    expect(placedY.get('P0')).toBe(viewport.y);
  });

  it('keeps the arrows off a short goal list and reopens on the task tab', () => {
    const { window, made, layout } = mount();
    window.toggle();
    const goalsTab = layout.tabs.find((t) => t.tab === 'goals');
    if (goalsTab === undefined) throw new Error('no goals tab');
    window.handleClick(...middle(goalsTab.rect));
    // Nothing to scroll: a press on the (hidden) Down arrow is consumed but moves nothing.
    expect(window.handleClick(...middle(layout.scrollDown))).toBe(true);
    window.close();
    made.length = 0;
    window.toggle();
    expect(made).toContain('Body');
    expect(made).not.toContain('Win');
  });

  it('owns the wheel over the sheet and closes on the closer', () => {
    const { window, opened, layout } = mount();
    window.toggle();
    const { window: rect, closeRect } = layout;
    expect(window.handleWheel(rect.x + 10, rect.y + 10, 1)).toBe(true);
    expect(window.handleWheel(rect.x - 10, rect.y + 10, 1)).toBe(false);
    expect(window.handleClick(...middle(closeRect))).toBe(true);
    expect(window.isOpen()).toBe(false);
    expect(opened).toEqual([true, false]);
    expect(window.claims(rect.x + 1, rect.y + 1)).toBe(false);
  });
});
