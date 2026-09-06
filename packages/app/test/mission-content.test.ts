import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { PanelContext } from '../src/hud/tool-panel/context.js';
import { buildToolPanelLayout } from '../src/hud/tool-panel/layout.js';
import {
  type ContentSink,
  createContentSink,
  fillGoals,
  fillHistory,
  fillTask,
} from '../src/hud/tool-panel/mission/content.js';
import { GOAL_LIST } from '../src/hud/tool-panel/mission/model.js';
import { createPictureCache } from '../src/hud/tool-panel/mission/pictures.js';

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

/** No page picture ever resolves here, so a picture block is laid out from its declared size alone. */
const sinkOf = (ctx: PanelContext, container = new Container()): ContentSink =>
  createContentSink(
    ctx,
    container,
    createPictureCache(() => Promise.resolve(undefined)),
  );

describe('fillTask', () => {
  it('centres the headline and stacks the page blocks with their gaps, at the window scale', () => {
    const { ctx, made } = stubContext();
    const sink = sinkOf(ctx);
    fillTask(
      sink,
      {
        title: 'SANDSTORM',
        blocks: [
          { kind: 'text', style: 'body', text: 'First' },
          { kind: 'text', style: 'body', text: 'Second', align: 'center' },
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
    const sink = sinkOf(ctx);
    fillTask(sink, null, 482, 'No briefing');
    fillTask(sink, { title: 'Nile', blocks: [], goals: [] }, 482, 'No briefing');
    expect(made.map((m) => m.text)).toEqual(['No briefing', 'Nile', 'No briefing']);
  });
});

describe('fillGoals', () => {
  it('prints the heading, then an o or X bullet beside each goal in the original columns', () => {
    const { ctx, made } = stubContext();
    const sink = sinkOf(ctx);
    fillGoals(
      sink,
      {
        title: '',
        blocks: [],
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
  it('draws the page in its own colours and keeps a link target for the click', () => {
    const { ctx, made } = stubContext();
    const sink = sinkOf(ctx);
    fillHistory(
      sink,
      [
        { kind: 'text', style: 'title', text: 'HISTORY', align: 'center' },
        {
          kind: 'text',
          style: 'body',
          text: 'Seven wonders',
          align: 'center',
          color: 'red',
          link: 'mythology_00',
        },
      ],
      482,
      'No history',
    );
    expect(made.map((m) => m.color)).toEqual(['dark', 'red']);
    expect(sink.placed.map((p) => p.link)).toEqual([null, 'mythology_00']);
  });

  it('fits a picture to the text column, centres it and leaves it unlinked', () => {
    const { ctx, made } = stubContext();
    const sink = sinkOf(ctx);
    fillHistory(
      sink,
      [{ kind: 'picture', file: 'abc.png', width: 964, height: 482, align: 'center' }],
      482,
      'No history',
    );
    const picture = sink.placed[0];
    expect(made).toEqual([]);
    expect(picture?.width).toBe(482 * SCALE);
    expect(picture?.h).toBe(241 * SCALE);
    expect(picture?.centred).toBe(true);
    expect(picture?.link).toBeNull();
  });

  it('shows a picture when its texture arrives and drops one that arrives after the page is gone', async () => {
    const { ctx } = stubContext();
    const container = new Container();
    let arrive: (texture: Texture) => void = () => undefined;
    const pending = new Promise<Texture | undefined>((resolve) => {
      arrive = resolve;
    });
    const cache = createPictureCache(() => pending);
    const sink = createContentSink(ctx, container, cache);
    fillHistory(sink, [{ kind: 'picture', file: 'abc.png', width: 100, height: 50 }], 482, 'No history');
    const sprite = container.children[0];
    expect(sprite).toBeInstanceOf(Sprite);
    if (!(sprite instanceof Sprite)) return;
    expect(sprite.texture).toBe(Texture.EMPTY);
    arrive(Texture.WHITE);
    await cache.load('abc.png');
    expect(sprite.texture).toBe(Texture.WHITE);
    expect(sprite.width).toBe(100 * SCALE);

    const goneContainer = new Container();
    const gone = createContentSink(
      ctx,
      goneContainer,
      createPictureCache(() => pending),
    );
    fillHistory(gone, [{ kind: 'picture', file: 'abc.png', width: 100, height: 50 }], 482, 'No history');
    const goneSprite = goneContainer.children[0];
    for (const p of gone.placed) p.destroy();
    await pending;
    expect(goneSprite instanceof Sprite && goneSprite.texture).not.toBe(Texture.WHITE);
  });

  it('says so for an absent page', () => {
    const { ctx, made } = stubContext();
    const sink = sinkOf(ctx);
    fillHistory(sink, undefined, 482, 'No history');
    expect(made.map((m) => m.text)).toEqual(['No history']);
  });
});
