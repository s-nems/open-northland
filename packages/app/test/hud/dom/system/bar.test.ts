// @vitest-environment jsdom
import type { HudModel } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { createHudSystemBar } from '../../../../src/hud/dom/system/bar.js';
import { formatSimClock } from '../../../../src/hud/summary/model.js';

afterEach(() => {
  document.body.replaceChildren();
});

/** A peace with one minute and five seconds left at tick 0. */
const PEACE_LEFT_SECONDS = 65;

const modelAt = (tick: number): HudModel => ({ tick, player: 0, population: 0, jobs: [], stocks: [] });

const barDeps = () => ({
  summary: { paintGood: () => {}, goodIdOf: () => undefined, goodLabel: (goodId: string) => goodId },
  onPauseToggle: () => {},
  onSpeed: () => {},
  onMenu: () => {},
});

describe('the system bar', () => {
  it('shows the peace as its time left in its own cell, named for assistive tech, gone once it ends', () => {
    const bar = createHudSystemBar(document.body, barDeps());
    const peace = document.querySelector<HTMLElement>('.on-peace');
    const endsAt = PEACE_LEFT_SECONDS * TICKS_PER_SECOND;

    bar.update(modelAt(0), endsAt);
    expect(peace?.hidden).toBe(false);
    expect(peace?.textContent).toBe('1:05');
    expect(peace?.querySelector('svg')).not.toBeNull();
    expect(peace?.getAttribute('aria-label')).toContain('1:05');
    expect(peace?.dataset.tip).not.toContain('1:05');

    bar.update(modelAt(endsAt), null);
    expect(peace?.hidden).toBe(true);
    bar.dispose();
  });

  it('reads a recording watch as current time over the recording end, its fill following the ticks', () => {
    // An hour's recording, watched halfway in.
    const untilTick = 60 * 60 * TICKS_PER_SECOND;
    const bar = createHudSystemBar(document.body, { ...barDeps(), replay: { untilTick } });
    const progress = document.querySelector<HTMLElement>('.on-replay-progress');
    const text = progress?.querySelector<HTMLElement>('.on-replay-progress__text');
    const fill = progress?.querySelector<HTMLElement>('.on-replay-progress__fill');
    expect(progress).not.toBeNull();

    const half = untilTick / 2;
    bar.update(modelAt(half), null);
    expect(text?.textContent).toBe(`${formatSimClock(half)} / ${formatSimClock(untilTick)}`);
    expect(fill?.style.width).toBe('50%');
    expect(progress?.getAttribute('aria-valuenow')).toBe(`${half}`);
    expect(progress?.getAttribute('aria-valuemax')).toBe(`${untilTick}`);

    // Past the recording's end the cell holds at its full length, never overfills.
    bar.update(modelAt(untilTick + 500), null);
    expect(fill?.style.width).toBe('100%');
    bar.dispose();
    expect(document.querySelector('.on-replay-progress')).toBeNull();
  });

  it('keeps no progress cell for a session that plays no recording', () => {
    const bar = createHudSystemBar(document.body, barDeps());
    bar.update(modelAt(60), null);
    expect(document.querySelector('.on-replay-progress')).toBeNull();
    bar.dispose();
  });
});
