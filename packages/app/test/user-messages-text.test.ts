import { describe, expect, it } from 'vitest';
import {
  composeMessageText,
  fightSummary,
  type MessageText,
  type MessageTextParts,
  type NoticeCopy,
} from '../src/hud/tool-panel/messages/text.js';
import {
  type IdleReasonKind,
  type ProductionStallReason,
  USER_MESSAGE_TYPE,
  type UserMessageTypeName,
} from '../src/hud/tool-panel/messages/types.js';
import { en } from '../src/i18n/en.js';
import { pl } from '../src/i18n/pl.js';

/** The most characters a card line's own words may take, placeholders left out: a proxy for the stacked
 *  column's one 93 px line at 1080p, where 14 Polish characters measured 92 px and 16 English ones 84. */
const SHORT_LINE_MAX_CHARS = 16;
const PLACEHOLDER = /\{[A-Za-z]+\}/g;

const COPIES: readonly (readonly [string, NoticeCopy])[] = [
  ['pl', pl.userMessages],
  ['en', en.userMessages],
];

const BARE: MessageTextParts = { subjectName: 'Bjorn', jobLabel: null, goodName: null, stanceName: null };

/** Every part a type can name, so no placeholder is left for want of a value. */
function partsFor(name: UserMessageTypeName, female: boolean): MessageTextParts {
  return {
    ...BARE,
    jobLabel: female ? null : 'Rolnik',
    female,
    goodName: 'Chleb',
    stanceName: 'wrogi',
    detail: 'Prolongata',
    technologySections: { jobs: ['Młynarz'], goods: [], houses: [], vehicles: [] },
    training: { course: 'school', profession: 'Młynarz' },
    stall: 'noInputSource',
    ...(name === 'familyBlocked'
      ? { family: { wait: 'livesApart', partner: { name: 'Olaf', jobLabel: 'Zwiadowca', female: false } } }
      : {}),
    fight: { buildings: 1, walls: 0, settlers: 0, vehicles: 0, enemies: ['Gracz 2'], wild: false },
  };
}

function composeIn(copy: NoticeCopy, tag: string, name: UserMessageTypeName, parts: MessageTextParts) {
  return composeMessageText(USER_MESSAGE_TYPE[name], parts, copy, tag);
}

function compose(copy: NoticeCopy, name: UserMessageTypeName, parts: MessageTextParts): MessageText {
  return composeMessageText(USER_MESSAGE_TYPE[name], parts, copy);
}

/** Every card line a catalog holds, per key: one per type, plus the variants and the family waits. */
function shortLines(copy: NoticeCopy): Map<string, Set<string>> {
  const lines = new Map<string, Set<string>>();
  for (const [key, line] of Object.entries(copy.short)) {
    lines.set(key, new Set(typeof line === 'string' ? [line] : [line.he, line.she]));
  }
  for (const [wait, line] of Object.entries(copy.familyBlocked.short))
    lines.set(`family:${wait}`, new Set([line]));
  for (const [reason, line] of Object.entries(copy.productionStalled.short))
    lines.set(`stall:${reason}`, new Set([line]));
  return lines;
}

describe('notice text', () => {
  it.each(COPIES)(
    'words every type in %s from the catalog alone, every placeholder filled',
    (_lang, copy) => {
      for (const name of Object.keys(USER_MESSAGE_TYPE) as UserMessageTypeName[]) {
        for (const female of [false, true]) {
          const text = compose(copy, name, partsFor(name, female));
          for (const line of [text.short, text.full]) {
            expect(line, name).not.toMatch(PLACEHOLDER);
            expect(line, name).not.toMatch(/[—–]| {2}/);
            expect(line.trim(), name).not.toBe('');
          }
          // An idle reason and the experience lists follow the full text as sentences of their own.
          expect(text.full.split('\n')[0], name).toMatch(/\.$/);
        }
      }
    },
  );

  it.each(COPIES)('gives every type in %s its own card line, short enough for one line', (_lang, copy) => {
    const owner = new Map<string, string>();
    for (const [key, lines] of shortLines(copy)) {
      for (const line of lines) {
        expect(owner.get(line), `"${line}" on ${key}`).toBeUndefined();
        owner.set(line, key);
        expect(line.replace(PLACEHOLDER, '').trim().length, line).toBeLessThanOrEqual(SHORT_LINE_MAX_CHARS);
      }
    }
  });

  it('agrees the Polish wording with the settler’s sex and leads with the name and trade', () => {
    const he = compose(pl.userMessages, 'grewUp', { ...BARE, jobLabel: 'Rolnik', female: false });
    const she = compose(pl.userMessages, 'grewUp', { ...BARE, subjectName: 'Astrid', female: true });
    expect(he).toEqual({
      short: 'Dorósł',
      full: 'Bjorn (Rolnik) dorósł. Możesz nadać mu zawód albo go ożenić.',
    });
    expect(she.short).toBe('Dorosła');
    expect(she.full.startsWith('Astrid dorosła')).toBe(true);
    expect(compose(pl.userMessages, 'hungry', { ...BARE, subjectName: 'Astrid', female: true }).full).toBe(
      'Astrid jest głodna. Dostarcz jedzenie do magazynu w jej zasięgu.',
    );
  });

  it('names buildings, vehicles and seats inside the sentence', () => {
    expect(compose(en.userMessages, 'houseFinished', { ...BARE, subjectName: 'Sawmill' }).full).toBe(
      'Construction finished: Sawmill.',
    );
    expect(compose(pl.userMessages, 'vehicleNoPath', { ...BARE, subjectName: 'Wóz' }).full).toBe(
      'Wóz: brak drogi do celu. Wskaż inny cel.',
    );
    const contact = compose(en.userMessages, 'playerSighted', {
      ...BARE,
      subjectName: 'Player 2',
      stanceName: 'hostile',
    });
    expect(contact).toEqual({
      short: 'Contact: hostile',
      full: 'New contact: Player 2. Attitude toward you: hostile.',
    });
  });

  it('reports a death it cannot name with its own lines', () => {
    expect(compose(en.userMessages, 'humanDied', { ...BARE, subjectName: null })).toEqual({
      short: en.userMessages.short.humanDiedUnknown,
      full: en.userMessages.full.humanDiedUnknown,
    });
    expect(compose(en.userMessages, 'humanDied', BARE).full).toBe('Bjorn has died.');
  });

  it('tells a barracks course from a school one', () => {
    const course = (training: NonNullable<MessageTextParts['training']>) =>
      compose(pl.userMessages, 'canDoNewJob', { ...BARE, training });
    expect(course({ course: 'barracks', profession: 'Żołnierz' })).toEqual({
      short: 'Nowy żołnierz',
      full: 'Bjorn ukończył szkolenie w koszarach i został żołnierzem.',
    });
    expect(course({ course: 'school', profession: 'Młynarz' })).toEqual({
      short: 'Fach: Młynarz',
      full: 'Bjorn ukończył szkołę i zna nowy zawód: Młynarz.',
    });
  });

  it('lists an experience unlock under one heading per kind, leaving empty kinds out', () => {
    const text = compose(en.userMessages, 'experienceUnlocks', {
      ...BARE,
      technologySections: { jobs: ['Miller'], goods: ['Flour', 'Bread'], houses: [], vehicles: [] },
    });
    expect(text.full).toBe(
      'Bjorn has gained experience.\n\nNew professions:\n- Miller\n\nNew goods:\n- Flour\n- Bread',
    );
  });

  it('heads an unlock that opens buildings as such, and lists every one in full', () => {
    const opening = (houses: string[]) => ({
      ...BARE,
      technologySections: { jobs: [], goods: [], houses, vehicles: [] },
    });
    const two = compose(en.userMessages, 'experienceUnlocks', opening(['Pottery', 'School']));
    expect(two.short).toBe('New buildings');
    expect(two.full).toBe('Bjorn has gained experience.\n\nNew buildings:\n- Pottery\n- School');
    expect(compose(pl.userMessages, 'experienceUnlocks', opening(['Garncarnia'])).short).toBe('Nowy budynek');
  });

  it('lists vehicle build sites as vehicles, under their own heading', () => {
    const text = compose(pl.userMessages, 'experienceUnlocks', {
      ...BARE,
      technologySections: { jobs: [], goods: [], houses: ['Szkoła'], vehicles: ['Wózek'] },
    });
    expect(text.short).toBe('Nowy budynek');
    expect(text.full).toBe(
      'Bjorn zdobył doświadczenie.\n\nNowe budynki:\n- Szkoła\n\nNowe pojazdy:\n- Wózek',
    );
    const carts = compose(en.userMessages, 'experienceUnlocks', {
      ...BARE,
      technologySections: { jobs: [], goods: [], houses: [], vehicles: ['Handcart', 'Oxcart'] },
    });
    expect(carts.short).toBe('New vehicles');
  });

  it('words a stalled workshop by its reason and the good it names', () => {
    const stall = (reason: ProductionStallReason) =>
      compose(pl.userMessages, 'productionStalled', {
        ...BARE,
        subjectName: 'Młyn',
        goodName: 'Zboże',
        stall: reason,
      });
    expect(stall('noInputSource')).toEqual({
      short: 'Brak: Zboże',
      full: 'Młyn: produkcja stoi, brakuje surowca: Zboże. Nie ma go w żadnym magazynie i żaden warsztat go nie wytwarza. Zbuduj i obsadź warsztat, który go wytwarza.',
    });
    expect(stall('noGatherer')).toEqual({
      short: 'Nikt nie zbiera: Zboże',
      full: 'Młyn: produkcja stoi, brakuje surowca: Zboże. Nie ma go w żadnym magazynie i nikt go nie zbiera. Przydziel zbieracza albo pozwól obecnym go zbierać.',
    });
    expect(stall('noOutputStore').short).toBe('Brak magazynu');
    expect(stall('unknown').full).toBe(
      'Młyn: produkcja stoi. Zaznacz warsztat: jego panel pokaże przyczynę.',
    );
  });

  it.each(COPIES)('words every idle reason in %s, and a worker the sim gives none', (_lang, copy) => {
    const kinds = Object.keys(copy.idleReason.short) as IdleReasonKind[];
    expect(new Set(kinds)).toEqual(new Set(Object.keys(copy.idleReason.full)));
    expect(new Set(kinds)).toEqual(new Set(Object.keys(copy.idleReason.withoutGood)));
    expect(new Set(Object.values(copy.idleReason.short)).size).toBe(kinds.length);
    const cases = [...kinds.map((kind) => ({ kind, goodTypes: [4] })), null].flatMap((idle) =>
      ['Chleb', null].map((goodName) => ({ idle, goodName })),
    );
    for (const { idle, goodName } of cases) {
      for (const female of [false, true]) {
        const text = compose(copy, 'nothingToDo', { ...BARE, female, goodName, idle });
        for (const line of [text.short, text.full]) {
          expect(line, idle?.kind).not.toMatch(PLACEHOLDER);
          expect(line, idle?.kind).not.toMatch(/[—–]| {2}|: ?[.,]|:$/);
        }
        expect(text.short.replace('Chleb', '').trim().length, text.short).toBeLessThanOrEqual(
          SHORT_LINE_MAX_CHARS,
        );
        expect(text.full).toMatch(/\.$/);
      }
    }
  });

  it('names why an idle worker stands, with what to do, in place of a pointer to its panel', () => {
    const idle = (parts: Partial<MessageTextParts>) =>
      compose(pl.userMessages, 'nothingToDo', { ...BARE, goodName: 'Drewno', ...parts });
    expect(
      idle({ goodName: 'Drewno, Kamień', idle: { kind: 'noResourceInArea', goodTypes: [4, 5] } }),
    ).toEqual({
      short: 'Brak w obszarze',
      full: 'Bjorn nie ma nic do roboty. W obszarze pracy nie znaleziono zasobów do zebrania: Drewno, Kamień. Wskaż flagą roboczą miejsce z zasobami albo rozszerz zasięg drogowskazów.',
    });
    expect(idle({ female: true, goodName: null, idle: { kind: 'noResource', goodTypes: [] } }).full).toBe(
      'Bjorn nie ma nic do roboty. W zasięgu nie ma nic do zebrania. Nadaj jej inny zawód.',
    );
    expect(idle({ goodName: null, idle: { kind: 'nothingAtFlag', goodTypes: [] } })).toEqual({
      short: 'Nic do zebrania',
      full: 'Bjorn nie ma nic do roboty. Przy chorągiewce nie ma nic do zebrania. Przenieś chorągiewkę tam, gdzie leżą towary, albo ją zabierz.',
    });
    expect(idle({ goodName: null, idle: { kind: 'noGame', goodTypes: [] } })).toEqual({
      short: 'Brak zwierzyny',
      full: 'Bjorn nie ma nic do roboty. W terenie łowieckim nie widać wolnej zwierzyny. Wskaż flagą roboczą miejsce, gdzie pasie się zwierzyna.',
    });
    expect(idle({ goodName: null, idle: { kind: 'gameOutOfReach', goodTypes: [] } }).short).toBe(
      'Zwierz odcięty',
    );
    expect(idle({ idle: null })).toEqual({
      short: 'Nic do roboty',
      full: 'Bjorn nie ma nic do roboty. Przyczyny nie widać. Sprawdź, czy miejsce pracy ma w zasięgu magazyn i potrzebne towary.',
    });
  });

  it("counts a fight's hit bodies in the catalog's plural forms and names who struck", () => {
    const NAMELESS = { ...BARE, subjectName: null };
    const raid = composeIn(pl.userMessages, 'pl', 'settlementAttacked', {
      ...NAMELESS,
      fight: { buildings: 2, walls: 3, settlers: 1, vehicles: 5, enemies: ['Gracz 2'], wild: false },
    });
    expect(raid).toEqual({
      short: 'Atak na osadę',
      full: 'Twoja osada jest atakowana. Wróg: Gracz 2. Zaatakowano: 2 budynki, 3 odcinki muru, 1 osadnika, 5 pojazdów. Wyślij żołnierzy do obrony.',
    });
    const wolves = composeIn(en.userMessages, 'en', 'peopleAttacked', {
      ...NAMELESS,
      fight: { buildings: 0, walls: 0, settlers: 3, vehicles: 0, enemies: [], wild: true },
    });
    expect(wolves.full).toBe(
      'Your people are under attack outside the settlement. Enemy: wild beasts. Hit: 3 settlers. Send soldiers or lead them to safety.',
    );
    expect(wolves.short).toBe('Under attack');
  });

  it('sums a fight up for its row in a stack: who struck, then what they hit', () => {
    const fight = { buildings: 2, walls: 0, settlers: 1, vehicles: 0, enemies: ['Gracz 2'], wild: true };
    expect(fightSummary(fight, pl.userMessages, 'pl')).toBe('Gracz 2, dzikie bestie · 2 budynki, 1 osadnika');
    expect(fightSummary({ ...fight, buildings: 0, settlers: 0 }, en.userMessages, 'en')).toBe(
      'Gracz 2, wild beasts',
    );
  });

  it('names the husband where the reason is his, and reads cleanly when he cannot be named', () => {
    const family = (partner: { name: string; jobLabel: string | null; female: boolean } | null) =>
      compose(pl.userMessages, 'familyBlocked', {
        ...BARE,
        subjectName: 'Astrid',
        female: true,
        family: { wait: 'husbandAway', partner },
      });
    const named = family({ name: 'Olaf', jobLabel: 'Zwiadowca', female: false });
    expect(named.short).toBe('Mąż nie wraca');
    expect(
      named.full.startsWith('Astrid nie może mieć dziecka: jej mąż Olaf (Zwiadowca) przez swój zawód'),
    ).toBe(true);
    expect(family(null).full.startsWith('Astrid nie może mieć dziecka: jej mąż przez swój zawód')).toBe(true);
  });
});
