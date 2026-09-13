import type { ClientMessage } from '@open-northland/net-protocol';
import { exportSaveGame, restoreSimulation, Simulation } from '@open-northland/sim';
import { afterEach, expect, it, vi } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { SaveOrders } from '../src/save-orders.js';

const order = {
  v: 1,
  origin: 'player',
  player: 0,
  command: {
    kind: 'setAssistantCounter',
    player: 0,
    counter: 'extraMen',
    value: 3,
    infinite: false,
  },
} as const;
function capture() {
  const sim = new Simulation({ seed: 5, content: testContent() });
  const save = exportSaveGame(sim);
  const orders = new SaveOrders();
  const sent: ClientMessage[] = [];
  const promise = orders.request(save, 0, (message) => sent.push(message));
  return { sim, save, orders, sent, promise };
}
afterEach(() => vi.useRealTimers());

it('adds authoritative orders to the originally captured world even if the live sim advances', async () => {
  const { sim, save, orders, sent, promise } = capture();
  expect(sent).toEqual([{ kind: 'saveOrders', id: 1, tick: 0, world: 0 }]);
  sim.run(3);
  orders.receive({
    kind: 'saveOrders',
    id: 1,
    tick: 0,
    frames: [{ tick: 2, commands: [{ envelope: order, sequence: 0 }] }],
  });
  const captured = await promise;
  expect(captured.header.tick).toBe(0);
  expect(save.sections.find((section) => section.id === 'commands')?.continuation).toEqual([]);
  const restored = restoreSimulation(captured, { content: testContent() }).sim;
  restored.step();
  expect(restored.commands.log).toEqual([]);
  restored.step();
  expect(restored.commands.log).toMatchObject([{ applyTick: 2, command: order.command }]);
});

it('rejects concurrent captures and expires a lost response instead of writing an incomplete save', async () => {
  vi.useFakeTimers();
  const { orders, save, promise } = capture();
  await expect(orders.request(save, 0, () => undefined)).rejects.toThrow(/already/);
  const failure = expect(promise).rejects.toThrow(/Timed out/);
  await vi.advanceTimersByTimeAsync(10_000);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores an old response after cancellation and keeps the next save pending', async () => {
  const { orders, save, promise } = capture();
  const failure = expect(promise).rejects.toThrow(/world/);
  orders.cancel('world changed');
  await failure;
  const next = orders.request(save, 0, () => undefined);
  orders.receive({ kind: 'saveOrders', id: 1, tick: 0, frames: [] });
  orders.receive({
    kind: 'saveOrders',
    id: 2,
    tick: 0,
    frames: [{ tick: 1, commands: [{ envelope: order, sequence: 0 }] }],
  });
  expect((await next).sections.find((section) => section.id === 'commands')?.continuation).toHaveLength(1);
});

it('rejects a wrong tick and invalid simulation payloads without completing the save', async () => {
  const a = capture();
  const wrongTick = expect(a.promise).rejects.toThrow(/another saved tick/);
  a.orders.receive({ kind: 'saveOrders', id: 1, tick: 1, frames: [] });
  await wrongTick;
  const b = capture();
  const malformed = expect(b.promise).rejects.toThrow();
  b.orders.receive({
    kind: 'saveOrders',
    id: 1,
    tick: 0,
    frames: [
      { tick: 1, commands: [{ sequence: 0, envelope: { ...order, command: { kind: 'unknownCommand' } } }] },
    ],
  });
  await malformed;
});

it('does not let a delayed refusal of a timed out save cancel a newer capture', async () => {
  const { orders, save, promise } = capture();
  const failure = expect(promise).rejects.toThrow(/expired/);
  orders.cancel('expired');
  await failure;
  const next = orders.request(save, 0, () => undefined);
  orders.refuse(1, 'old failure');
  orders.refuse(undefined, 'uncorrelated failure');
  orders.receive({ kind: 'saveOrders', id: 2, tick: 0, frames: [] });
  expect(await next).toEqual(save);
  const latest = orders.request(save, 0, () => undefined);
  const refused = expect(latest).rejects.toThrow(/current failure/);
  orders.refuse(3, 'current failure');
  await refused;
});
