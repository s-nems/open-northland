import type { HypertextBlock, MapBriefing } from '@open-northland/data';
import type { MissionStatus } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  briefingPage,
  type MissionBriefSource,
  mapBriefFallback,
  missionGoalList,
  missionGoals,
  missionPage,
  missionReader,
} from '../src/game/mission-brief.js';

/** The pure joins behind the mission book: which goals show in which state, and how a page falls back
 *  when a map ships no briefing. */

const TEXTS: Readonly<Record<number, string>> = {
  300: 'Pokonaj saracenów',
  301: '@Skolonizuj krainę!',
  302: 'Zbuduj świątynię',
};
const textOf = (id: number): string | undefined => TEXTS[id];

function status(over: Partial<MissionStatus>, index = 0): MissionStatus {
  return {
    index,
    description: 300,
    visible: true,
    active: true,
    done: false,
    firstFiredTick: undefined,
    lastFiredTick: undefined,
    fireCount: 0,
    ...over,
  };
}

describe('missionGoals', () => {
  it('lists the visible missions that name a text, in script order, marked by their flags', () => {
    const goals = missionGoals(
      [
        status({ done: true }),
        status({ description: 302, active: true }, 1),
        status({ description: 302, active: false }, 2),
        status({ description: 302, visible: false }, 3),
        status({ description: undefined }, 4),
        status({ description: 999 }, 5),
      ],
      textOf,
    );
    expect(goals.map(({ key, text, state }) => ({ key, text, state }))).toEqual([
      { key: '0', text: 'Pokonaj saracenów', state: 'done' },
      { key: '1', text: 'Zbuduj świątynię', state: 'open' },
      { key: '2', text: 'Zbuduj świątynię', state: 'idle' },
      { key: '5', text: '#999', state: 'open' },
    ]);
  });

  it('drops the emphasis mark the corpus prefixes some goals with and keeps it as emphasis', () => {
    const [goal] = missionGoals([status({ description: 301 })], textOf);
    expect(goal).toMatchObject({ text: 'Skolonizuj krainę!', emphasis: true });
  });
});

describe('briefingPage and missionBrief', () => {
  const briefing: MapBriefing = {
    texts: {
      pol: {
        '500': [
          { kind: 'text', style: 'title', text: 'BURZA PIASKOWA' },
          { kind: 'text', style: 'body', text: 'Wikingowie rozpoczęli oblężenie.' },
        ],
      },
      eng: { '500': [{ kind: 'text', style: 'body', text: 'The vikings laid siege.' }] },
    },
  };

  /** The first block of a page, when it is text: every fixture page here opens on a paragraph. */
  const firstText = (page: readonly HypertextBlock[] | null): string | undefined => {
    const first = page?.[0];
    return first?.kind === 'text' ? first.text : undefined;
  };

  const source = (skirmishGoal: string | null): MissionBriefSource => ({
    page: (id) => briefingPage(briefing, 'pol', id),
    fallback: { title: 'Burza Piaskowa', description: 'Opis z menu.' },
    skirmishGoal,
  });

  it('prefers the app language and falls back through the authoring languages', () => {
    expect(firstText(briefingPage(briefing, 'eng', 500))).toBe('The vikings laid siege.');
    expect(firstText(briefingPage(briefing, 'ger', 500))).toBe('BURZA PIASKOWA');
    expect(briefingPage(briefing, 'pol', 7)).toBeNull();
    expect(briefingPage(null, 'pol', 500)).toBeNull();
  });

  it('carries the page as authored, else the map name over its menu description', () => {
    expect(missionPage(source(null), 500)).toEqual({ title: '', blocks: briefing.texts.pol?.['500'] });
    expect(missionPage(source(null), null)).toEqual({
      title: 'Burza Piaskowa',
      blocks: [{ kind: 'text', style: 'body', text: 'Opis z menu.' }],
    });
    expect(missionPage(source(null), 7).title).toBe('Burza Piaskowa');
  });

  it('lists the authored goals, then the match rule unless the author wrote it, done on victory', () => {
    const goals = [status({})];
    const texts = (outcome: 'undecided' | 'victory', rule: string | null) =>
      missionGoalList(source(rule), goals, textOf, outcome).map((g) => `${g.key}:${g.state}:${g.text}`);
    expect(texts('undecided', null)).toEqual(['0:open:Pokonaj saracenów']);
    expect(texts('undecided', 'Pokonaj wszystkich.')).toEqual([
      '0:open:Pokonaj saracenów',
      'skirmish:open:Pokonaj wszystkich.',
    ]);
    expect(texts('victory', 'Pokonaj wszystkich.').at(-1)).toBe('skirmish:done:Pokonaj wszystkich.');
    expect(texts('undecided', 'Pokonaj saracenów')).toHaveLength(1);
  });

  it('keeps one goal list per tick and reads the flags anew on the next', () => {
    let tick = 1;
    let reads = 0;
    const reader = missionReader(
      source(null),
      {
        tick: () => tick,
        status: () => {
          reads++;
          return [status({})];
        },
        outcome: () => 'undecided',
      },
      textOf,
    );
    const first = reader.goals();
    expect(reader.goals()).toBe(first);
    tick = 2;
    expect(reader.goals()).not.toBe(first);
    expect(reads).toBe(2);
    expect(reader.missionName).toBe('Burza Piaskowa');
  });
});

describe('mapBriefFallback', () => {
  it('reads the menu name and description in the player language, else a shipped one', () => {
    const meta = { name: { pol: 'Burza Piaskowa', eng: 'Sandstorm' }, description: { pol: 'Opis z menu.' } };
    expect(mapBriefFallback(meta, 'eng')).toEqual({ title: 'Sandstorm', description: 'Opis z menu.' });
    expect(mapBriefFallback(null, 'eng')).toEqual({ title: '' });
  });
});
