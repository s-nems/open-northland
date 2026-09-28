import type {
  HypertextBlock,
  HypertextParagraph,
  HypertextPicture,
  HypertextUserIcon,
} from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { MissionGoal } from '../src/game/mission-brief.js';
import { GoalMarks, goalLists, openGoalCount, slipRows } from '../src/hud/dom/mission-book/goal-marks.js';
import { flowMarkup, roman } from '../src/hud/dom/mission-book/markup.js';
import { displayTitle, openingWords, pageSegments } from '../src/hud/dom/mission-book/page-segments.js';
import { columnCount, spreadCount, turnPage } from '../src/hud/dom/mission-book/paging.js';
import type { UserIconBox } from '../src/hud/dom/mission-book/user-icons.js';

/** The mission book's pure parts: how a page is read into segments, how its text is paged, and which
 *  goal changes it and the goal slip mark. */

const PORTRAIT: HypertextPicture = { kind: 'picture', file: 'aa.png', width: 164, height: 136 };
const VIEW_ICON: HypertextUserIcon = [1, 40, 60, 0];
const VIEW: HypertextBlock = { kind: 'icons', icons: [VIEW_ICON] };

function goal(key: string, state: MissionGoal['state'], text = `Goal ${key}`): MissionGoal {
  return { key, text, emphasis: false, rule: 'authored', state };
}

describe('pageSegments', () => {
  it('takes the first title as the page title and reads the rest as the author set it', () => {
    const blocks: HypertextBlock[] = [
      { kind: 'blank', lines: 1 },
      { kind: 'text', style: 'title', text: ' AL-MUKALLAH ', align: 'center' },
      { kind: 'text', style: 'body', text: 'Przed nami miasto.' },
      VIEW,
      { kind: 'icons', icons: [[2, 7, 0, 0]] },
      { kind: 'text', style: 'title', text: 'Targ' },
      { kind: 'text', style: 'body', text: 'Ares: Idziemy dalej.' },
      PORTRAIT,
      { kind: 'text', style: 'body', text: '„Witajcie w mieście!”' },
      { kind: 'text', style: 'body', text: 'SIEDEM CUDÓW', align: 'center', link: 'mythology_00' },
      { kind: 'text', style: 'body', text: '~ by Autor ~' },
    ];
    const page = pageSegments(blocks);
    expect(page.title).toBe('AL-MUKALLAH');
    expect(page.segments).toEqual([
      { kind: 'para', text: 'Przed nami miasto.', align: 'left', tone: null, link: null },
      { kind: 'icons', icons: [VIEW_ICON, [2, 7, 0, 0]] },
      { kind: 'heading', text: 'Targ', space: 'tight' },
      { kind: 'speech', speaker: 'Ares', text: 'Idziemy dalej.', portrait: null, space: 'tight' },
      { kind: 'speech', speaker: null, text: 'Witajcie w mieście!', portrait: PORTRAIT },
      {
        kind: 'para',
        text: 'SIEDEM CUDÓW',
        align: 'center',
        tone: null,
        link: 'mythology_00',
        space: 'tight',
      },
      { kind: 'signature', text: 'by Autor', space: 'tight' },
    ]);
  });

  it("keeps the author's empty lines, ink and justified lines", () => {
    const text = (t: string, more: Partial<HypertextParagraph> = {}): HypertextBlock => ({
      kind: 'text',
      style: 'body',
      text: t,
      ...more,
    });
    const page = pageSegments([
      text('Jeden.'),
      text('Zaraz pod nim.'),
      { kind: 'blank', lines: 1 },
      text('Nowy akapit.', { align: 'justify' }),
      { kind: 'blank', lines: 3 },
      text('Nowa część.', { color: 'red' }),
      { kind: 'blank', lines: 1 },
      text('Przygaszone.', { color: 'dimmed' }),
      text('Białe.', { color: 'white' }),
    ]);
    expect(
      page.segments.map((s) => (s.kind === 'para' ? [s.text, s.align, s.tone, s.space ?? null] : s.kind)),
    ).toEqual([
      ['Jeden.', 'left', null, null],
      ['Zaraz pod nim.', 'left', null, 'tight'],
      ['Nowy akapit.', 'justify', null, null],
      ['Nowa część.', 'left', 'red', 'wide'],
      ['Przygaszone.', 'left', 'dimmed', null],
      ['Białe.', 'left', null, 'tight'],
    ]);
  });

  it('gives an untitled page no title and keeps a picture without a quote after it', () => {
    const page = pageSegments([PORTRAIT, { kind: 'text', style: 'body', text: 'Bez cudzysłowu.' }]);
    expect(page.title).toBeNull();
    expect(page.segments.map((s) => s.kind)).toEqual(['picture', 'para']);
  });

  it('sets a mostly centred page flush left and keeps a few centred lines and links centred', () => {
    const para = (text: string, align?: 'center'): HypertextBlock =>
      align === undefined
        ? { kind: 'text', style: 'body', text }
        : { kind: 'text', style: 'body', text, align };
    const alignments = (blocks: HypertextBlock[]) =>
      pageSegments(blocks).segments.flatMap((s) => (s.kind === 'para' ? [s.align] : []));
    expect(alignments([para('Jeden.', 'center'), para('Dwa.', 'center'), para('Trzy.')])).toEqual([
      'left',
      'left',
      'left',
    ]);
    expect(alignments([para('Jeden.'), para('Dwa.'), para('Podpis ryciny', 'center')])).toEqual([
      'left',
      'left',
      'center',
    ]);
    const link: HypertextBlock = {
      kind: 'text',
      style: 'body',
      text: 'Kolos',
      align: 'center',
      link: 'm_03',
    };
    expect(alignments([para('Wstęp.', 'center'), link])).toEqual(['left', 'center']);
  });

  it('names an untitled page in the contents by its opening words', () => {
    const page = pageSegments([
      { kind: 'text', style: 'body', text: 'Wreszcie dotarliśmy do brzegu, wodzu. Dalej!' },
    ]);
    expect(openingWords(page)).toBe('Wreszcie dotarliśmy do brzegu, wodzu…');
    expect(openingWords(pageSegments([VIEW]))).toBeNull();
  });
});

describe('displayTitle', () => {
  it('sets a title written in capitals in title case and leaves any other alone', () => {
    expect(displayTitle('BOSO PRZEZ ŚWIAT', 'pl')).toBe('Boso Przez Świat');
    expect(displayTitle('Powrót Gato', 'pl')).toBe('Powrót Gato');
  });
});

describe('paging', () => {
  it('counts page columns and the spreads that show two of them', () => {
    expect(columnCount(348, 348, 60)).toBe(1);
    expect(columnCount(348 * 3 + 60 * 2, 348, 60)).toBe(3);
    expect(spreadCount(1)).toBe(1);
    expect(spreadCount(3)).toBe(2);
    expect(spreadCount(4)).toBe(2);
  });

  it('turns through the spreads, across chapters, and stops at the book`s ends', () => {
    expect(turnPage({ chapter: 0, spread: 0 }, 1, 2, 3)).toEqual({ chapter: 0, spread: 1 });
    expect(turnPage({ chapter: 0, spread: 1 }, 1, 2, 3)).toEqual({ chapter: 1, spread: 0 });
    expect(turnPage({ chapter: 1, spread: 0 }, -1, 2, 3)).toEqual({ chapter: 0, spread: 'last' });
    expect(turnPage({ chapter: 0, spread: 0 }, -1, 2, 3)).toBeNull();
    expect(turnPage({ chapter: 2, spread: 1 }, 1, 2, 3)).toBeNull();
  });

  it('numbers chapters in Roman numerals', () => {
    expect([1, 3, 4, 9, 14, 40].map(roman)).toEqual(['I', 'III', 'IV', 'IX', 'XIV', 'XL']);
  });
});

describe('GoalMarks', () => {
  it('marks nothing in the list a world starts with, then a goal that opens or is done', () => {
    const marks = new GoalMarks();
    expect(marks.observe([goal('0', 'open'), goal('1', 'idle')])).toBe(false);
    expect(marks.unread).toBe(false);
    expect(marks.observe([goal('0', 'done'), goal('1', 'open'), goal('2', 'open')])).toBe(true);
    expect([marks.markOf('0'), marks.markOf('1'), marks.markOf('2')]).toEqual(['done', 'new', 'new']);
  });

  it('drops the mark of a goal hidden again and costs nothing for the same list twice', () => {
    const marks = new GoalMarks();
    marks.observe([goal('0', 'idle')]);
    const opened = [goal('0', 'open')];
    marks.observe(opened);
    const version = marks.version;
    expect(marks.observe(opened)).toBe(false);
    expect(marks.observe([])).toBe(true);
    expect(marks.markOf('0')).toBeNull();
    expect(marks.version).toBeGreaterThan(version);
  });

  it('counts every change as read once the book opens', () => {
    const marks = new GoalMarks();
    marks.observe([goal('0', 'open')]);
    marks.observe([goal('0', 'done')]);
    expect(marks.snapshot().get('0')).toBe('done');
    expect(marks.read()).toBe(true);
    expect(marks.unread).toBe(false);
    expect(marks.read()).toBe(false);
  });
});

describe('goal lists', () => {
  const goals = [goal('0', 'done'), goal('1', 'idle'), goal('2', 'open'), goal('3', 'open')];

  it('lists what is to do, open before not yet active, and what is done, without a total', () => {
    const { current, done } = goalLists(goals);
    expect(current.map((g) => g.key)).toEqual(['2', '3', '1']);
    expect(done.map((g) => g.key)).toEqual(['0']);
    expect(openGoalCount(goals)).toBe(2);
  });

  it('slips the goals just done, then the new open ones first, up to its rows', () => {
    const marks = new GoalMarks();
    marks.observe([goal('0', 'open'), goal('2', 'open'), goal('3', 'idle')]);
    marks.observe([goal('0', 'done'), goal('2', 'open'), goal('3', 'open')]);
    const { rows, more } = slipRows([goal('0', 'done'), goal('2', 'open'), goal('3', 'open')], marks, 1);
    expect(rows.map((r) => `${r.goal.key}:${r.mark}`)).toEqual(['0:done', '3:new']);
    expect(more).toBe(1);
  });
});

describe('flowMarkup', () => {
  const CARD_FILL = 0xc4c09f;
  const card = (target: UserIconBox['target']): string =>
    flowMarkup(pageSegments([VIEW]), {
      pictureUrl: (file) => file,
      iconBox: () => ({ w: 40, h: 60, target, focusX: 20, focusY: 50, soloFill: CARD_FILL }),
      showOnMap: 'Show on map',
      views: [],
    });

  it('leaves a figure card clear over its hole, where the renderer paints the fill, and fills a card without one', () => {
    expect(card({ kind: 'entity', ref: 7 })).not.toContain('background:');
    expect(card(null)).toContain('background:#c4c09f');
  });
});
