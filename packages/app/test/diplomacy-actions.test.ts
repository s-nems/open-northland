import type { MapRelationFlag } from '@open-northland/data';
import type { OpenTribute, PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createDiplomacyActions } from '../src/view/diplomacy-actions.js';

function fixture() {
  const sent: PlayerCommand[] = [];
  const flags: MapRelationFlag[] = [];
  let player: number | null = 0;
  let commandable = true;
  let met = true;
  let locked = false;
  let stock: readonly OpenTribute[] = [{ slot: 2, receiver: 1, stringId: 3, demands: [], payable: true }];
  let lockAnswer: (() => Promise<boolean>) | undefined;
  const actions = createDiplomacyActions({
    host: {
      hasMetPlayer: () => met,
      diplomacyLocked: () => lockAnswer?.() ?? Promise.resolve(locked),
      openTributes: async () => stock,
    },
    viewer: () => player,
    canCommand: () => commandable,
    wholeMap: () => false,
    roster: [0, 1, 2],
    flags,
    submit: (command) => sent.push(command),
  });
  return {
    actions,
    sent,
    flags,
    watch: (next: number | null) => {
      player = next;
    },
    readOnly: () => {
      commandable = false;
    },
    forget: () => {
      met = false;
    },
    lock: () => {
      locked = true;
    },
    stock: (next: readonly OpenTribute[]) => {
      stock = next;
    },
    lockAnswer: (answer: () => Promise<boolean>) => {
      lockAnswer = answer;
    },
  };
}

describe('diplomacy click authority', () => {
  it('sends only the viewed seat’s direction after checking the current lock', async () => {
    const f = fixture();
    expect(await f.actions.declare(1, 'neutral')).toBe(true);
    expect(f.sent).toEqual([{ kind: 'declareDiplomacy', player: 0, other: 1, state: 'neutral' }]);
    f.lock();
    expect(await f.actions.declare(1, 'enemy')).toBe(false);
    expect(f.sent).toHaveLength(1);
  });

  it('refuses hidden details, undiscovered seats, and read-only viewers', async () => {
    for (const block of ['details', 'hide', 'unmet', 'observer'] as const) {
      const f = fixture();
      if (block === 'details') f.flags.push({ kind: 'hideDetails', a: 1, b: 0 });
      if (block === 'hide') f.flags.push({ kind: 'hide', a: 0, b: 1 });
      if (block === 'unmet') f.forget();
      if (block === 'observer') f.readOnly();
      expect(await f.actions.declare(1, 'friend'), block).toBe(false);
      expect(f.sent).toEqual([]);
    }
  });

  it('drops an outstanding click if the viewer changes before the host answers', async () => {
    const f = fixture();
    let answer: (locked: boolean) => void = () => undefined;
    f.lockAnswer(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const request = f.actions.declare(1, 'enemy');
    f.watch(2);
    answer(false);
    expect(await request).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it('uses fresh payable and receiver values, including shared-stock refusal', async () => {
    const f = fixture();
    f.stock([
      {
        slot: 2,
        receiver: 1,
        stringId: 3,
        payable: false,
        demands: [
          { good: 1, amount: 10, onHand: 15 },
          { good: 2, amount: 10, onHand: 15 },
        ],
      },
    ]);
    expect(await f.actions.pay(1, 2)).toBe(false);
    f.stock([{ slot: 2, receiver: 2, stringId: 3, demands: [], payable: true }]);
    expect(await f.actions.pay(1, 2)).toBe(false);
    expect(f.sent).toEqual([]);
    expect(await f.actions.pay(2, 2)).toBe(true);
    expect(f.sent).toEqual([{ kind: 'payTribute', player: 0, slot: 2 }]);
    f.stock([]);
    expect(await f.actions.pay(2, 2)).toBe(false);
  });
});
