import type { HypertextBook } from '@open-northland/data';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { MissionBrief } from '../src/game/mission-brief.js';
import type { Rect } from '../src/hud/geometry.js';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import {
  AUTO_SCROLL_DELAY_MS,
  AUTO_SCROLL_PX_PER_S,
  MAX_CREEP_STEP_MS,
} from '../src/hud/tool-panel/mission/creep.js';
import { createMissionWindow, layoutMissionWindow } from '../src/hud/tool-panel/mission/index.js';

/**
 * The mission window controller over a stubbed context (no Pixi text): it opens on the task tab and
 * holds the pause, its tabs switch content, a history link opens its page, the Up/Down buttons page
 * through overflow, an unread page creeps down on its own, and the closer dismisses it.
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
  goals: [{ text: 'Win', rule: 'skirmish', state: 'open' }],
};

function mount(
  brief: MissionBrief = BRIEF,
  now: () => number = () => 0,
  replayPage: number | null = null,
  briefingHistory: readonly number[] = [],
) {
  const { ctx, made, placedY } = stubContext();
  const opened: boolean[] = [];
  const asked: (number | null)[] = [];
  const window = createMissionWindow({
    ctx,
    container: new Container(),
    art: null,
    brief: (page) => {
      asked.push(page);
      return page === null ? brief : { ...brief, title: `PAGE ${page}` };
    },
    replayPage: () => replayPage,
    briefingHistory: () => briefingHistory,
    history: BOOK,
    onOpenChange: (open) => opened.push(open),
    now,
  });
  const layout = layoutMissionWindow(SCREEN, null);
  return { window, made, placedY, opened, asked, layout };
}

const middle = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

describe('createMissionWindow', () => {
  it('restores briefing navigation and falls back to the last delivered page without a replay page', () => {
    const { window, asked, opened, layout } = mount(BRIEF, () => 0, null, [500, 501]);
    window.toggle();
    expect(asked.at(-1)).toBe(501);
    expect(opened).toEqual([true]);
    window.handleClick(...middle(layout.historyPrev));
    expect(asked.at(-1)).toBe(500);
    window.handleClick(...middle(layout.historyNext));
    expect(asked.at(-1)).toBe(501);
    window.toggle();
    expect(opened).toEqual([true, false]);
  });

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

  it('creeps down after the pause and stops for good once the player scrolls', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => ({
      kind: 'text' as const,
      style: 'body' as const,
      text: `P${i}`,
    }));
    let ms = 0;
    const { window, placedY, layout } = mount({ title: '', blocks, goals: [] }, () => ms);
    /** The window only creeps by the time a frame reports, so the test hands it frames. */
    const frames = (forMs: number): void => {
      for (let done = 0; done < forMs; done += MAX_CREEP_STEP_MS) {
        ms += MAX_CREEP_STEP_MS;
        window.refresh();
      }
    };
    window.toggle();
    const top = layout.viewport.y;
    frames(AUTO_SCROLL_DELAY_MS);
    expect(placedY.get('P0')).toBe(top);
    frames(2000);
    expect(placedY.get('P0')).toBeCloseTo(top - 2 * AUTO_SCROLL_PX_PER_S * layout.scale, 5);
    // A sideways swipe reaches the window as a wheel with no vertical delta, which is not a scroll.
    window.handleWheel(...middle(layout.window), 0);
    frames(1000);
    expect(placedY.get('P0')).toBeCloseTo(top - 3 * AUTO_SCROLL_PX_PER_S * layout.scale, 5);
    window.handleWheel(...middle(layout.window), 1);
    const taken = placedY.get('P0');
    frames(4000);
    expect(placedY.get('P0')).toBe(taken);
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

  it('opens on the replayable page from the strip, and on the page a script names, holding the pause once', () => {
    const { window, made, opened, asked } = mount(BRIEF, () => 0, 500);
    window.toggle();
    expect(asked).toEqual([500]);
    expect(made).toContain('PAGE 500');
    made.length = 0;
    window.showPage(501);
    expect(made).toContain('PAGE 501');
    expect(opened).toEqual([true]);
    window.close();
    made.length = 0;
    window.showPage(502);
    expect(opened).toEqual([true, false, true]);
    expect(made).toContain('PAGE 502');
  });

  it('reopens from the strip on the replayable page, not the last one shown', () => {
    const { window, made } = mount(BRIEF, () => 0, 500);
    window.showPage(501);
    window.close();
    made.length = 0;
    window.toggle();
    expect(made).toContain('PAGE 500');
    expect(made).not.toContain('PAGE 501');
  });

  it('walks the shown pages with the prev and next buttons once there are two', () => {
    const { window, made, layout } = mount();
    window.showPage(500);
    // One page: the pair is not drawn, so a press there is consumed but changes nothing.
    made.length = 0;
    expect(window.handleClick(...middle(layout.historyPrev))).toBe(true);
    expect(made).toEqual([]);
    window.showPage(501);
    window.showPage(502);
    made.length = 0;
    window.handleClick(...middle(layout.historyPrev));
    expect(made).toContain('PAGE 501');
    made.length = 0;
    window.handleClick(...middle(layout.historyPrev));
    expect(made).toContain('PAGE 500');
    made.length = 0;
    window.handleClick(...middle(layout.historyPrev)); // the oldest page: nothing before it
    expect(made).toEqual([]);
    window.handleClick(...middle(layout.historyNext));
    expect(made).toContain('PAGE 501');
    // A page shown again keeps its place in the walk rather than moving to the end.
    window.showPage(500);
    made.length = 0;
    window.handleClick(...middle(layout.historyNext));
    expect(made).toContain('PAGE 501');
    expect(window.state()).toEqual({ page: 501, pages: [500, 501, 502] });
  });

  it('reopens on the restored page and walks the restored pages after a remount', () => {
    const { window, asked, layout } = mount();
    window.restore({ page: 501, pages: [500, 501, 502] });
    window.toggle();
    expect(asked.at(-1)).toBe(501);
    window.handleClick(...middle(layout.historyNext));
    expect(asked.at(-1)).toBe(502);
    window.handleClick(...middle(layout.historyPrev));
    window.handleClick(...middle(layout.historyPrev));
    expect(asked.at(-1)).toBe(500);
    expect(window.state()).toEqual({ page: 500, pages: [500, 501, 502] });
  });

  it('rebuilds the goal list when a mark changes and leaves the task tab alone', () => {
    let brief: MissionBrief = BRIEF;
    const { ctx, made } = stubContext();
    const window = createMissionWindow({
      ctx,
      container: new Container(),
      art: null,
      brief: () => brief,
      history: BOOK,
    });
    const layout = layoutMissionWindow(SCREEN, null);
    window.toggle();
    const goalsTab = layout.tabs.find((t) => t.tab === 'goals');
    if (goalsTab === undefined) throw new Error('no goals tab');
    window.handleClick(...middle(goalsTab.rect));
    made.length = 0;
    window.refresh();
    expect(made).toEqual([]);
    brief = { ...BRIEF, goals: [{ text: 'Win', rule: 'skirmish', state: 'done' }] };
    window.refresh();
    expect(made).toContain('X');
  });
});
