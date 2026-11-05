// @vitest-environment jsdom
import type { HudModel } from '@open-northland/render';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAYERS_SIGHT, switchableViewerSeat, type WatchTarget } from '../../../../src/game/viewer-seat.js';
import { createHudSystemBar } from '../../../../src/hud/dom/system/bar.js';
import type { SeatArmy, SeatStanding } from '../../../../src/hud/summary/standings.js';
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

const NO_ARMY: SeatArmy = {
  soldiers: 0,
  weapons: [],
  unarmed: 0,
  armour: [],
  unarmoured: 0,
  carried: [],
  siege: [],
};
const HOME_ARMY: SeatArmy = {
  soldiers: 3,
  weapons: [{ goodId: 'sword_long', count: 3 }],
  unarmed: 0,
  armour: [{ goodId: 'armor_chain', count: 2 }],
  unarmoured: 1,
  carried: [{ goodId: 'potion_heal_big', count: 4 }],
  siege: [{ goodId: 'catapult', count: 2 }],
};

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
    const painted: string[] = [];
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
        army: (player) => (player === HOME ? HOME_ARMY : NO_ARMY),
      },
      summary: {
        paintGood: (_frame, goodId) => painted.push(goodId),
        goodIdOf: () => undefined,
        goodLabel: (goodId) => `label:${goodId}`,
      },
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

    painted.length = 0;
    chips[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector<HTMLElement>('.on-standings__tip');
    expect(tip?.hidden).toBe(false);
    expect(tip?.textContent).toContain('Vikings');
    const copy = messages().hud.observer;
    const [army, settlement] = [...(tip?.querySelectorAll<HTMLElement>('.on-standings__section') ?? [])];
    expect(army?.querySelector('.on-standings__heading')?.textContent).toBe(copy.army);
    expect(settlement?.querySelector('.on-standings__heading')?.textContent).toBe(copy.settlement);
    const shownRows = (section: HTMLElement | undefined): string[] =>
      [...(section?.querySelectorAll<HTMLElement>('.on-tip__row') ?? [])]
        .filter((row) => row.closest('[hidden]') === null)
        .map((row) => row.textContent ?? '');
    // Gear rows name their good and paint its icon; an armed army shows no "no weapon" row.
    expect(shownRows(army)).toEqual([
      `${copy.soldiers}3`,
      'label:catapult2',
      'label:sword_long3',
      'label:armor_chain2',
      `${copy.unarmoured}1`,
      'label:potion_heal_big4',
    ]);
    expect(painted).toEqual(['catapult', 'sword_long', 'armor_chain', 'potion_heal_big']);
    expect(shownRows(settlement)).toEqual([
      `${copy.workers}9`,
      `${messages().hud.summary.women}0`,
      `${messages().hud.summary.children}0`,
      `${copy.population}12`,
      `${copy.buildings}0`,
    ]);
    standings = [standing(HOME, 14, 3, 'playing'), standing(RIVAL, 0, 0, 'defeated')];
    bar.update(modelAt(1, null), null);
    expect(tip?.querySelector('.on-tip__row--total b')?.textContent).toBe('14');

    // A seat with no army shows its soldiers' count alone.
    chips[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(shownRows(army)).toEqual([`${copy.soldiers}0`]);

    chips[0]?.click();
    expect(watched).toEqual([HOME]);
    bar.update(modelAt(2, HOME), null);
    expect(strip?.hidden).toBe(true);
    expect(summary?.hidden).toBe(false);
    expect(tip?.hidden).toBe(true);
    bar.dispose();
  });
});
