import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { ParagraphFace } from '../src/hud/text-run.js';
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
import { userIconBox } from '../src/hud/tool-panel/mission/user-icons.js';

/** The mission tabs' content layout: a page stacks in the engine's line pitch at the window scale, its
 *  pictures centred and its icons in framed boxes, the goal list keeps the original's bullet and text
 *  columns, and a history link rides its paragraph. */

const SCALE = 2;
/** Every stub paragraph is this tall (design px), so the stacking is arithmetic. */
const LINE_H = 10;
/** The window's text viewport in design px, which the goal columns wrap inside. */
const VIEWPORT_W = 482;
/** The briefing page's column. */
const PAGE_W = 492;

interface Made {
  readonly text: string;
  readonly px: number;
  readonly align: string;
  readonly color: string;
  /** Design px the run wraps at, so a column that overruns the viewport fails here. */
  readonly wrap: number;
  readonly face: ParagraphFace | undefined;
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
    makeParagraph: (text, color, px, wrap, align = 'left', face) => {
      made.push({ text, px, align, color, wrap, face });
      return { ...run(), height: LINE_H };
    },
    bitmaps: { bg: undefined, button: undefined, buttonHilite: undefined, headline: undefined },
    uiString: (_table, _id, fallback) => fallback,
    screen: () => ({ width: 800, height: 600 }),
    cue: () => undefined,
    atScale: (scale) => ({ ...ctx, scale }),
  };
  return { ctx, made };
}

/** No page picture ever resolves here, so a picture block is laid out from its declared size alone. */
const sinkOf = (ctx: PanelContext, container = new Container(), briefing = false): ContentSink =>
  createContentSink(
    ctx,
    container,
    createPictureCache(() => Promise.resolve(undefined)),
    // Mission id 7 names entity 70; no other id names a human.
    briefing ? (icon) => userIconBox(icon, (id) => (id === 7 ? 70 : null)) : undefined,
  );

describe('fillTask', () => {
  it('lays a page out in the engine rhythm: blank rows, text lines, a padded picture, an icon box', () => {
    const { ctx, made } = stubContext();
    const sink = sinkOf(ctx, new Container(), true);
    fillTask(
      sink,
      {
        title: '',
        blocks: [
          { kind: 'blank', lines: 1 },
          { kind: 'text', style: 'title', text: 'SANDSTORM', align: 'center' },
          { kind: 'blank', lines: 2 },
          { kind: 'text', style: 'body', text: 'First', align: 'right' },
          { kind: 'picture', file: 'abc.png', width: 100, height: 50 },
          { kind: 'icons', icons: [[1, 5, 6, 0]], align: 'center' },
        ],
        goals: [],
      },
      PAGE_W,
      'No briefing',
    );
    expect(made.map((m) => [m.text, m.px, m.face])).toEqual([
      ['SANDSTORM', 18, { bold: true, lineHeight: 21 }],
      ['First', 15, { letterSpacing: 0.5, lineHeight: 18 }],
    ]);
    expect(sink.placed.map((p) => [p.placement, p.y / SCALE])).toEqual([
      ['center', 20],
      ['right', 20 + LINE_H + 40],
      // A picture sits 2 px down its row.
      ['center', 20 + LINE_H + 40 + LINE_H + 2],
      // The map view's frame, left at the engine's centring shift: half the column past it and a word space.
      ['left', 20 + LINE_H + 40 + LINE_H + 2 + 50],
    ]);
    expect(sink.placed[3]?.x).toBe(Math.floor((PAGE_W - 280 - 5) / 2) * SCALE);
    expect(sink.views).toEqual([
      {
        x: Math.floor((PAGE_W - 280 - 5) / 2) * SCALE,
        y: (20 + LINE_H + 40 + LINE_H + 2 + 50) * SCALE,
        w: 280 * SCALE,
        h: 220 * SCALE,
        icon: {
          w: 280,
          h: 220,
          target: { kind: 'node', hx: 5, hy: 6 },
          focusX: 140,
          focusY: 110,
        },
      },
    ]);
    expect(sink.height()).toBe((20 + LINE_H + 40 + LINE_H + 2 + 50 + 220) * SCALE);
  });

  it('wraps icons like words, bottom-aligned per line, and leaves an undrawn icon an empty line', () => {
    const { ctx } = stubContext();
    const sink = sinkOf(ctx, new Container(), true);
    const figure = [0, 7, 0, 0] as const;
    fillTask(
      sink,
      {
        title: '',
        blocks: [
          { kind: 'icons', icons: [[2, 8, 0, 0]] },
          { kind: 'icons', icons: [[1, 0, 0, 0], [...figure], [...figure], [...figure]] },
        ],
        goals: [],
      },
      PAGE_W,
      'No briefing',
    );
    // Id 8 names nobody: the first row draws nothing and is one empty line.
    expect(sink.views.map((v) => [v.x / SCALE, v.y / SCALE, v.w / SCALE, v.h / SCALE])).toEqual([
      [0, 20, 280, 220],
      [285, 20 + 220 - 80, 50, 80],
      [340, 20 + 220 - 80, 50, 80],
      [395, 20 + 220 - 80, 50, 80],
    ]);
    expect(sink.views[1]?.icon).toMatchObject({ target: { kind: 'entity', ref: 70 }, soloFill: 0xc4c09f });
  });

  it('keeps a human card whose id nobody carries, as an empty card', () => {
    const { ctx } = stubContext();
    const sink = sinkOf(ctx, new Container(), true);
    fillTask(sink, { title: '', blocks: [{ kind: 'icons', icons: [[0, 8, 0, 0]] }], goals: [] }, PAGE_W, '');
    expect(sink.views.map((v) => v.icon)).toEqual([
      { w: 50, h: 80, target: null, focusX: 25, focusY: 60, soloFill: 0xc4c09f },
    ]);
    expect(sink.height()).toBe(80 * SCALE);
  });

  it('heads fallback text with the brief title and its gap, at the window scale', () => {
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
    expect(sink.placed.map((p) => p.placement)).toEqual(['center', 'left', 'center']);
    expect(sink.placed.map((p) => p.y)).toEqual([0, (LINE_H + 10) * SCALE, (2 * LINE_H + 10) * SCALE]);
    expect(sink.height()).toBe((3 * LINE_H + 10) * SCALE);
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
          { text: 'Build a temple', rule: 'authored', state: 'open' },
          { text: 'Defeat everyone', rule: 'skirmish', state: 'done' },
        ],
      },
      'Objectives',
      VIEWPORT_W,
    );
    expect(made.map((m) => m.text)).toEqual(['Objectives', 'o', 'Build a temple', 'X', 'Defeat everyone']);
    const [heading, bullet, goal, bullet2, goal2] = sink.placed;
    expect(heading?.x).toBe(GOAL_LIST.headingX * SCALE);
    expect(bullet?.x).toBe(GOAL_LIST.bulletX * SCALE);
    expect(goal?.x).toBe(GOAL_LIST.textX * SCALE);
    // The heading and the goal text end at the viewport's right edge; a wider wrap would draw under
    // the content mask.
    const [headingWrap, , goalWrap, , goal2Wrap] = made.map((m) => m.wrap);
    expect([headingWrap, goalWrap, goal2Wrap]).toEqual([
      VIEWPORT_W - GOAL_LIST.headingX,
      VIEWPORT_W - GOAL_LIST.textX,
      VIEWPORT_W - GOAL_LIST.textX,
    ]);
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
    fillHistory(sink, [{ kind: 'picture', file: 'abc.png', width: 964, height: 482 }], 482, 'No history');
    const picture = sink.placed[0];
    expect(made).toEqual([]);
    expect(picture?.width).toBe(482 * SCALE);
    expect(picture?.h).toBe(241 * SCALE);
    expect(picture?.placement).toBe('center');
    expect(picture?.link).toBeNull();
  });

  it('draws no user icon in the book: each row is an empty line', () => {
    const { ctx } = stubContext();
    const sink = sinkOf(ctx);
    fillHistory(sink, [{ kind: 'icons', icons: [[1, 5, 6, 0]] }], 482, 'No history');
    expect(sink.views).toEqual([]);
    expect(sink.height()).toBe(20 * SCALE);
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
