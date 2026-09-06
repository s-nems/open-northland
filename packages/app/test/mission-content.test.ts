import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import {
  createContentSink,
  fillGoals,
  fillHistory,
  fillTask,
} from '../src/hud/tool-panel/mission/content.js';
import { GOAL_LIST } from '../src/hud/tool-panel/mission/model.js';

/** The mission tabs' content layout: runs stack top-down at the window scale, the goal list keeps the
 *  original's bullet and text columns, and a history link rides its paragraph. */

const SCALE = 2;
/** Every stub paragraph is this tall (design px), so the stacking is arithmetic. */
const LINE_H = 10;

interface Made {
  readonly text: string;
  readonly px: number;
  readonly align: string;
  readonly color: string;
}

function stubContext(): { ctx: PanelContext; made: Made[] } {
  const made: Made[] = [];
  const run = () => ({
    container: new Container(),
    width: 50,
    place: () => undefined,
    destroy: () => undefined,
  });
  const ctx: PanelContext = {
    layout: buildToolPanelLayout(SCALE),
    scale: SCALE,
    makeText: () => run(),
    makeParagraph: (text, color, px, _wrap, align = 'left') => {
      made.push({ text, px, align, color });
      return { ...run(), height: LINE_H };
    },
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => ({ width: 800, height: 600 }),
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return { ctx, made };
}

describe('fillTask', () => {
  it('centres the headline and stacks the paragraphs with their gaps, at the window scale', () => {
    const { ctx, made } = stubContext();
    const sink = createContentSink(ctx, new Container());
    fillTask(
      sink,
      {
        title: 'SANDSTORM',
        paragraphs: [
          { style: 'body', text: 'First' },
          { style: 'body', text: 'Second', align: 'center' },
        ],
        goals: [],
      },
      482,
      'No briefing',
    );
    expect(made.map((m) => m.text)).toEqual(['SANDSTORM', 'First', 'Second']);
    expect(sink.placed.map((p) => p.centred)).toEqual([true, false, true]);
    expect(sink.placed.map((p) => p.y)).toEqual([
      0,
      (LINE_H + 10) * SCALE,
      (LINE_H + 10 + LINE_H + 6) * SCALE,
    ]);
    expect(sink.height()).toBe((3 * LINE_H + 10 + 6 + 6) * SCALE);
  });

  it('says so without a brief or without briefing text', () => {
    const { ctx, made } = stubContext();
    const sink = createContentSink(ctx, new Container());
    fillTask(sink, null, 482, 'No briefing');
    fillTask(sink, { title: 'Nile', paragraphs: [], goals: [] }, 482, 'No briefing');
    expect(made.map((m) => m.text)).toEqual(['No briefing', 'Nile', 'No briefing']);
  });
});

describe('fillGoals', () => {
  it('prints the heading, then an o or X bullet beside each goal in the original columns', () => {
    const { ctx, made } = stubContext();
    const sink = createContentSink(ctx, new Container());
    fillGoals(
      sink,
      {
        title: '',
        paragraphs: [],
        goals: [
          { text: 'Build a temple', rule: 'authored', done: false },
          { text: 'Defeat everyone', rule: 'skirmish', done: true },
        ],
      },
      'Objectives',
    );
    expect(made.map((m) => m.text)).toEqual(['Objectives', 'o', 'Build a temple', 'X', 'Defeat everyone']);
    const [heading, bullet, goal, bullet2, goal2] = sink.placed;
    expect(heading?.x).toBe(GOAL_LIST.headingX * SCALE);
    expect(bullet?.x).toBe(GOAL_LIST.bulletX * SCALE);
    expect(goal?.x).toBe(GOAL_LIST.textX * SCALE);
    // The bullet sits on the goal's line and takes no room of its own.
    expect(bullet?.y).toBe(GOAL_LIST.listY * SCALE);
    expect(goal?.y).toBe(GOAL_LIST.listY * SCALE);
    expect(bullet2?.y).toBe(goal2?.y);
    expect(goal2?.y).toBe((GOAL_LIST.listY + LINE_H + GOAL_LIST.gap) * SCALE);
  });
});

describe('fillHistory', () => {
  it('colours the linked paragraphs red and keeps their targets for the click', () => {
    const { ctx, made } = stubContext();
    const sink = createContentSink(ctx, new Container());
    fillHistory(
      sink,
      [
        { style: 'title', text: 'HISTORY', align: 'center' },
        { style: 'body', text: 'Seven wonders', align: 'center', link: 'mythology_00' },
      ],
      482,
      'No history',
    );
    expect(made.map((m) => m.color)).toEqual(['dark', 'red']);
    expect(sink.placed.map((p) => p.link)).toEqual([null, 'mythology_00']);
  });

  it('says so for an absent page', () => {
    const { ctx, made } = stubContext();
    const sink = createContentSink(ctx, new Container());
    fillHistory(sink, undefined, 482, 'No history');
    expect(made.map((m) => m.text)).toEqual(['No history']);
  });
});
