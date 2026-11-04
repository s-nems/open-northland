// @vitest-environment jsdom
import type { HudModel } from '@open-northland/render';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYERS_SIGHT, switchableViewerSeat, type WatchTarget } from '../../../../src/game/viewer-seat.js';
import { createHudSystemBar } from '../../../../src/hud/dom/system/bar.js';
import type { SeatStanding } from '../../../../src/hud/summary/standings.js';
import { messages } from '../../../../src/i18n/index.js';

afterEach(() => {
  document.body.replaceChildren();
});

const HOME = 0;
const RIVAL = 1;

function standing(
  player: number,
  total: number,
  soldiers: number,
  status: SeatStanding['status'],
): SeatStanding {
  const people = {
    women: 0,
    men: total,
    soldiers,
    workers: total - soldiers,
    builders: 0,
    children: 0,
    girls: 0,
    boys: 0,
    total,
  };
  return { player, people, buildings: 0, status };
}

const modelAt = (tick: number, player: number | null): HudModel => ({
  tick,
  player,
  population: 0,
  jobs: [],
  stocks: [],
});

describe("the spectator's standings strip", () => {
  it('stands in for the counters while no single seat is watched, and a chip click watches its seat', () => {
    const viewer = switchableViewerSeat(PLAYERS_SIGHT);
    const watched: WatchTarget[] = [];
    let standings: readonly SeatStanding[] = [
      standing(HOME, 12, 3, 'playing'),
      standing(RIVAL, 0, 0, 'defeated'),
    ];
    const bar = createHudSystemBar(document.body, {
      observer: {
        seats: [{ player: HOME, name: 'Vikings' }, { player: RIVAL }],
        viewer,
        onWatch: (target) => {
          watched.push(target);
          viewer.watch(target);
        },
        standings: () => standings,
      },
      summary: { paintGood: () => {}, goodIdOf: () => undefined, goodLabel: (goodId) => goodId },
      onPauseToggle: () => {},
      onSpeed: () => {},
      onMenu: () => {},
    });
    const strip = document.querySelector<HTMLElement>('.on-standings');
    const summary = document.querySelector<HTMLElement>('.on-summary');
    const chips = [...document.querySelectorAll<HTMLButtonElement>('.on-standing')];

    bar.update(modelAt(0, null), null);
    expect(strip?.hidden).toBe(false);
    expect(summary?.hidden).toBe(true);
    expect(chips.map((chip) => chip.querySelector('.on-standing__figures')?.textContent)).toEqual([
      '123',
      '00',
    ]);
    expect(chips[0]?.getAttribute('aria-label')).toContain('Vikings');
    expect(chips[1]?.dataset.status).toBe('defeated');
    expect(chips[1]?.getAttribute('aria-label')).toContain(messages().hud.observer.status.defeated);

    chips[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector<HTMLElement>('.on-standings__tip');
    expect(tip?.hidden).toBe(false);
    expect(tip?.textContent).toContain('Vikings');
    standings = [standing(HOME, 14, 3, 'playing'), standing(RIVAL, 0, 0, 'defeated')];
    bar.update(modelAt(1, null), null);
    expect(tip?.querySelector('.on-tip__row--total b')?.textContent).toBe('14');

    chips[0]?.click();
    expect(watched).toEqual([HOME]);
    bar.update(modelAt(2, HOME), null);
    expect(strip?.hidden).toBe(true);
    expect(summary?.hidden).toBe(false);
    expect(tip?.hidden).toBe(true);
    bar.dispose();
  });
});
