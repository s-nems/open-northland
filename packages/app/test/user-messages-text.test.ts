import { describe, expect, it } from 'vitest';
import type { UiString } from '../src/content/gui-gfx.js';
import {
  composeMessageText,
  MESSAGE_STRING_ID,
  type MessageTextDeps,
  userMessageTypeName,
} from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE, type UserMessageTypeName } from '../src/hud/tool-panel/messages/types.js';

/** Synthetic stand-ins for the `messages` rows the composer reads; the shapes matter, not the words. */
const ROWS: Readonly<Record<number, string>> = {
  10: 'row10',
  61: '- row61',
  27: 'row27 %s tail',
  28: 'row28',
  33: 'może teraz wykonywać następujące prace',
  34: 'Nowe zawody',
  35: 'Nowe towary',
  36: 'Nowe budynki',
  38: 'może produkować nowy towar',
  39: 'może podjąć nowy zawód',
  40: 'plemię może wybudować nowy budynek',
  50: 'row50',
  58: 'row58',
  60: 'row60',
  90: '- row90',
  120: 'row120',
  121: 'row121-unknown',
};

const decoded: UiString = (table, id, fallback) => (table === 'messages' ? (ROWS[id] ?? fallback) : fallback);
const deps: MessageTextDeps = { uiString: decoded, fallbackRow: (id) => `<${id}>` };

const compose = (
  type: (typeof USER_MESSAGE_TYPE)[UserMessageTypeName],
  subjectName: string | null,
  jobLabel: string | null = null,
  goodName: string | null = null,
  stanceName: string | null = null,
  technologySections?: { jobs: readonly string[]; goods: readonly string[]; houses: readonly string[] },
) =>
  composeMessageText(
    type,
    {
      subjectName,
      jobLabel,
      goodName,
      stanceName,
      ...(technologySections !== undefined ? { technologySections } : {}),
    },
    deps,
  ).full;

describe('user message text', () => {
  it('maps every type to a messages row', () => {
    for (const name of Object.keys(USER_MESSAGE_TYPE) as UserMessageTypeName[]) {
      expect(MESSAGE_STRING_ID[name]).toBeGreaterThan(0);
      expect(userMessageTypeName(USER_MESSAGE_TYPE[name])).toBe(name);
    }
  });

  it('leads with the settler and its trade in parentheses', () => {
    expect(compose(USER_MESSAGE_TYPE.hungry, 'Bjorn Olafson', 'Budowniczy')).toBe(
      'Bjorn Olafson (Budowniczy) row10',
    );
    expect(compose(USER_MESSAGE_TYPE.wasBorn, 'Astrid')).toBe('Astrid row50');
  });

  it('names the building before its dashed row', () => {
    expect(compose(USER_MESSAGE_TYPE.houseFinished, 'Dom')).toBe('Dom - row90');
    expect(compose(USER_MESSAGE_TYPE.houseFinished, null)).toBe('- row90');
  });

  it('reports an unnamed death through the unknown-hero row', () => {
    expect(compose(USER_MESSAGE_TYPE.humanDied, 'Leif')).toBe('Leif row120');
    expect(compose(USER_MESSAGE_TYPE.humanDied, null)).toBe('row121-unknown');
  });

  it('substitutes the good into the stock-full row and appends the detail rows', () => {
    expect(compose(USER_MESSAGE_TYPE.stockFull, 'Leif', null, 'Drewno')).toBe('Leif row27 Drewno tail');
    expect(compose(USER_MESSAGE_TYPE.stockFull, 'Leif')).toBe('Leif row28');
    expect(compose(USER_MESSAGE_TYPE.backpackFull, 'Leif')).toBe('Leif row58 row60');
  });

  it('appends the stance to the rows about another seat, which end on a lead-in', () => {
    expect(compose(USER_MESSAGE_TYPE.playerSighted, 'Gracz 2', null, null, 'wrogi')).toBe(
      'Gracz 2 <131> wrogi',
    );
    const sighted = composeMessageText(
      USER_MESSAGE_TYPE.playerSighted,
      { subjectName: 'Gracz 2', jobLabel: null, goodName: null, stanceName: 'wrogi' },
      { ...deps, fallbackRow: (id) => `- <${id}>` },
    );
    expect([sighted.subject, sighted.body, sighted.full]).toEqual([
      'Gracz 2',
      '<131> wrogi',
      'Gracz 2 - <131> wrogi',
    ]);
    expect(compose(USER_MESSAGE_TYPE.diplomacyChanged, 'Gracz 2', null, null, 'przyjazny')).toBe(
      'Gracz 2 <132> przyjazny',
    );
  });

  it('groups professions and goods, while a building-only record remains its own list', () => {
    expect(
      compose(USER_MESSAGE_TYPE.experienceUnlocks, 'Bjorn', 'Rolnik', null, null, {
        jobs: ['Młynarz'],
        goods: ['Mąka', 'Chleb'],
        houses: [],
      }),
    ).toBe(
      'Bjorn (Rolnik) może teraz wykonywać następujące prace:\nNowe zawody:\n- Młynarz\n\nNowe towary:\n- Mąka\n- Chleb',
    );
    expect(
      compose(USER_MESSAGE_TYPE.experienceUnlocks, 'Bjorn', 'Rolnik', null, null, {
        jobs: [],
        goods: [],
        houses: ['Młyn', 'Piekarnia'],
      }),
    ).toBe('Bjorn (Rolnik) może teraz wykonywać następujące prace:\nNowe budynki:\n- Młyn\n- Piekarnia');
  });

  it('falls back to the catalog row when the decoded strings are absent', () => {
    const bare: MessageTextDeps = {
      uiString: (_t, _i, fallback) => fallback,
      fallbackRow: (id) => `<${id}>`,
    };
    expect(
      composeMessageText(
        USER_MESSAGE_TYPE.houseUpgraded,
        { subjectName: 'Dom', jobLabel: null, goodName: null, stanceName: null },
        bare,
      ).full,
    ).toBe('Dom <91>');
  });

  it('splits a card into the subject line and the event line', () => {
    const settler = composeMessageText(
      USER_MESSAGE_TYPE.hungry,
      { subjectName: 'Bjorn', jobLabel: 'Budowniczy', goodName: null, stanceName: null },
      deps,
    );
    expect([settler.subject, settler.body]).toEqual(['Bjorn · Budowniczy', 'row10']);
    const attacked = composeMessageText(
      USER_MESSAGE_TYPE.humanAttacked,
      { subjectName: 'Bjorn', jobLabel: null, goodName: null, stanceName: null },
      deps,
    );
    expect([attacked.body, attacked.full]).toEqual(['row61', 'Bjorn - row61']);
    const house = composeMessageText(
      USER_MESSAGE_TYPE.houseFinished,
      { subjectName: 'Dom', jobLabel: null, goodName: null, stanceName: null },
      deps,
    );
    expect([house.subject, house.body]).toEqual(['Dom', 'row90']);
    const unknown = composeMessageText(
      USER_MESSAGE_TYPE.humanDied,
      { subjectName: null, jobLabel: null, goodName: null, stanceName: null },
      deps,
    );
    expect([unknown.subject, unknown.body]).toEqual([null, 'row121-unknown']);
    const paper = composeMessageText(
      USER_MESSAGE_TYPE.specialItemFound,
      { subjectName: null, jobLabel: null, goodName: null, stanceName: null, detail: 'Pozwolenie' },
      deps,
    );
    expect([paper.subject, paper.body, paper.full]).toEqual(['Pozwolenie', '<134>', '<134> - Pozwolenie']);
    const unlocks = composeMessageText(
      USER_MESSAGE_TYPE.experienceUnlocks,
      {
        subjectName: 'Bjorn',
        jobLabel: null,
        goodName: null,
        stanceName: null,
        technologySections: { jobs: [], goods: [], houses: ['Młyn'] },
      },
      deps,
    );
    expect(unlocks.body).toBe('może teraz wykonywać następujące prace');
    expect(unlocks.full).toBe('Bjorn może teraz wykonywać następujące prace:\nNowe budynki:\n- Młyn');
  });
});
