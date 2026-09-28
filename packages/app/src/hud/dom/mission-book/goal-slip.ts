import type { UiCue } from '@open-northland/audio';
import type { MissionGoal } from '../../../game/mission-brief.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { TOP_BAR_HEIGHT } from '../../regions.js';
import { escapeHtml, setHidden } from '../parts/dom.js';
import { type GoalMarks, openGoalCount, slipRows } from './goal-marks.js';
import { goalMarkMarkup, goalTextMarkup } from './goal-markup.js';

/** Open goals the slip lists before it points to the book. */
const SLIP_OPEN_ROWS = 4;
/** The slip hangs from the top bar's lower edge, this far in from the screen's right edge. */
const SLIP_RIGHT_INSET = 14;
/** Room it keeps under the script's info lines when they stand under the bar. */
const INFO_LINES_GAP = 6;

const FOLD =
  '<svg viewBox="0 0 20 20" class="on-book__ico on-slip__fold"><path d="M5 12.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface GoalSlipDeps {
  readonly plane: HTMLElement;
  /** The key that opens the book, shown on its button; null when unbound. */
  readonly bookKey: () => string | null;
  readonly onOpenBook: () => void;
  readonly cue: (cue: UiCue) => void;
}

/**
 * The goal slip on the map: a vellum list of the open goals under the top bar that folds up into
 * its band tab. A goal change never unfolds it; the folded tab carries a seal until the book is read.
 */
export interface GoalSlip {
  /** Show the goals as they stand; nothing changes the markup unless the list, a mark or the fold did. */
  update(goals: readonly MissionGoal[], marks: GoalMarks, bookOpen: boolean): void;
  isFolded(): boolean;
  setFolded(folded: boolean): void;
  /** Hang the slip below the script's info lines, `depth` design px under the bar; 0 hangs it from the
   *  bar itself. */
  setDrop(depth: number): void;
  dispose(): void;
}

export function createGoalSlip(deps: GoalSlipDeps): GoalSlip {
  const copy = messages().hud.missionBook;
  const dock = document.createElement('div');
  dock.className = 'on-slip';
  dock.hidden = true;
  dock.style.right = `${SLIP_RIGHT_INSET}px`;
  deps.plane.append(dock);
  let drop = Number.NaN;
  let folded = false;
  let shownKey = '';
  /** What the slip was last updated with, so an unchanged frame reads nothing. */
  let seen: {
    goals: readonly MissionGoal[];
    version: number;
    bookOpen: boolean;
    folded: boolean;
    bookKey: string | null;
  } | null = null;

  const markup = (goals: readonly MissionGoal[], marks: GoalMarks): string => {
    const open = openGoalCount(goals);
    const tab = `<button type="button" class="on-slip__tab${folded ? '' : ' on-slip__tab--open'}" data-fold aria-expanded="${!folded}" aria-label="${escapeHtml(folded ? copy.slipOpen : copy.slipFold)}">
      <span class="on-slip__label">${escapeHtml(copy.slipTab)}</span><span class="on-tab__count">${open}</span>${
        folded && marks.unread
          ? `<i class="on-slip__seal" aria-label="${escapeHtml(copy.slipChanged)}"></i>`
          : ''
      }${FOLD}</button>`;
    if (folded) return tab;
    const { rows, more } = slipRows(goals, marks, SLIP_OPEN_ROWS);
    const items = rows
      .map(({ goal, mark }) => {
        const tag =
          mark === null ? '' : `<em>${escapeHtml(mark === 'new' ? copy.goalNew : copy.goalDone)}</em>`;
        return `<li class="on-slip__row${mark === null ? '' : ` on-slip__row--${mark}`}">${goalMarkMarkup(goal)}<span>${tag}${goalTextMarkup(goal)}</span></li>`;
      })
      .join('');
    const empty =
      rows.length === 0
        ? `<li class="on-slip__row on-slip__row--empty">${escapeHtml(copy.noneOpen)}</li>`
        : '';
    const key = deps.bookKey();
    const moreText = more > 0 ? escapeHtml(formatMessage(copy.slipMore, { count: more })) : '';
    return `<aside class="on-slip__sheet" aria-label="${escapeHtml(copy.slipLabel)}">
        <ul class="on-slip__list">${items}${empty}</ul>
        <button type="button" class="on-slip__book" data-book><span>${moreText}</span><span>${escapeHtml(copy.openBook)}${
          key === null ? '' : ` <kbd class="on-key">${escapeHtml(key)}</kbd>`
        }</span></button>
      </aside>${tab}`;
  };

  let lastMarks: GoalMarks | null = null;

  const paint = (goals: readonly MissionGoal[], marks: GoalMarks, bookOpen: boolean): void => {
    const hidden = bookOpen || goals.length === 0;
    setHidden(dock, hidden);
    if (hidden) return;
    const key = `${folded}|${marks.version}|${deps.bookKey()}|${goals.map((g) => `${g.key}:${g.state}:${g.text}`).join('\n')}`;
    if (key === shownKey) return;
    shownKey = key;
    dock.innerHTML = markup(goals, marks);
  };

  const update = (goals: readonly MissionGoal[], marks: GoalMarks, bookOpen: boolean): void => {
    lastMarks = marks;
    // The key is rebound live from the settings, without a remount.
    const bookKey = deps.bookKey();
    if (
      seen !== null &&
      seen.goals === goals &&
      seen.version === marks.version &&
      seen.bookOpen === bookOpen &&
      seen.folded === folded &&
      seen.bookKey === bookKey
    ) {
      return;
    }
    seen = { goals, version: marks.version, bookOpen, folded, bookKey };
    paint(goals, marks, bookOpen);
  };

  const repaint = (): void => {
    if (seen !== null && lastMarks !== null) update(seen.goals, lastMarks, seen.bookOpen);
  };

  dock.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    if (target.closest('[data-fold]') !== null) {
      deps.cue('confirm');
      folded = !folded;
      repaint();
    } else if (target.closest('[data-book]') !== null) {
      deps.cue('confirm');
      deps.onOpenBook();
    }
  });

  return {
    update,
    isFolded: () => folded,
    setDrop(depth): void {
      if (depth === drop) return;
      drop = depth;
      dock.style.top = `${TOP_BAR_HEIGHT + 1 + (depth > 0 ? depth + INFO_LINES_GAP : 0)}px`;
      dock.classList.toggle('on-slip--dropped', depth > 0);
    },
    setFolded(next): void {
      folded = next;
      repaint();
    },
    dispose: () => dock.remove(),
  };
}
