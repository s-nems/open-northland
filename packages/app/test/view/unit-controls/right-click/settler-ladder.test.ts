import { MAX_UNIT_ORDER_MEMBERS, ONE, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_SCOUT, JOB_SOLDIER, JOB_TRADER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import type { RightClickHit } from '../../../../src/view/unit-controls/right-click/context.js';
import {
  type LadderContext,
  resolveSettlerRightClick,
  type SettlerPlan,
} from '../../../../src/view/unit-controls/right-click/settler-ladder.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/**
 * The settlers' right-click resolves to groups without issuing anything: the first rung that takes a
 * settler wins, and a partition rung hands the rest further down the ladder.
 */

const CONTENT = sandboxContent();
const SCOUT = 1;
const SOLDIER = 2;
const COLLECTOR = 3;
const TRADER = 4;
const ANIMAL = 50;
const ENEMY = 51;
const PREY = 52;
const PILE = 53;
const HOUSE = 54;
const RESOURCE = 55;
const TILE = { col: 6, row: 8 };
const GATHERED = ((): number => {
  const [good] = systems.jobGatherGoods({ content: CONTENT }, JOB_COLLECTOR);
  if (good === undefined) throw new Error('the sandbox collector gathers nothing');
  return good;
})();

const settler = (id: number, jobType: number): Ent => ({
  id,
  components: { Settler: { jobType }, Owner: { player: HUMAN_PLAYER }, Position: { x: ONE, y: ONE } },
});

const WORLD = snapshotOf([
  settler(SCOUT, JOB_SCOUT),
  settler(SOLDIER, JOB_SOLDIER),
  settler(COLLECTOR, JOB_COLLECTOR),
  settler(TRADER, JOB_TRADER),
]);

const unit = (ref: number) => ({ ref, x: 0, y: 0 });

const NOTHING: RightClickHit = {
  ownSettler: null,
  ownVehicle: null,
  ownBuilding: null,
  site: null,
  building: null,
  enemy: null,
  enemySettler: null,
  wildlife: null,
  claimableLivestock: null,
  creature: null,
  chest: null,
  pile: null,
  resource: null,
  tile: TILE,
};

const context = (asks: Partial<LadderContext['asks']> = {}): LadderContext => ({
  snapshot: WORLD,
  content: CONTENT,
  asks: { tradeHouse: false, equip: false, formation: false, ...asks },
});

function resolve(
  units: readonly number[],
  hit: Partial<RightClickHit>,
  {
    queued = false,
    usesHeap = false,
    asks = {},
  }: { queued?: boolean; usesHeap?: boolean; asks?: Partial<LadderContext['asks']> } = {},
): SettlerPlan {
  const mods = { queued, usesHeap };
  return resolveSettlerRightClick(context(asks), units.map(unit), { ...NOTHING, ...hit }, mods, null);
}

/** Each group as `[intent kind, its units]`, the shape the click issues in order. */
function groupsOf(plan: SettlerPlan): [string, number[]][] {
  if (plan.kind !== 'orders') throw new Error(`no orders: ${plan.kind}`);
  return plan.groups.map((group) => [group.intent.kind, group.units.map((u) => u.ref)]);
}

describe('the settlers right-click ladder', () => {
  it('selects an own settler under the cursor, and leaves an empty or oversized selection unordered', () => {
    expect(resolve([SOLDIER], { ownSettler: SCOUT })).toEqual({ kind: 'select', settler: SCOUT });
    expect(resolve([], {})).toEqual({ kind: 'none' });
    const tooMany = Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => i + RESOURCE + 1);
    expect(resolve(tooMany, {}).kind).toBe('orderLimit');
  });

  it('sends the scouts after a claimable animal and the rest at the enemy, or under the claimed one', () => {
    expect(groupsOf(resolve([SCOUT, SOLDIER], { claimableLivestock: ANIMAL, enemy: ENEMY }))).toEqual([
      ['claimAnimal', [SCOUT]],
      ['attack', [SOLDIER]],
    ]);
    // An enemy's animal the scouts claim is struck by nobody: the others walk there.
    expect(groupsOf(resolve([SCOUT, SOLDIER], { claimableLivestock: ANIMAL, enemy: ANIMAL }))).toEqual([
      ['claimAnimal', [SCOUT]],
      ['walk', [SOLDIER]],
    ]);
  });

  it('hunts with the fighters alone and switches gatherers to the resource, the rest walking on', () => {
    expect(groupsOf(resolve([SOLDIER, COLLECTOR], { wildlife: PREY }))).toEqual([
      ['hunt', [SOLDIER]],
      ['walk', [COLLECTOR]],
    ]);
    const resource = { ref: RESOURCE, goodType: GATHERED };
    expect(groupsOf(resolve([SOLDIER, COLLECTOR], { resource }))).toEqual([
      ['gather', [COLLECTOR]],
      ['walk', [SOLDIER]],
    ]);
    // A gathered good is a standing setting: with Shift everyone walks there queued.
    expect(groupsOf(resolve([SOLDIER, COLLECTOR], { resource }, { queued: true }))).toEqual([
      ['walk', [SOLDIER, COLLECTOR]],
    ]);
  });

  it('marks the orders that wait on a host answer', () => {
    const boots = CONTENT.goods.find((good) => good.equip?.category === 'boots');
    if (boots === undefined) throw new Error('sandbox content has no boots');
    const equip = resolve(
      [SOLDIER],
      { pile: { ref: PILE, goodType: boots.typeId, amount: 1 } },
      { usesHeap: true, asks: { equip: true } },
    );
    expect(equip).toMatchObject({
      kind: 'orders',
      groups: [{ intent: { kind: 'equip', candidates: [SOLDIER] }, pending: 'equip' }],
    });
    // Without the heap modifier, or without the pick list, the heap is ground.
    const heap = { pile: { ref: PILE, goodType: boots.typeId, amount: 1 } };
    expect(groupsOf(resolve([SOLDIER], heap, { asks: { equip: true } }))).toEqual([['walk', [SOLDIER]]]);
    expect(groupsOf(resolve([SOLDIER], heap, { usesHeap: true }))).toEqual([['walk', [SOLDIER]]]);

    const trade = resolve(
      [TRADER, SOLDIER],
      { building: HOUSE },
      { asks: { tradeHouse: true, formation: true } },
    );
    expect(trade).toMatchObject({
      kind: 'orders',
      groups: [
        { intent: { kind: 'tradeHouse', house: HOUSE, detach: [], ask: [TRADER] }, pending: 'tradeAttach' },
        { intent: { kind: 'walk', tile: TILE }, pending: 'formation' },
      ],
    });
    // Without the trade-stop rule a trader puts no house on its route, and a Shift click never does.
    expect(groupsOf(resolve([TRADER], { building: HOUSE }))).toEqual([['walk', [TRADER]]]);
    expect(
      groupsOf(resolve([TRADER], { building: HOUSE }, { queued: true, asks: { tradeHouse: true } })),
    ).toEqual([['walk', [TRADER]]]);
  });
});
