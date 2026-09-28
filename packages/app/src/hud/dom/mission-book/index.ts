import type { UiCue } from '@open-northland/audio';
import type { HypertextBook } from '@open-northland/data';
import type { MapViewTarget } from '@open-northland/render';
import type { MissionReader } from '../../../game/mission-brief.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import { type BookReading, type BookView, createBookWindow } from './book-window.js';
import { GoalMarks } from './goal-marks.js';
import { createGoalSlip } from './goal-slip.js';
import { ShownPages, type ShownPagesState } from './shown-pages.js';
import type { MissionHumanLookup } from './user-icons.js';

export type { BookView } from './book-window.js';
export type { MissionHumanLookup } from './user-icons.js';

/** The chapters shown so far, where an open book's reader stands and the slip's fold, carried across
 *  a remount. */
export interface MissionWindowState extends ShownPagesState {
  readonly reading: BookReading | null;
  /** The open book shows a script's chapter and holds the game. */
  readonly held: boolean;
  readonly slipFolded: boolean;
}

/** What a world without a mission reader shows: the book's empty page and no goals. */
export const NO_MISSION: MissionReader = {
  page: () => ({ title: '', blocks: [] }),
  goals: () => [],
  missionName: '',
};

export interface MissionBookDeps {
  readonly plane: HTMLElement;
  readonly reader: MissionReader;
  /** The briefing pages the sim has delivered, oldest first. */
  readonly briefingHistory: () => readonly number[];
  /** The page the book opens on from the beam: the last replayable one, or null before any. */
  readonly replayPage: () => number | null;
  /** The history tables the chronicle opens; null leaves them out. */
  readonly history: HypertextBook | null;
  readonly missionHuman: MissionHumanLookup;
  /** Bumped when the briefing history, the replay page or a mission human lands anew. */
  readonly answersVersion: () => number;
  readonly pictureUrl: (file: string) => string;
  /** Whether a held pause stops the clock; a shared clock is nobody's to hold. */
  readonly pauseStopsClock: boolean;
  /** A script's chapter holds the game while the book shows it; the player's own reading never does. */
  readonly onScriptHold: (held: boolean) => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onShowOnMap: (target: MapViewTarget) => void;
  /** The key that toggles the book, for the slip's button; null when unbound. */
  readonly bookKey: () => string | null;
  readonly cue: (cue: UiCue) => void;
}

/** The mission book (briefing chapters, goals, chronicle) and the goal slip on the map. The plane
 *  routes their pointer input itself, so the book claims no canvas point. */
export interface MissionBook extends ToolWindow {
  /** Open on briefing `page`, a script's `PlayCutscene`, which joins the chapters. */
  showPage(page: number): void;
  state(): MissionWindowState;
  restore(state: MissionWindowState): void;
  /** Once a frame: follow the goals, the slip and the screen. */
  refresh(): void;
  /** Hang the goal slip `depth` design px lower, below the script's info lines. */
  dropSlip(depth: number): void;
  /** The world views the open book shows, for the renderer to paint under its holes. */
  views(): readonly BookView[];
  /** A goal changed since the goal page last showed, which the beam and the folded slip mark. */
  unread(): boolean;
  /** The close medallion or the resume button closed the book; the owner returns focus. */
  onDismiss(listener: () => void): void;
  dispose(): void;
}

const FIRST: BookReading = { tab: 'brief', chapter: 0, spread: 0, table: null, pick: 0 };

export function createMissionBook(deps: MissionBookDeps): MissionBook {
  const shown = new ShownPages();
  const marks = new GoalMarks();
  const listeners: (() => void)[] = [];
  let held = false;
  /** A restored reading the next opening resumes, and whether it held the game. */
  let resume: { readonly reading: BookReading; readonly held: boolean } | null = null;
  let answersKey = deps.answersVersion();

  const chapters = (): readonly (number | null)[] => shown.list;
  const chapterOf = (page: number | null): number => {
    const at = page === null ? -1 : shown.list.indexOf(page);
    return at < 0 ? Math.max(0, shown.list.length - 1) : at;
  };

  const hold = (): void => {
    if (held) return;
    held = true;
    deps.onScriptHold(true);
  };
  const release = (): void => {
    if (!held) return;
    held = false;
    deps.onScriptHold(false);
  };

  const close = (): void => {
    if (!book.isOpen()) return;
    book.close();
    release();
    deps.onOpenChange?.(false);
  };

  const book = createBookWindow({
    plane: deps.plane,
    chapters,
    page: (page) => deps.reader.page(page),
    goals: () => deps.reader.goals(),
    missionName: deps.reader.missionName,
    history: deps.history,
    missionHuman: deps.missionHuman,
    pictureUrl: deps.pictureUrl,
    onShowOnMap: (target) => {
      close();
      deps.onShowOnMap(target);
    },
    takeGoalMarks: () => {
      const unseen = marks.snapshot();
      marks.read();
      return unseen;
    },
    onDismiss: () => {
      close();
      for (const listener of listeners) listener();
    },
    cue: deps.cue,
  });

  const open = (reading: BookReading, arrival: boolean): void => {
    const wasOpen = book.isOpen();
    marks.observe(deps.reader.goals());
    book.open({ reading, arrival, paused: arrival && deps.pauseStopsClock });
    if (!wasOpen) deps.onOpenChange?.(true);
  };

  /** From the beam the book opens on the map's replayable chapter (reading); a map whose pages all came
   *  without the replay flag opens on the last one shown (approximation). */
  const openFromBeam = (): void => {
    shown.fold(deps.briefingHistory());
    const resumed = resume;
    resume = null;
    if (resumed?.held === true) hold();
    open(resumed?.reading ?? { ...FIRST, chapter: chapterOf(deps.replayPage() ?? shown.page) }, held);
  };

  const slip = createGoalSlip({
    plane: deps.plane,
    bookKey: deps.bookKey,
    onOpenBook: () => {
      shown.fold(deps.briefingHistory());
      resume = null;
      open({ ...FIRST, tab: 'goals', chapter: chapterOf(shown.page) }, false);
    },
    cue: deps.cue,
  });
  slip.setDrop(0);

  return {
    isOpen: () => book.isOpen(),
    toggle: () => (book.isOpen() ? close() : openFromBeam()),
    close,
    claims: () => false,
    handleClick: () => false,
    showPage(page): void {
      resume = null;
      shown.fold(deps.briefingHistory());
      shown.show(page);
      hold();
      open({ ...FIRST, chapter: chapterOf(page), pick: chapterOf(page) }, true);
    },
    state: () => ({
      ...shown.state(),
      reading: book.isOpen() ? book.reading() : null,
      held,
      slipFolded: slip.isFolded(),
    }),
    restore(state): void {
      shown.restore(state);
      resume = state.reading === null ? null : { reading: state.reading, held: state.held };
      slip.setFolded(state.slipFolded);
    },
    refresh(): void {
      const version = deps.answersVersion();
      if (version !== answersKey) {
        answersKey = version;
        shown.fold(deps.briefingHistory());
        book.rebuild();
      }
      const goals = deps.reader.goals();
      marks.observe(goals);
      book.refresh();
      slip.update(goals, marks, book.isOpen());
    },
    dropSlip: (depth) => slip.setDrop(depth),
    views: () => book.views(),
    unread: () => marks.unread,
    onDismiss: (listener) => {
      listeners.push(listener);
    },
    // A remount carries a held chapter over through the state, so the hold is not released here.
    dispose(): void {
      book.dispose();
      slip.dispose();
    },
  };
}
