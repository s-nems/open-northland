import type { MissionGoal } from '../../../game/mission-brief.js';
import { messages } from '../../../i18n/index.js';
import { escapeHtml } from '../parts/dom.js';
import { type GoalMark, goalLists, openGoalCount } from './goal-marks.js';
import { FLOURISH } from './markup.js';

const CHECK =
  '<svg viewBox="0 0 20 20" class="on-book__ico"><path d="M4.5 10.5l3.6 3.4 7.4-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The goal's mark: an open box, a green seal once done, nothing while it is not active yet. */
export function goalMarkMarkup(goal: MissionGoal): string {
  const copy = messages().hud.missionBook;
  if (goal.state === 'done')
    return `<span class="on-book__seal" aria-label="${escapeHtml(copy.goalDone)}">${CHECK}</span>`;
  if (goal.state === 'open')
    return `<span class="on-book__box" aria-label="${escapeHtml(copy.goalOpenLabel)}"></span>`;
  return `<span class="on-book__nobox" aria-label="${escapeHtml(copy.goalIdleLabel)}"></span>`;
}

export function goalTextMarkup(goal: MissionGoal): string {
  return `<span class="on-book__goal-text${goal.emphasis ? ' on-book__goal-text--emphasis' : ''}">${escapeHtml(goal.text)}</span>`;
}

/** The goal page: what is to do on the left page, what is done on the right, each goal the page has
 *  shown changed tagged with its change. */
export function goalsSpread(
  goals: readonly MissionGoal[],
  marks: ReadonlyMap<string, GoalMark>,
  missionName: string,
): string {
  const copy = messages().hud.missionBook;
  const row = (goal: MissionGoal): string => {
    const mark = marks.get(goal.key);
    const tag =
      mark === undefined
        ? ''
        : `<em class="on-book__goal-tag on-book__goal-tag--${mark}">${escapeHtml(mark === 'new' ? copy.goalNew : copy.goalDone)}</em>`;
    return `<li class="on-book__goal on-book__goal--${goal.state}">${goalMarkMarkup(goal)}<span>${tag}${goalTextMarkup(goal)}</span></li>`;
  };
  const list = (rows: readonly MissionGoal[], empty: string | null): string => {
    const items = rows.map(row).join('');
    const none = items === '' && empty !== null ? `<li class="on-book__empty">${escapeHtml(empty)}</li>` : '';
    return `<ul class="on-book__goals">${items}${none}</ul>`;
  };
  const { current, done } = goalLists(goals);
  const name = missionName === '' ? '' : `<small> · ${escapeHtml(missionName)}</small>`;
  return `<div class="on-book__page on-book__page--left"><div class="on-book__sheet">
      <p class="on-book__kicker">${escapeHtml(copy.goalsKicker)}${name}</p>
      <h3 class="on-book__title">${escapeHtml(copy.goalsTitle)}</h3>${FLOURISH}
      <p class="on-book__list-head">${escapeHtml(copy.current)} · ${openGoalCount(goals)}</p>${list(current, copy.noneOpen)}
    </div><p class="on-book__folio">${escapeHtml(copy.tabs.goals)}</p></div>
    <div class="on-book__page on-book__page--right"><div class="on-book__sheet">
      <p class="on-book__list-head">${escapeHtml(copy.done)} · ${done.length}</p>${list(done, null)}
    </div><p class="on-book__folio">${escapeHtml(copy.tabs.goals)}</p></div>`;
}
