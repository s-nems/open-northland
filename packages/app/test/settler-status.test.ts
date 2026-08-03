import { describe, expect, it } from 'vitest';
import { settlerStatus } from '../src/hud/details-panel/model/settler.js';
import { messages } from '../src/i18n/index.js';
import { building, type Ent, settler, snapshotOf } from './support/snapshot.js';

/**
 * The portrait's status caption. It is a ladder over the settler's live components, and its one non-obvious
 * rung is the wait: a settler posted to a building that is still going up stands at the site on purpose,
 * which must not read as the "bezczynny" of a settler nobody gave work to.
 */

const BAKER = 5;
const BAKERY = 14;
const SETTLER = 1;
const WORKPLACE = 2;

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
    expect(settlerStatus(snapshot, comps(WORKPLACE))).toBe(hud.awaitingWorkplace);
  });

  it('reads idle for the same settler once its workplace stands', () => {
    const snapshot = snapshotOf(siteWorld(false));
    expect(settlerStatus(snapshot, comps(WORKPLACE))).toBe(hud.idle);
  });

  it('reads idle for an unposted settler - nothing to wait for', () => {
    expect(settlerStatus(snapshotOf(siteWorld(true)), comps(null))).toBe(hud.idle);
  });

  it('keeps the live rungs above the wait: an order, an atomic and a walk all win', () => {
    const snapshot = snapshotOf(siteWorld(true));
    expect(settlerStatus(snapshot, comps(WORKPLACE, { PlayerOrder: {} }))).toBe(hud.ordered);
    expect(settlerStatus(snapshot, comps(WORKPLACE, { CurrentAtomic: {} }))).toBe(hud.working);
    expect(settlerStatus(snapshot, comps(WORKPLACE, { MoveGoal: {} }))).toBe(hud.walking);
  });
});
