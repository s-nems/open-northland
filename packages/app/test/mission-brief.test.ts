import type { HypertextBlock, MapBriefing, MapScript } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  briefAtOutcome,
  briefingPage,
  introCutsceneId,
  mapMissionBrief,
  missionGoals,
} from '../src/game/mission-brief.js';

/** The pure joins behind the mission window: which cutscene opens the map, which goals show, and how
 *  the brief falls back when a map ships no briefing. */

const line = (...values: string[]): { key: string; values: string[] } => ({ key: 'x', values });

function script(over: Partial<MapScript> = {}): MapScript {
  return { players: [], diplomacy: [], specialItems: [], misc: [], missions: [], ...over };
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
  it('lists the visible active goal texts once, in script order', () => {
    const missions = [
      OPENING,
      WIN,
      { ...WIN, description: 'Pokonaj saracenów' },
      { ...WIN, description: 'Zbuduj świątynię', visible: false },
      { ...WIN, description: 'Przetrwaj', active: false },
      { ...WIN, description: '  ' },
    ];
    expect(missionGoals(script({ missions }))).toEqual(['Pokonaj saracenów']);
  });

  it('drops the emphasis mark the corpus prefixes some goals with', () => {
    const missions = [
      { ...WIN, description: '@Skolonizuj krainę!' },
      { ...WIN, description: 'Zbuduj świątynię' },
    ];
    expect(missionGoals(script({ missions }))).toEqual(['Skolonizuj krainę!', 'Zbuduj świątynię']);
  });
});

describe('briefingPage and mapMissionBrief', () => {
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

  it('prefers the app language and falls back through the authoring languages', () => {
    expect(firstText(briefingPage(briefing, 'eng', 500))).toBe('The vikings laid siege.');
    expect(firstText(briefingPage(briefing, 'ger', 500))).toBe('BURZA PIASKOWA');
    expect(briefingPage(briefing, 'pol', 7)).toBeNull();
    expect(briefingPage(null, 'pol', 500)).toBeNull();
  });

  it('heads the brief with the page title and lists the authored goals, then the match rule', () => {
    const input = {
      script: script({ missions: [OPENING, WIN] }),
      briefing,
      lang: 'pol',
      name: 'Burza Piaskowa',
      description: 'Opis z menu.',
      skirmishGoal: 'Pokonaj wszystkich.',
    };
    expect(mapMissionBrief({ ...input, matchDeclared: false })).toEqual({
      title: 'BURZA PIASKOWA',
      blocks: [{ kind: 'text', style: 'body', text: 'Wikingowie rozpoczęli oblężenie.' }],
      goals: [{ text: 'Pokonaj saracenów', rule: 'authored', done: false }],
    });
    // The authored goals are informational; with a match declared the rule that decides is listed too.
    expect(mapMissionBrief({ ...input, matchDeclared: true }).goals).toEqual([
      { text: 'Pokonaj saracenów', rule: 'authored', done: false },
      { text: 'Pokonaj wszystkich.', rule: 'skirmish', done: false },
    ]);
  });

  it('falls back to the map name, the menu description and the skirmish goal', () => {
    const brief = mapMissionBrief({
      script: script(),
      briefing: null,
      lang: 'pol',
      name: 'Wody Nilu',
      description: 'Mapa wolnej gry.',
      skirmishGoal: 'Pokonaj wszystkich.',
      matchDeclared: true,
    });
    expect(brief).toEqual({
      title: 'Wody Nilu',
      blocks: [{ kind: 'text', style: 'body', text: 'Mapa wolnej gry.' }],
      goals: [{ text: 'Pokonaj wszystkich.', rule: 'skirmish', done: false }],
    });
    expect(
      mapMissionBrief({
        script: null,
        briefing: null,
        lang: 'pol',
        name: undefined,
        description: undefined,
        skirmishGoal: 'x',
        matchDeclared: false,
      }),
    ).toEqual({ title: '', blocks: [], goals: [] });
  });

  it('keeps a page without a headline whole and titles it with the map name', () => {
    const brief = mapMissionBrief({
      script: script({ missions: [OPENING] }),
      briefing,
      lang: 'eng',
      name: 'Sandstorm',
      description: undefined,
      skirmishGoal: 'Defeat everyone.',
      matchDeclared: false,
    });
    expect(brief.title).toBe('Sandstorm');
    expect(brief.blocks).toEqual([{ kind: 'text', style: 'body', text: 'The vikings laid siege.' }]);
  });
});

describe('briefAtOutcome', () => {
  const brief = {
    title: 'x',
    blocks: [],
    goals: [
      { text: 'Build a temple', rule: 'authored' as const, done: false },
      { text: 'Defeat everyone', rule: 'skirmish' as const, done: false },
    ],
  };

  it('ticks the skirmish goal on victory and leaves the authored ones open', () => {
    expect(briefAtOutcome(brief, 'victory').goals.map((g) => g.done)).toEqual([false, true]);
  });

  it('returns the brief itself while the match is undecided or lost', () => {
    expect(briefAtOutcome(brief, 'undecided')).toBe(brief);
    expect(briefAtOutcome(brief, 'defeat')).toBe(brief);
  });
});
