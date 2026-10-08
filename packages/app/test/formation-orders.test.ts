import { halfCellToScreen } from '@open-northland/render';
import {
  type Entity,
  type FormationSlotGroup,
  fx,
  type HalfCellNode,
  type PlayerCommand,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { createAnsweredOrders } from '../src/view/unit-controls/answered-orders.js';
import { createOrderFeedback } from '../src/view/unit-controls/order-feedback.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import { createOverviewOrders } from '../src/view/unit-controls/overview-orders.js';
import { createPendingGroundOrders } from '../src/view/unit-controls/pending-ground-orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';
import { snapshotOf } from './support/snapshot.js';

function harness(count = 4, refuse?: (movers: readonly number[]) => void) {
  const units = Array.from({ length: count }, (_, i) => ({
    ref: i + 1,
    ...halfCellToScreen(2 + (i % 40), 2 + Math.floor(i / 40) * 2),
  }));
  const issued: PlayerCommand[] = [];
  const marks: unknown[] = [];
  const cues: string[] = [];
  const feedback = createOrderFeedback((cue) => cues.push(cue));
  const pending = createPendingGroundOrders();
  const asks: {
    target: HalfCellNode;
    ids: readonly Entity[];
    spacing: 1 | 2;
    resolve: (groups: readonly FormationSlotGroup[] | null) => void;
    reject: () => void;
  }[] = [];
  const targets: UnitTargets = {
    owned: () => [],
    buildings: () => [],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [],
    claimableLivestock: () => [],
    enemies: () => [],
    ownedSettlersIn: (ids) => units.filter(({ ref }) => ids.has(ref)),
  };
  const submit = (command: PlayerCommand) => pending.submit(command, (order) => issued.push(order));
  const orders = createUnitOrderController({
    answered: createAnsweredOrders(),
    pendingGroundOrders: pending,
    requestFormationSlots: (target, ids, spacing) =>
      new Promise((resolve, reject) => {
        asks.push({ target, ids, spacing, resolve, reject: () => reject(new Error('query unavailable')) });
      }),
    deferGroundConfirmation: feedback.deferGroundConfirmation,
    cue: feedback.cue,
    snapshot: () =>
      snapshotOf(
        units.map(({ ref }) => ({
          id: ref,
          components: { Settler: { jobType: 31 }, Position: { x: fx.fromInt(1), y: fx.fromInt(1) } },
        })),
      ),
    targets,
    content: sandboxContent(),
    selected: () => new Set(units.map(({ ref }) => ref)),
    mapSize: { width: 128, height: 128 },
    toWorld: (x, y) => ({ x, y }),
    enqueue: submit,
    selectOwnSettler: () => {},
    openActions: () => {},
    markOrder: (node) => marks.push(node),
    refuse,
  });
  const answer = (index: number) => {
    const ask = asks[index];
    if (ask === undefined) throw new Error('missing query');
    ask.resolve([
      {
        members: ask.ids,
        slots: ask.ids.map((_, i) => ({
          hx: ask.target.hx + (i % 40),
          hy: ask.target.hy + Math.floor(i / 40) * 2,
        })),
      },
    ]);
  };
  const overview = createOverviewOrders({
    orders: () => orders,
    pickMode: { handleOverviewPress: () => null },
    workFlagBinding: () => null,
    cue: feedback.cue,
  });
  const press = (target: { col: number; row: number }) => {
    const at = halfCellToScreen(target.col, target.row);
    return overview(at.x, at.y, { button: 2, shiftKey: false } as MouseEvent);
  };
  return { orders, issued, asks, marks, cues, submit, answer, pending, feedback, press };
}

const A = { col: 100, row: 60 },
  B = { col: 130, row: 80 };
function members(command: PlayerCommand | undefined): readonly number[] {
  if (command === undefined || !('members' in command)) throw new Error('expected group');
  return command.members.map(({ entity }) => entity);
}

describe('fresh ground order answers', () => {
  it('submits one whole 1000-member formation only after its fresh answer, then marks and confirms', async () => {
    const h = harness(1000);
    expect(h.orders.issueAttackMove(A)).toBe(true);
    h.feedback.cue('confirm');
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0]?.spacing).toBe(2);
    expect(h.asks[0]?.ids).toHaveLength(1000);
    expect(h.issued).toEqual([]);
    expect(h.marks).toEqual([]);
    expect(h.cues).toEqual([]);
    h.answer(0);
    await Promise.resolve();
    expect(h.issued).toHaveLength(1);
    expect(h.issued[0]?.kind).toBe('attackMoveUnitGroup');
    expect(members(h.issued[0])).toHaveLength(1000);
    expect(h.marks).toEqual([A]);
    expect(h.cues).toEqual(['confirm']);
  });

  it('preserves 990 old actors when a faster new answer redirects only 10', async () => {
    const h = harness(1000);
    h.orders.issueMoveTo(A);
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    h.orders.issueAttackMove(B, ten);
    h.answer(1);
    await Promise.resolve();
    expect(members(h.issued[0])).toEqual(ten);
    h.answer(0);
    await Promise.resolve();
    expect(h.issued).toHaveLength(2);
    expect(members(h.issued[1])).toHaveLength(990);
    expect(members(h.issued[1]).every((id) => id > 10)).toBe(true);
  });

  it('drops an obsolete earlier answer and preserves Shift answers in click order', async () => {
    const h = harness();
    h.orders.issueMoveTo(A);
    h.orders.issueMoveTo(B);
    h.answer(1);
    await Promise.resolve();
    h.answer(0);
    await Promise.resolve();
    expect(h.issued).toHaveLength(1);
    expect(h.marks).toEqual([B]);
    h.orders.issueMoveTo(A);
    h.orders.issueAttackMove(B, undefined, true);
    h.answer(3);
    await Promise.resolve();
    expect(h.issued).toHaveLength(1);
    h.answer(2);
    await Promise.resolve();
    expect(h.issued.map((command) => command.kind)).toEqual([
      'moveUnitGroup',
      'moveUnitGroup',
      'attackMoveUnitGroup',
    ]);
    expect(h.issued[2]).toMatchObject({ queued: true });
    expect(h.marks).toEqual([B, A, B]);
  });

  it('does not override a newer immediate attack of a partial selection', async () => {
    const h = harness();
    h.orders.issueMoveTo(A);
    const target = 5000 as Entity;
    h.submit({ kind: 'attackUnitGroup', members: [{ entity: 1 as Entity }], target });
    h.answer(0);
    await Promise.resolve();
    expect(h.issued[0]?.kind).toBe('attackUnitGroup');
    expect(members(h.issued[1])).toEqual([2, 3, 4]);
  });

  it('pairs independently within each land component', async () => {
    const h = harness();
    h.orders.issueMoveTo(A);
    h.asks[0]?.resolve([
      {
        members: [1 as Entity, 3 as Entity],
        slots: [
          { hx: 110, hy: 10 },
          { hx: 111, hy: 10 },
        ],
      },
      {
        members: [2 as Entity, 4 as Entity],
        slots: [
          { hx: 10, hy: 10 },
          { hx: 11, hy: 10 },
        ],
      },
    ]);
    await Promise.resolve();
    const command = h.issued[0];
    if (command?.kind !== 'moveUnitGroup') throw new Error('missing movement');
    for (const { entity, x } of command.members) expect(x >= 100).toBe(entity % 2 === 1);
  });

  it('fails without a success marker on zero slots or rejection, releasing a waiting Shift', async () => {
    const h = harness();
    h.orders.issueMoveTo(A);
    h.asks[0]?.resolve([]);
    await Promise.resolve();
    expect(h.issued).toEqual([]);
    expect(h.marks).toEqual([]);
    expect(h.cues).toEqual(['fail']);
    h.orders.issueMoveTo(A);
    h.orders.issueMoveTo(B, undefined, true);
    h.feedback.cue('confirm');
    h.answer(2);
    h.asks[1]?.reject();
    await Promise.resolve();
    expect(h.issued).toHaveLength(1);
    expect(h.marks).toEqual([B]);
    expect(h.cues).toEqual(['fail', 'fail', 'confirm']);
  });

  it('hands a walk none of its movers can take to the refusal voice instead of the fail click', async () => {
    const refused: (readonly number[])[] = [];
    const h = harness(4, (movers) => refused.push(movers));
    h.orders.issueMoveTo(A);
    h.asks[0]?.resolve([]);
    await Promise.resolve();
    expect(refused).toEqual([[1, 2, 3, 4]]);
    expect(h.cues).toEqual([]);
    // A failed query is no refusal by the movers: it still clicks.
    h.orders.issueMoveTo(A);
    h.asks[1]?.reject();
    await Promise.resolve();
    expect(h.cues).toEqual(['fail']);
  });

  it('defers actual overview confirmation until acceptance, while unrelated input keeps its feedback', async () => {
    const h = harness();
    expect(h.press(A)).toBe(true);
    expect(h.cues).toEqual([]);
    h.feedback.cue('confirm'); // a later selection is independent of the unanswered walk
    expect(h.cues).toEqual(['confirm']);
    h.answer(0);
    await Promise.resolve();
    expect(h.cues).toEqual(['confirm', 'confirm']);
    h.press(B);
    h.asks[1]?.resolve([]);
    await Promise.resolve();
    expect(h.cues).toEqual(['confirm', 'confirm', 'fail']);
    expect(h.marks).toEqual([A]);
  });

  it('keeps mapless fallback and suppresses late answers after disposal', async () => {
    const h = harness();
    h.orders.issueMoveTo(A);
    h.asks[0]?.resolve(null);
    await Promise.resolve();
    expect(members(h.issued[0])).toHaveLength(4);
    h.orders.issueMoveTo(B);
    h.orders.dispose();
    h.answer(1);
    await Promise.resolve();
    expect(h.issued).toHaveLength(1);
    expect(h.marks).toEqual([A]);
    h.pending.dispose();
  });
});
