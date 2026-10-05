import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  type DiplomacyPanelRow,
  type DiplomacySource,
  resolveSelectedPlayer,
} from '../src/hud/dom/diplomacy-window/model.js';
import { DiplomacyOrders } from '../src/hud/dom/diplomacy-window/orders.js';

const nation: DiplomacyPanelRow = {
  player: 1,
  colour: 0,
  canDeclare: true,
  yourStance: 'friend',
  towardYou: 'enemy',
  tributes: [{ slot: 2, demands: [], payable: true }],
  tradeOffers: [],
};

function fixture() {
  let tick = 0;
  let viewer = 0;
  let accepted = true;
  let sent = 0;
  const source: DiplomacySource = {
    rows: () => [nation],
    tick: () => tick,
    viewer: () => viewer,
    declare: async () => {
      sent++;
      return accepted;
    },
    pay: async () => {
      sent++;
      return accepted;
    },
  };
  const orders = new DiplomacyOrders(source, () => undefined);
  return {
    orders,
    sent: () => sent,
    refuse: () => {
      accepted = false;
    },
    step: () => {
      tick += TICKS_PER_SECOND * 3;
    },
    watch: () => {
      viewer = 2;
    },
  };
}

describe('diplomacy orders awaiting the simulation', () => {
  it('lights a clicked attitude immediately, sends it once, and confirms from the live row', async () => {
    const f = fixture();
    f.orders.declare(nation, 'neutral');
    expect(f.orders.stance(nation)).toBe('neutral');
    f.orders.declare(nation, 'enemy');
    expect(f.sent()).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    f.orders.reconcile([{ ...nation, yourStance: 'neutral' }]);
    expect(f.orders.declaring(1)).toBe(false);
    expect(f.orders.failed).toBe(false);
  });

  it('holds payments while paused, suppresses duplicate clicks, and clears a paid slot', async () => {
    const f = fixture();
    f.orders.pay(nation, 2);
    f.orders.pay(nation, 2);
    await Promise.resolve();
    await Promise.resolve();
    f.orders.reconcile([nation]);
    expect(f.orders.paying(2)).toBe(true);
    expect(f.sent()).toBe(1);
    f.orders.reconcile([{ ...nation, tributes: [] }]);
    expect(f.orders.paying(2)).toBe(false);
  });

  it('restores the authoritative attitude when preflight rejects', async () => {
    const f = fixture();
    f.refuse();
    f.orders.declare(nation, 'enemy');
    await Promise.resolve();
    await Promise.resolve();
    expect(f.orders.stance(nation)).toBe('friend');
    expect(f.orders.failed).toBe(true);
  });

  it('allows a retry if a submitted command never takes effect, and forgets another viewer’s orders', async () => {
    const f = fixture();
    f.orders.pay(nation, 2);
    await Promise.resolve();
    await Promise.resolve();
    f.step();
    f.orders.reconcile([nation]);
    expect(f.orders.paying(2)).toBe(false);
    expect(f.orders.failed).toBe(true);
    f.orders.pay(nation, 2);
    expect(f.sent()).toBe(2);
    f.watch();
    f.orders.reconcile([nation]);
    expect(f.orders.paying(2)).toBe(false);
    expect(f.orders.failed).toBe(false);
  });

  it('keeps a known selection and recovers when that nation is removed', () => {
    expect(resolveSelectedPlayer([nation, { ...nation, player: 3 }], 3)).toBe(3);
    expect(resolveSelectedPlayer([nation], 3)).toBe(1);
    expect(resolveSelectedPlayer([], 1)).toBeNull();
  });
});
