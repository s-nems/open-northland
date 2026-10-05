import { describe, expect, it } from 'vitest';
import type { UnitPanelModelContext } from '../src/hud/details-panel/model/context.js';
import { settlerStateHold, settlerStatus } from '../src/hud/details-panel/model/settler.js';
import { building, type Ent, settler, snapshotOf } from './support/snapshot.js';

/**
 * The status line's live state. It is a ladder over the settler's live components, and its two non-obvious
 * rungs are the wait and the alert: a settler posted to a building that is still going up stands at the
 * site on purpose, and a soldier holding its ground while a battle is on nearby takes no work and no rest
 * on purpose. Neither must read as the "idle" of a settler nobody gave work to.
 */

const BAKER = 5;
const BAKERY = 14;
const SETTLER = 1;
const WORKPLACE = 2;

/** The panel context a caption reads: only the battle-alert seam, which the sim answers. */
function ctxOf(standsTo?: (entity: number) => boolean): UnitPanelModelContext {
  return { ...(standsTo !== undefined ? { standsTo } : {}) } as UnitPanelModelContext;
}

/** The settler entity's component bag, posted to `workplace` and carrying `live` state on top. */
function comps(workplace: number | null, live: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...settler(SETTLER, BAKER, workplace).components, ...live };
}

function siteWorld(underConstruction: boolean): Ent[] {
  const b = building(WORKPLACE, BAKERY, 4, 4);
  return [{ ...b, components: { ...b.components, ...(underConstruction ? { UnderConstruction: {} } : {}) } }];
}

describe('the settler status caption', () => {
  it('reads "waiting for the building" for a settler posted to a site', () => {
    const snapshot = snapshotOf(siteWorld(true));
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, comps(WORKPLACE))).toBe('awaitingWorkplace');
  });

  it('reads "waiting for construction" for a settler sent to learn at a foundation', () => {
    const snapshot = snapshotOf(siteWorld(true));
    const sentAhead = comps(null, { TrainingOrder: { house: WORKPLACE, drillTicksLeft: 1 } });
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, sentAhead)).toBe('awaitingTraining');
  });

  it('reads idle for the same settler once its workplace stands', () => {
    const snapshot = snapshotOf(siteWorld(false));
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, comps(WORKPLACE))).toBe('idle');
  });

  it('reads idle for an unposted settler - nothing to wait for', () => {
    expect(settlerStatus(ctxOf(), snapshotOf(siteWorld(true)), SETTLER, comps(null))).toBe('idle');
  });

  it('keeps the live rungs above the wait: an order, an atomic and a walk all win', () => {
    const snapshot = snapshotOf(siteWorld(true));
    const status = (live: Record<string, unknown>): string =>
      settlerStatus(ctxOf(), snapshot, SETTLER, comps(WORKPLACE, live));
    expect(status({ PlayerOrder: {} })).toBe('ordered');
    expect(status({ CurrentAtomic: {} })).toBe('working');
    expect(status({ MoveGoal: {} })).toBe('walking');
  });

  it('names what the running atomic does: a need is not work, and a wait animation is idleness', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const status = (live: Record<string, unknown>): string =>
      settlerStatus(ctxOf(), snapshot, SETTLER, comps(null, live));
    const atomic = (kind: string): Record<string, unknown> => ({ CurrentAtomic: { effect: { kind } } });
    expect(status(atomic('eat'))).toBe('eating');
    expect(status(atomic('sleep'))).toBe('sleeping');
    expect(status(atomic('pray'))).toBe('praying');
    expect(status(atomic('construct'))).toBe('building');
    expect(status(atomic('repair'))).toBe('repairing');
    expect(status(atomic('attack'))).toBe('fighting');
    expect(status(atomic('harvest'))).toBe('working');
    expect(status(atomic('produce'))).toBe('working');
    expect(status(atomic('idle'))).toBe('idle');
    expect(status({ ...atomic('idle'), MoveGoal: {} })).toBe('walking');
  });

  it('reads talking while a chat holds the person, whatever animation it plays', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const talking = { Chat: { talking: true }, CurrentAtomic: { effect: { kind: 'idle' } } };
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, comps(null, talking))).toBe('talking');
    const seeking = { Chat: { talking: false }, MoveGoal: {} };
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, comps(null, seeking))).toBe('walking');
  });

  it('reads the meal break on the walk to food and while waiting, the meal itself as eating', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const status = (live: Record<string, unknown>): string =>
      settlerStatus(ctxOf(), snapshot, SETTLER, comps(null, { MealBreak: { hungry: true }, ...live }));
    expect(status({ MoveGoal: {} })).toBe('mealBreak');
    expect(status({})).toBe('mealBreak');
    expect(status({ CurrentAtomic: { effect: { kind: 'eat' } } })).toBe('eating');
  });

  it('reads "standing to" for the unit the sim says is holding its ground', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const asked: number[] = [];
    const standsTo = (entity: number): boolean => {
      asked.push(entity);
      return entity === SETTLER;
    };
    expect(settlerStatus(ctxOf(standsTo), snapshot, SETTLER, comps(null))).toBe('standingTo');
    expect(asked).toEqual([SETTLER]); // asked about the selected unit, and only it
  });

  it('keeps every live rung above the alert, and reads idle where the sim says nobody is fighting', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const holding = ctxOf(() => true);
    expect(settlerStatus(holding, snapshot, SETTLER, comps(null, { CurrentAtomic: {} }))).toBe('working');
    expect(
      settlerStatus(
        ctxOf(() => false),
        snapshot,
        SETTLER,
        comps(null),
      ),
    ).toBe('idle');
  });

  it('holds the last active state over the one tick a settler waits between two atomics', () => {
    const ctx = { holdSettlerState: settlerStateHold() } as UnitPanelModelContext;
    const world = siteWorld(false);
    const status = (tick: number, live: Record<string, unknown> = {}): string =>
      settlerStatus(ctx, snapshotOf(world, tick), SETTLER, comps(WORKPLACE, live));
    const stroke = { CurrentAtomic: { effect: { kind: 'construct' } } };
    expect(status(10, stroke)).toBe('building');
    expect(status(13)).toBe('building'); // the stroke ended this tick, the next one starts on the following
    expect(status(13)).toBe('building'); // a re-derive of the same snapshot
    expect(status(14, stroke)).toBe('building');
    expect(status(17)).toBe('building');
    expect(status(18)).toBe('idle'); // a later tick still idle: the builder has really stopped
    expect(status(19)).toBe('idle');
  });

  it('reads idle at once for a settler first seen idle, and forgets a held state with the selection', () => {
    const ctx = { holdSettlerState: settlerStateHold() } as UnitPanelModelContext;
    const world = siteWorld(false);
    const working = comps(WORKPLACE, { CurrentAtomic: { effect: { kind: 'construct' } } });
    expect(settlerStatus(ctx, snapshotOf(world, 5), SETTLER, comps(WORKPLACE))).toBe('idle');
    expect(settlerStatus(ctx, snapshotOf(world, 6), SETTLER, working)).toBe('building');
    expect(settlerStatus(ctx, snapshotOf(world, 7), SETTLER + 10, comps(null))).toBe('idle');
    expect(settlerStatus(ctx, snapshotOf(world, 8), SETTLER, comps(WORKPLACE))).toBe('idle');
  });
});
