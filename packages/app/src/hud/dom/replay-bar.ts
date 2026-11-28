import { formatSimClock } from '../summary/model.js';
import { element } from './parts/dom.js';

/** The watch mode's progress bar: the tick the playback stands at over the tick its recording ends
 *  on, top-left where it never meets the system bar. It reads the tick off the mirror per frame, so
 *  it moves with the delivered ticks, not the requested speed. */
export interface ReplayBar {
  update(tick: number): void;
  dispose(): void;
}

export function mountReplayBar(plane: HTMLElement, deps: { readonly untilTick: number }): ReplayBar {
  const bar = element('div', 'on-replay-bar');
  const fill = element('div', 'on-replay-bar__fill');
  const text = element('span', 'on-replay-bar__text');
  bar.append(fill, text);
  Object.assign(bar.style, { position: 'absolute', top: '6px', left: '6px' });
  const shown = (tick: number): string => `${formatSimClock(tick)} / ${formatSimClock(deps.untilTick)}`;
  const update = (tick: number): void => {
    const total = Math.max(deps.untilTick, 1);
    fill.style.width = `${Math.min(100, Math.max(0, (tick / total) * 100))}%`;
    text.textContent = shown(tick);
  };
  update(0);
  plane.append(bar);
  return { update, dispose: () => bar.remove() };
}
