import { formatSimClock } from '../summary/model.js';
import { element } from './parts/dom.js';

/** The watch's progress cell in the system bar: the tick the playback stands at over the tick its
 *  recording ends on, as game time, under a fill that moves with the delivered ticks - not the
 *  requested speed. */
export interface ReplayProgress {
  /** The cell in the bar's row, between the clock and the speed segments. */
  readonly root: HTMLElement;
  /** Show the tick's share of the recording; the same tick twice costs nothing. */
  update(tick: number): void;
  dispose(): void;
}

export function createReplayProgress(untilTick: number): ReplayProgress {
  const total = Math.max(untilTick, 1);
  const root = element('span', 'on-replay-progress');
  root.setAttribute('role', 'progressbar');
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', `${total}`);
  const fill = element('span', 'on-replay-progress__fill');
  const text = element('span', 'on-replay-progress__text');
  root.append(fill, text);
  let shownText = '';
  const update = (tick: number): void => {
    const share = Math.min(1, Math.max(0, tick / total));
    fill.style.width = `${(share * 100).toFixed(1)}%`;
    const label = `${formatSimClock(tick)} / ${formatSimClock(untilTick)}`;
    if (label !== shownText) {
      shownText = label;
      text.textContent = label;
      root.setAttribute('aria-valuenow', `${Math.min(tick, total)}`);
    }
  };
  update(0);
  return { root, update, dispose: () => root.remove() };
}
