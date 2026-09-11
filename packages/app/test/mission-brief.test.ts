import type { HypertextBlock, MapBriefing, MapScript } from '@open-northland/data';
import type { MissionStatus } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  briefingPage,
  introCutsceneId,
  type MissionBriefSource,
  missionBrief,
  missionGoals,
} from '../src/game/mission-brief.js';

/** The pure joins behind the mission window: which page a scriptless map opens on, which goals show
 *  with which mark, and how the brief falls back when a map ships no briefing. */

const line = (...values: string[]): { key: string; values: string[] } => ({ key: 'x', values });

function script(over: Partial<MapScript> = {}): MapScript {
  return { players: [], diplomacy: [], specialItems: [], misc: [], humanNames: [], missions: [], ...over };
}

const OPENING = {
  debugName: 'Odprawa',
  active: true,
  visible: true,
  goals: [line('True')],
  results: [line('ExploreArea', '2', '0', '0', '0'), line('PlayCutscene', '500', '1')],
  other: [],
};
const WIN = {
  debugName: 'MissionWon',
  description: 'Pokonaj saracenów',
  active: true,
  visible: true,
  goals: [line('PlayerDied', '2')],
  results: [line('PlayCutscene', '501', '1'), line('MissionWon', '0')],
  other: [],
};

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

describe('introCutsceneId', () => {
  it('takes the first active trigger that fires at once and plays a cutscene', () => {
    expect(introCutsceneId(script({ missions: [WIN, OPENING] }))).toBe(500);
  });

  it('accepts a TimeGone that has as good as passed, but not a later one', () => {
    expect(introCutsceneId(script({ missions: [{ ...OPENING, goals: [line('TimeGone', '0')] }] }))).toBe(500);
    expect(introCutsceneId(script({ missions: [{ ...OPENING, goals: [line('TimeGone', '1')] }] }))).toBe(500);
    expect(
      introCutsceneId(script({ missions: [{ ...OPENING, goals: [line('TimeGone', '5')] }] })),
    ).toBeNull();
  });

  it('skips inactive triggers, triggers with other goals, and triggers without a cutscene', () => {
    expect(introCutsceneId(script({ missions: [{ ...OPENING, active: false }, WIN] }))).toBeNull();
    expect(
      introCutsceneId(script({ missions: [{ ...OPENING, goals: [line('True'), line('TimeGone', '5')] }] })),
    ).toBeNull();
    expect(
      introCutsceneId(script({ missions: [{ ...OPENING, results: [line('MissionWon', '0')] }] })),
    ).toBeNull();
  });
});

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
    expect(goals).toEqual([
      { text: 'Pokonaj saracenów', rule: 'authored', state: 'done' },
      { text: 'Zbuduj świątynię', rule: 'authored', state: 'open' },
      { text: 'Zbuduj świątynię', rule: 'authored', state: 'idle' },
      { text: '#999', rule: 'authored', state: 'open' },
    ]);
  });

  it('drops the emphasis mark the corpus prefixes some goals with', () => {
    expect(missionGoals([status({ description: 301 })], textOf).map((g) => g.text)).toEqual([
      'Skolonizuj krainę!',
    ]);
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

  it('heads the brief with the page title and lists the authored goals, then the match rule', () => {
    const goals = [status({})];
    expect(missionBrief(source(null), 500, goals, textOf, 'undecided')).toEqual({
      title: 'BURZA PIASKOWA',
      blocks: [{ kind: 'text', style: 'body', text: 'Wikingowie rozpoczęli oblężenie.' }],
      goals: [{ text: 'Pokonaj saracenów', rule: 'authored', state: 'open' }],
    });
    expect(missionBrief(source('Pokonaj wszystkich.'), 500, goals, textOf, 'undecided').goals).toEqual([
      { text: 'Pokonaj saracenów', rule: 'authored', state: 'open' },
      { text: 'Pokonaj wszystkich.', rule: 'skirmish', state: 'open' },
    ]);
    // The author already wrote the rule: it is not listed twice.
    expect(missionBrief(source('Pokonaj saracenów'), 500, goals, textOf, 'undecided').goals).toHaveLength(1);
  });

  it('ticks the skirmish goal on victory and leaves the authored ones to the sim', () => {
    const goals = missionBrief(source('Pokonaj wszystkich.'), 500, [status({})], textOf, 'victory').goals;
    expect(goals.map((g) => g.state)).toEqual(['open', 'done']);
  });

  it('falls back to the map name and menu description without a page', () => {
    expect(missionBrief(source(null), null, [], textOf, 'undecided')).toEqual({
      title: 'Burza Piaskowa',
      blocks: [{ kind: 'text', style: 'body', text: 'Opis z menu.' }],
      goals: [],
    });
    expect(missionBrief(source(null), 7, [], textOf, 'undecided').title).toBe('Burza Piaskowa');
  });
});
