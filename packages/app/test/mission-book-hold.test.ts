import type { BriefingVoice, HypertextCallback } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { MissionBriefingAnswer, MissionGoal, MissionReader } from '../src/game/mission-brief.js';
import type { BookOpening, BookReading, BookWindow } from '../src/hud/dom/mission-book/book-window.js';
import type { GoalSlip } from '../src/hud/dom/mission-book/goal-slip.js';
import {
  type BriefingViewTarget,
  createMissionBook,
  type MissionBookDeps,
} from '../src/hud/dom/mission-book/index.js';

/** The mission book's contract without a document: the open book holds the game until it closes, a
 *  script's chapter is marked as delivered, a remount carries an open book over, and the briefing
 *  callbacks centre the view once per opening. */

const PAGE = 500;

/** Lets the beam's briefing answer land. */
const answered = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function goal(key: string, state: MissionGoal['state']): MissionGoal {
  return { key, text: key, emphasis: false, rule: 'authored', state };
}

function mount(pauseStopsClock = true, briefing: MissionBriefingAnswer = { history: [PAGE], page: PAGE }) {
  const holds: boolean[] = [];
  const openings: BookOpening[] = [];
  const dismiss: { run: () => void } = { run: () => undefined };
  const fire: { callback: (args: HypertextCallback['args'] | null, spread?: string) => void } = {
    callback: () => undefined,
  };
  const spoken: (BriefingVoice | 'stop')[] = [];
  const centred: BriefingViewTarget[] = [];
  let goals: readonly MissionGoal[] = [goal('0', 'open')];
  let open = false;
  let reading: BookReading = { tab: 'brief', chapter: 0, spread: 0, table: null, pick: 0 };
  const reader: MissionReader = {
    page: () => ({ title: '', blocks: [], lang: null }),
    goals: () => goals,
    missionName: 'Test',
  };
  const book: BookWindow = {
    element: {} as HTMLElement,
    isOpen: () => open,
    open: (opening) => {
      open = true;
      reading = opening.reading;
      openings.push(opening);
    },
    close: () => {
      open = false;
    },
    reading: () => reading,
    refresh: () => undefined,
    rebuild: () => undefined,
    views: () => [],
    dispose: () => undefined,
  };
  let folded = false;
  const slip: GoalSlip = {
    update: () => undefined,
    isFolded: () => folded,
    setFolded: (next) => {
      folded = next;
    },
    dispose: () => undefined,
  };
  const deps: MissionBookDeps = {
    plane: {} as HTMLElement,
    reader,
    briefingHistory: () => [PAGE],
    askBriefing: () => Promise.resolve(briefing),
    history: null,
    missionHuman: () => null,
    answersVersion: () => 0,
    pictureUrl: (file) => file,
    pauseStopsClock,
    onHold: (held) => holds.push(held),
    onShowOnMap: () => undefined,
    onCentreView: (target) => centred.push(target),
    onSlipOpen: () => undefined,
    bookKey: () => null,
    cue: () => undefined,
    voice: { play: (voice) => spoken.push(voice), stop: () => spoken.push('stop') },
  };
  const mission = createMissionBook(deps, {
    book: (bookDeps) => {
      dismiss.run = bookDeps.onDismiss;
      fire.callback = (args, spread = '0:0') =>
        bookDeps.onCallback(args === null ? null : { args, lang: 'pol', spread });
      return book;
    },
    slip: () => slip,
  });
  const setGoals = (next: readonly MissionGoal[]): void => {
    goals = next;
  };
  return { mission, holds, openings, dismiss, setGoals, fire, centred, spoken };
}

describe('the mission book`s pause', () => {
  it('holds the game for a script`s chapter until the book closes, once', () => {
    const { mission, holds, openings, dismiss } = mount();
    mission.showPage(PAGE);
    mission.showPage(PAGE);
    expect(holds).toEqual([true]);
    expect(openings.at(-1)).toMatchObject({ arrival: true, paused: true });
    dismiss.run();
    expect(holds).toEqual([true, false]);
    expect(mission.isOpen()).toBe(false);
  });

  it('holds the game for the player`s own reading from the beam or the slip, without the arrival dim', async () => {
    const { mission, holds, openings } = mount();
    mission.toggle();
    await answered();
    expect(openings.at(-1)).toMatchObject({ arrival: false, paused: false });
    expect(holds).toEqual([true]);
    mission.close();
    expect(holds).toEqual([true, false]);
    mission.openGoals();
    expect(openings.at(-1)?.reading.tab).toBe('goals');
    mission.close();
    expect(holds).toEqual([true, false, true, false]);
  });

  it('opens from the beam on the start of the replayable chapter as of the click', async () => {
    const { mission, openings } = mount(true, { history: [PAGE, PAGE + 1, PAGE + 2], page: PAGE + 1 });
    mission.toggle();
    expect(openings).toEqual([]);
    await answered();
    expect(openings.at(-1)?.reading).toMatchObject({ tab: 'brief', chapter: 1, spread: 0 });
  });

  it('drops a beam opening still waiting when the book closes or a script opens it', async () => {
    const { mission, openings } = mount();
    mission.toggle();
    mission.close();
    await answered();
    expect(mission.isOpen()).toBe(false);
    mission.toggle();
    mission.showPage(PAGE);
    await answered();
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ arrival: true });
  });

  it('keeps one hold when a script`s chapter opens over the player`s reading', async () => {
    const { mission, holds, openings } = mount();
    mission.toggle();
    await answered();
    mission.showPage(PAGE);
    expect(openings.at(-1)).toMatchObject({ arrival: true, paused: true });
    mission.openGoals();
    expect(openings.at(-1)).toMatchObject({ arrival: true });
    mission.close();
    expect(holds).toEqual([true, false]);
  });

  it('shows a chapter without dimming the map on a shared clock', () => {
    const { mission, openings } = mount(false);
    mission.showPage(PAGE);
    expect(openings.at(-1)).toMatchObject({ arrival: true, paused: false });
  });

  it('carries a delivered chapter and the unread goal marks over a remount', () => {
    const first = mount();
    first.mission.refresh();
    first.setGoals([goal('0', 'done')]);
    first.mission.refresh();
    first.mission.showPage(PAGE);
    const state = first.mission.state();
    expect(state.arrival).toBe(true);
    first.mission.dispose();
    expect(first.holds).toEqual([true]);

    const second = mount();
    second.setGoals([goal('0', 'done')]);
    second.mission.restore(state);
    expect(second.mission.unread()).toBe(true);
    second.mission.toggle();
    expect(second.holds).toEqual([true]);
    expect(second.openings.at(-1)).toMatchObject({ arrival: true, reading: state.reading });
    second.mission.refresh();
    expect(second.mission.unread()).toBe(true);
  });
});

describe('the briefing callbacks', () => {
  const HUMANS_5: HypertextCallback['args'] = [1001, 5, 0];
  const NODE: HypertextCallback['args'] = [1000, 296, 188];
  const SOUND: HypertextCallback['args'] = [2000, 3, 0];

  it('centre the view once per opening, the first that moves a view spending the flag', async () => {
    const { mission, fire, centred } = mount();
    mission.toggle();
    await answered();
    fire.callback(SOUND);
    fire.callback([999, 1, 2]);
    fire.callback(HUMANS_5);
    fire.callback(NODE);
    expect(centred).toEqual([{ kind: 'group', group: 'human', id: 5 }]);
    mission.close();
    mission.toggle();
    await answered();
    fire.callback(NODE);
    expect(centred.at(-1)).toEqual({ kind: 'node', hx: 296, hy: 188 });
    expect(centred).toHaveLength(2);
  });

  it('reset the flag when a script`s chapter opens the closed book', async () => {
    const { mission, fire, centred } = mount();
    mission.toggle();
    await answered();
    fire.callback(NODE);
    mission.close();
    mission.showPage(PAGE);
    fire.callback(HUMANS_5);
    expect(centred).toHaveLength(2);
  });

  it('keep the spent flag for a chapter delivered to the open book', async () => {
    const { mission, fire, centred } = mount();
    mission.toggle();
    await answered();
    fire.callback(NODE);
    mission.showPage(PAGE);
    fire.callback(HUMANS_5);
    expect(centred).toHaveLength(1);
  });

  it('keep the spent flag over a remount of the open book', () => {
    const first = mount();
    first.mission.showPage(PAGE);
    first.fire.callback(NODE);
    const state = first.mission.state();
    expect(state.viewCentred).toBe(true);
    first.mission.dispose();

    const second = mount();
    second.mission.restore(state);
    second.mission.toggle();
    second.fire.callback(HUMANS_5);
    expect(second.centred).toEqual([]);
  });

  it('speak a 2000 callback once per spread shown and silence it on another spread or the close', () => {
    const { mission, fire, spoken, centred } = mount();
    mission.toggle();
    spoken.length = 0;
    fire.callback(SOUND, '0:0');
    fire.callback(SOUND, '0:0');
    expect(spoken).toEqual([{ lang: 'pol', id: 3 }]);
    fire.callback(null, '0:1');
    fire.callback(NODE, '0:2');
    expect(spoken.slice(1)).toEqual(['stop', 'stop']);
    fire.callback(SOUND, '0:0');
    expect(spoken.at(-1)).toEqual({ lang: 'pol', id: 3 });
    mission.close();
    expect(spoken.at(-1)).toBe('stop');
    expect(centred).toEqual([{ kind: 'node', hx: 296, hy: 188 }]);
  });
});
