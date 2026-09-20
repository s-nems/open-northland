import { describe, expect, it } from 'vitest';
import type { UnitPanelModelContext } from '../src/hud/details-panel/model/context.js';
import { settlerStatus } from '../src/hud/details-panel/model/settler.js';
import { messages } from '../src/i18n/index.js';
import { building, type Ent, settler, snapshotOf } from './support/snapshot.js';

/**
 * The portrait's status caption. It is a ladder over the settler's live components, and its two non-obvious
 * rungs are the wait and the alert: a settler posted to a building that is still going up stands at the
 * site on purpose, and a soldier holding its ground while a battle is on nearby takes no work and no rest
 * on purpose. Neither must read as the "bezczynny" of a settler nobody gave work to.
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
  const hud = messages().hud.statuses;

  it('reads "waiting for the building" for a settler posted to a site', () => {
    const snapshot = snapshotOf(siteWorld(true));
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, comps(WORKPLACE))).toBe(hud.awaitingWorkplace);
  });

  it('reads idle for the same settler once its workplace stands', () => {
    const snapshot = snapshotOf(siteWorld(false));
    expect(settlerStatus(ctxOf(), snapshot, SETTLER, comps(WORKPLACE))).toBe(hud.idle);
  });

  it('reads idle for an unposted settler - nothing to wait for', () => {
    expect(settlerStatus(ctxOf(), snapshotOf(siteWorld(true)), SETTLER, comps(null))).toBe(hud.idle);
  });

  it('keeps the live rungs above the wait: an order, an atomic and a walk all win', () => {
    const snapshot = snapshotOf(siteWorld(true));
    const status = (live: Record<string, unknown>): string =>
      settlerStatus(ctxOf(), snapshot, SETTLER, comps(WORKPLACE, live));
    expect(status({ PlayerOrder: {} })).toBe(hud.ordered);
    expect(status({ CurrentAtomic: {} })).toBe(hud.working);
    expect(status({ MoveGoal: {} })).toBe(hud.walking);
  });

  it('reads "standing to" for the unit the sim says is holding its ground', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const asked: number[] = [];
    const standsTo = (entity: number): boolean => {
      asked.push(entity);
      return entity === SETTLER;
    };
    expect(settlerStatus(ctxOf(standsTo), snapshot, SETTLER, comps(null))).toBe(hud.standingTo);
    expect(asked).toEqual([SETTLER]); // asked about the selected unit, and only it
  });

  it('keeps every live rung above the alert, and reads idle where the sim says nobody is fighting', () => {
    const snapshot = snapshotOf(siteWorld(false));
    const holding = ctxOf(() => true);
    expect(settlerStatus(holding, snapshot, SETTLER, comps(null, { CurrentAtomic: {} }))).toBe(hud.working);
    expect(
      settlerStatus(
        ctxOf(() => false),
        snapshot,
        SETTLER,
        comps(null),
      ),
    ).toBe(hud.idle);
  });
});
