import { describe, expect, it } from 'vitest';
import type { MissionGoal, MissionReader } from '../src/game/mission-brief.js';
import type { BookOpening, BookReading, BookWindow } from '../src/hud/dom/mission-book/book-window.js';
import type { GoalSlip } from '../src/hud/dom/mission-book/goal-slip.js';
import { createMissionBook, type MissionBookDeps } from '../src/hud/dom/mission-book/index.js';

/** The mission book's pause contract without a document: the open book holds the game until it
 *  closes, a script's chapter is marked as delivered, and a remount carries an open book over. */

const PAGE = 500;

function goal(key: string, state: MissionGoal['state']): MissionGoal {
  return { key, text: key, emphasis: false, rule: 'authored', state };
}

function mount(pauseStopsClock = true) {
  const holds: boolean[] = [];
  const openings: BookOpening[] = [];
  const dismiss: { run: () => void } = { run: () => undefined };
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
    setDrop: () => undefined,
    dispose: () => undefined,
  };
  const deps: MissionBookDeps = {
    plane: {} as HTMLElement,
    reader,
    briefingHistory: () => [PAGE],
    replayPage: () => PAGE,
    history: null,
    missionHuman: () => null,
    answersVersion: () => 0,
    pictureUrl: (file) => file,
    pauseStopsClock,
    onHold: (held) => holds.push(held),
    onShowOnMap: () => undefined,
    onSlipOpen: () => undefined,
    bookKey: () => null,
    cue: () => undefined,
  };
  const mission = createMissionBook(deps, {
    book: (bookDeps) => {
      dismiss.run = bookDeps.onDismiss;
      return book;
    },
    slip: () => slip,
  });
  const setGoals = (next: readonly MissionGoal[]): void => {
    goals = next;
  };
  return { mission, holds, openings, dismiss, setGoals };
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

  it('holds the game for the player`s own reading from the beam or the slip, without the arrival dim', () => {
    const { mission, holds, openings } = mount();
    mission.toggle();
    expect(openings.at(-1)).toMatchObject({ arrival: false, paused: false });
    expect(holds).toEqual([true]);
    mission.close();
    expect(holds).toEqual([true, false]);
    mission.openGoals();
    expect(openings.at(-1)?.reading.tab).toBe('goals');
    mission.close();
    expect(holds).toEqual([true, false, true, false]);
  });

  it('keeps one hold when a script`s chapter opens over the player`s reading', () => {
    const { mission, holds, openings } = mount();
    mission.toggle();
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
