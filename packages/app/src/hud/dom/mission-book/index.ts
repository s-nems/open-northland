import type { UiCue } from '@open-northland/audio';
import { callbackVoice, type HypertextBook } from '@open-northland/data';
import type { MapViewTarget } from '@open-northland/render';
import type { MissionInfoRow } from '../../../game/info-lines.js';
import type { MissionBriefingAnswer, MissionReader } from '../../../game/mission-brief.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import {
  type BookReading,
  type BookView,
  type BookWindow,
  type BookWindowDeps,
  createBookWindow,
  type ShownCallback,
} from './book-window.js';
import { type BriefingViewTarget, callbackView } from './callbacks.js';
import { GoalMarks, type GoalMarksState } from './goal-marks.js';
import { createGoalSlip, type GoalSlip, type GoalSlipDeps } from './goal-slip.js';
import { ShownPages, type ShownPagesState } from './shown-pages.js';
import type { MissionHumanLookup } from './user-icons.js';
import type { BriefingVoicePlayer } from './voice-row.js';

export type { BookView } from './book-window.js';
export type { BriefingViewTarget } from './callbacks.js';
export type { MissionHumanLookup } from './user-icons.js';
export type { BriefingVoicePlayer, BriefingVoiceState } from './voice-row.js';

/** The chapters shown so far, where an open book's reader stands and the slip's fold, carried across
 *  a remount. */
export interface MissionWindowState extends ShownPagesState {
  readonly reading: BookReading | null;
  /** The open book shows a chapter a script delivered. */
  readonly arrival: boolean;
  readonly slipFolded: boolean;
  /** Unread goal changes, so the seals survive a remount. */
  readonly goalMarks: GoalMarksState;
  /** A briefing callback has centred the main view since the book opened. */
  readonly viewCentred: boolean;
}

/** What a world without a mission reader shows: the book's empty page and no goals. */
export const NO_MISSION: MissionReader = {
  page: () => ({ title: '', blocks: [], lang: null }),
  goals: () => [],
  missionName: '',
};

export interface MissionBookDeps {
  readonly plane: HTMLElement;
  readonly reader: MissionReader;
  /** The briefing pages the sim has delivered, oldest first. */
  readonly briefingHistory: () => readonly number[];
  /** The briefing as of now: the beam opens on its replayable page, or the last shown before any. */
  readonly askBriefing: () => Promise<MissionBriefingAnswer>;
  /** The history tables the chronicle opens; null leaves them out. */
  readonly history: HypertextBook | null;
  readonly missionHuman: MissionHumanLookup;
  /** Bumped when the briefing history, the replay page or a mission human lands anew. */
  readonly answersVersion: () => number;
  readonly pictureUrl: (file: string) => string;
  /** Whether a held pause stops the clock; a shared clock is nobody's to hold. */
  readonly pauseStopsClock: boolean;
  /** The open book holds the game, as the original stops game time behind its large windows. */
  readonly onHold: (held: boolean) => void;
  readonly onShowOnMap: (target: MapViewTarget) => void;
  /** A briefing callback centres the main view; the book stays open. */
  readonly onCentreView: (target: BriefingViewTarget) => void;
  /** The slip's "open the book" was pressed; the owner opens it as the beam entry does (one central
   *  window, a held placement dropped) through {@link MissionBook.openGoals}. */
  readonly onSlipOpen: () => void;
  /** The key that toggles the book, for the slip's button; null when unbound. */
  readonly bookKey: () => string | null;
  readonly cue: (cue: UiCue) => void;
  /** Speaks a briefing page's narration; absent, the book is silent. */
  readonly voice?: BriefingVoicePlayer;
}

/** The mission book (briefing chapters, goals, chronicle) and the goal slip on the map. The plane
 *  routes their pointer input itself, so the book claims no canvas point. */
export interface MissionBook extends ToolWindow {
  /** Open on briefing `page`, a script's `PlayCutscene`, which joins the chapters. */
  showPage(page: number): void;
  /** Open on the goal page. */
  openGoals(): void;
  state(): MissionWindowState;
  restore(state: MissionWindowState): void;
  /** Once a frame: follow the goals, the slip and the screen. */
  refresh(): void;
  /** Live script messages and goal counters for the watched seat. */
  setInfoLines(rows: readonly MissionInfoRow[]): void;
  /** The world views the open book shows, for the renderer to paint under its holes. */
  views(): readonly BookView[];
  /** A goal changed since the goal page last showed, which the beam and the folded slip mark. */
  unread(): boolean;
  /** The close medallion closed the book; the owner returns focus. */
  onDismiss(listener: () => void): void;
  dispose(): void;
}

const FIRST: BookReading = { tab: 'brief', chapter: 0, spread: 0, table: null, pick: 0 };

/** How the book opens: `delivered` while it shows a page a script played, `resumed` when it reopens
 *  after a remount closed it, which is the same opening. */
interface MissionOpening {
  readonly delivered: boolean;
  readonly resumed?: boolean;
}

/** The book's two DOM parts; a test hands in stubs to drive the book's state without a document. */
export interface MissionBookParts {
  readonly book: (deps: BookWindowDeps) => BookWindow;
  readonly slip: (deps: GoalSlipDeps) => GoalSlip;
}

const DOM_PARTS: MissionBookParts = { book: createBookWindow, slip: createGoalSlip };

export function createMissionBook(deps: MissionBookDeps, parts: MissionBookParts = DOM_PARTS): MissionBook {
  const shown = new ShownPages();
  const marks = new GoalMarks();
  const listeners: (() => void)[] = [];
  let infoRows: readonly MissionInfoRow[] = [];
  let infoKey = '';
  let lastInfoInput: readonly MissionInfoRow[] | null = null;
  let held = false;
  let arrival = false;
  /** The original's one-shot flag: one callback centres the view per opening of the window, a page
   *  delivered to the open window included; one that finds nobody stamped spends it too. */
  let viewCentred = false;
  /** The spread whose narration was started, so a relayout of the same spread does not restart it. */
  let spokenSpread: string | null = null;
  /** A restored reading the next opening resumes, and whether a script delivered it. */
  let resume: { readonly reading: BookReading; readonly arrival: boolean } | null = null;
  let answersKey = deps.answersVersion();
  /** Counts openings and closes, so a beam opening still waiting for its answer yields to them. */
  let openings = 0;

  const chapters = (): readonly (number | null)[] => shown.list;
  const chapterOf = (page: number | null): number => {
    const at = page === null ? -1 : shown.list.indexOf(page);
    return at < 0 ? Math.max(0, shown.list.length - 1) : at;
  };

  const hold = (): void => {
    if (held) return;
    held = true;
    deps.onHold(true);
  };
  const release = (): void => {
    if (!held) return;
    held = false;
    deps.onHold(false);
  };

  /** The 2000 callback speaks once per spread shown; any other spread, tab or callback silences it. */
  const speak = (shown: ShownCallback | null): void => {
    const spread = shown?.spread ?? null;
    if (spread === spokenSpread) return;
    spokenSpread = spread;
    const voice = shown === null ? null : callbackVoice(shown.lang, shown.args);
    if (voice === null) deps.voice?.stop();
    else deps.voice?.play(voice);
  };
  const silence = (): void => {
    spokenSpread = null;
    deps.voice?.stop();
  };

  const close = (): void => {
    openings++;
    if (!book.isOpen()) return;
    silence();
    book.close();
    arrival = false;
    release();
  };

  const book = parts.book({
    plane: deps.plane,
    chapters,
    page: (page) => deps.reader.page(page),
    goals: () => deps.reader.goals(),
    infoRows: () => infoRows,
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
    onCallback: (shown) => {
      speak(shown);
      if (shown === null) return;
      const target = callbackView(shown.args);
      if (target === null || viewCentred) return;
      viewCentred = true;
      deps.onCentreView(target);
    },
    onDismiss: () => {
      close();
      for (const listener of listeners) listener();
    },
    cue: deps.cue,
    voice: deps.voice ?? null,
  });

  const open = (reading: BookReading, { delivered, resumed = false }: MissionOpening): void => {
    openings++;
    if (!book.isOpen() && !resumed) viewCentred = false;
    marks.observe(deps.reader.goals());
    arrival = delivered;
    hold();
    book.open({ reading, arrival, paused: arrival && deps.pauseStopsClock });
  };

  /** From the beam the book opens on the start of the map's replayable chapter (reading); a map whose
   *  pages all came without the replay flag opens on the last one shown (approximation). The click
   *  waits for the briefing as of now, since a held answer can be from the previous opening. */
  const openFromBeam = (): void => {
    const resumed = resume;
    resume = null;
    if (resumed !== null) {
      shown.fold(deps.briefingHistory());
      open(resumed.reading, { delivered: resumed.arrival, resumed: true });
      return;
    }
    const asked = openings;
    void deps
      .askBriefing()
      .catch(() => ({ history: deps.briefingHistory(), page: null }))
      .then(({ history, page }) => {
        if (asked !== openings) return;
        shown.fold(history);
        open({ ...FIRST, chapter: chapterOf(page ?? shown.page) }, { delivered: false });
      });
  };

  const slip = parts.slip({
    plane: deps.plane,
    bookKey: deps.bookKey,
    onOpenBook: deps.onSlipOpen,
    cue: deps.cue,
  });

  return {
    isOpen: () => book.isOpen(),
    toggle: () => (book.isOpen() ? close() : openFromBeam()),
    close,
    claims: () => false,
    handleClick: () => false,
    showPage(page): void {
      resume = null;
      // A delivered page speaks anew, even where its chapter and spread are the ones already shown.
      spokenSpread = null;
      shown.fold(deps.briefingHistory());
      shown.show(page);
      open({ ...FIRST, chapter: chapterOf(page), pick: chapterOf(page) }, { delivered: true });
    },
    openGoals(): void {
      shown.fold(deps.briefingHistory());
      resume = null;
      open({ ...FIRST, tab: 'goals', chapter: chapterOf(shown.page) }, { delivered: arrival });
    },
    state: () => ({
      ...shown.state(),
      reading: book.isOpen() ? book.reading() : null,
      arrival,
      slipFolded: slip.isFolded(),
      goalMarks: marks.state(),
      viewCentred,
    }),
    restore(state): void {
      shown.restore(state);
      resume = state.reading === null ? null : { reading: state.reading, arrival: state.arrival };
      slip.setFolded(state.slipFolded);
      marks.restore(state.goalMarks);
      viewCentred = state.viewCentred;
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
      slip.update(goals, marks, book.isOpen(), infoRows);
    },
    setInfoLines(rows): void {
      if (rows === lastInfoInput) return;
      lastInfoInput = rows;
      const key = JSON.stringify(rows);
      if (key === infoKey) return;
      infoRows = rows;
      infoKey = key;
    },
    views: () => book.views(),
    unread: () => marks.unread,
    onDismiss: (listener) => {
      listeners.push(listener);
    },
    // A remount reopens an open book from the state, so the hold is not released here.
    dispose(): void {
      openings++;
      silence();
      book.dispose();
      slip.dispose();
    },
  };
}
