import { tileToScreen } from '@open-northland/render';
import {
  components,
  fx,
  halfCellMapFromCells,
  type PlayerCommand,
  playerCommand,
  Simulation,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { inlineSessionHost } from '../src/session/inline-host.js';
import { createAnsweredOrders } from '../src/view/unit-controls/answered-orders.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import { createPendingGroundOrders } from '../src/view/unit-controls/pending-ground-orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';

const TARGET = { hx: 26, hy: 20 };
const LATER = { hx: 26, hy: 26 };

function harness({
  vehicleType = 3,
  delayed = false,
  staleMirror = false,
  readOnRelease = false,
}: {
  vehicleType?: 3 | 5;
  delayed?: boolean;
  staleMirror?: boolean;
  readOnRelease?: boolean;
} = {}) {
  const sim = new Simulation({
    seed: 5,
    content: testContent(),
    map: halfCellMapFromCells({
      width: 16,
      height: 16,
      typeIds: Array.from({ length: 256 }, (_, i) => (vehicleType === 3 && i % 16 >= 10 ? 1 : 0)),
    }),
  });
  sim.enqueueSetup({ kind: 'createVehicle', vehicleType, x: 22, y: 8, tribe: 1, owner: 0 });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  for (const y of [6, 10])
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: vehicleType === 5 ? 31 : 27,
      x: 2,
      y,
      tribe: 1,
      owner: 0,
    });
  sim.step();
  const [vehicle] = [...sim.world.query(components.Vehicle)];
  if (vehicle === undefined) throw new Error('missing fixture vehicle');
  const [captain, passenger] = [...sim.world.query(components.Settler)];
  if (captain === undefined || passenger === undefined) throw new Error('missing fixture crew');
  const beforeBoarding = sim.snapshot();
  sim.enqueue(playerCommand(0, { kind: 'attachToVehicle', entity: captain, vehicle }));
  if (vehicleType === 3)
    sim.enqueue(playerCommand(0, { kind: 'attachToVehicle', entity: passenger, vehicle }));
  sim.step();
  expect(sim.world.get(captain, components.Rider)).toEqual({ vehicle, boarding: false, leaving: null });
  expect(sim.world.has(captain, components.Position)).toBe(true);
  expect(sim.world.has(captain, components.PathFollow)).toBe(true);
  const host = inlineSessionHost(sim);
  const pending = createPendingGroundOrders();
  const selected = new Set([captain, passenger]);
  const issued: PlayerCommand[] = [];
  const marks: unknown[] = [];
  const answers: (() => Promise<void>)[] = [];
  const submit = (command: PlayerCommand) =>
    pending.submit(command, (command) => {
      issued.push(command);
      sim.enqueue(playerCommand(0, command));
    });
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
    ownedSettlersIn: (ids) =>
      [captain, passenger]
        .filter((entity) => ids.has(entity) && sim.world.has(entity, components.Position))
        .map((entity) => {
          const position = sim.world.get(entity, components.Position);
          return { ref: entity, ...tileToScreen(fx.toFloat(position.x), fx.toFloat(position.y)) };
        }),
  };
  const orders = createUnitOrderController({
    answered: createAnsweredOrders(),
    pendingGroundOrders: pending,
    requestFormationSlots: (...args) => {
      const read = () => host.formationSlots(...args);
      if (!delayed) return read();
      const answer = readOnRelease ? undefined : read();
      return new Promise<Awaited<ReturnType<typeof read>>>((resolve) => {
        answers.push(async () => resolve(await (answer ?? read())));
      });
    },
    snapshot: staleMirror ? () => beforeBoarding : host.snapshot,
    targets,
    content: host.content,
    mapSize: { width: 16, height: 16 },
    toWorld: (x, y) => ({ x, y }),
    selected: () => selected,
    selectOwnSettler: () => {},
    openActions: () => {},
    enqueue: submit,
    markOrder: (target) => marks.push(target),
  });
  const answer = async (index: number) => {
    const release = answers[index];
    if (release === undefined) throw new Error('missing formation query');
    await release();
    await Promise.resolve();
  };
  const dispose = () => {
    orders.dispose();
    pending.dispose();
  };
  return {
    sim,
    host,
    vehicle,
    captain,
    passenger,
    orders,
    selected,
    issued,
    marks,
    pending,
    submit,
    answer,
    dispose,
  };
}

describe('vehicle commanders in fresh formations', () => {
  it.each(['move', 'attack-move'] as const)(
    'keeps a boarding captain’s water %s target while forming its ordinary passenger on land',
    async (kind) => {
      const h = harness();
      const target = { col: TARGET.hx, row: TARGET.hy };
      expect(kind === 'move' ? h.orders.issueMoveTo(target) : h.orders.issueAttackMove(target)).toBe(true);
      await Promise.resolve();
      const command = h.issued[0];
      if (command?.kind !== 'moveUnitGroup' && command?.kind !== 'attackMoveUnitGroup')
        throw new Error('expected one mixed selection order');
      expect(command.members).toHaveLength(2);
      expect(command.members.find(({ entity }) => entity === h.captain)).toEqual({
        entity: h.captain,
        x: TARGET.hx,
        y: TARGET.hy,
      });
      const foot = command.members.find(({ entity }) => entity === h.passenger);
      if (foot === undefined || h.sim.terrain === undefined) throw new Error('missing foot destination');
      expect(h.sim.terrain.isWalkable(h.sim.terrain.nodeAt(foot.x, foot.y))).toBe(true);
      h.sim.step();
      expect(h.sim.world.get(h.vehicle, components.Vehicle)).toMatchObject({
        task: 'waitsForHuman',
        heldGoal: TARGET,
        march: null,
      });
      expect(h.sim.world.has(h.captain, components.Position)).toBe(true);
      h.dispose();
    },
  );

  it.each(['move', 'attack-move'] as const)(
    'preserves the boarding siege commander’s %s state',
    async (kind) => {
      const h = harness({ vehicleType: 5 });
      h.selected.delete(h.passenger);
      const target = { col: TARGET.hx, row: TARGET.hy };
      expect(kind === 'move' ? h.orders.issueMoveTo(target) : h.orders.issueAttackMove(target)).toBe(true);
      await Promise.resolve();
      h.sim.step();
      expect(h.sim.world.get(h.vehicle, components.Vehicle)).toMatchObject({
        task: 'waitsForHuman',
        heldGoal: TARGET,
        march: kind === 'attack-move' ? { goal: TARGET, restUntil: 0 } : null,
      });
      h.dispose();
    },
  );

  it('keeps aboard commanders, excludes aboard passengers and clamps the click without changing state', async () => {
    const h = harness();
    const crew = [h.captain, h.passenger];
    for (const entity of crew) h.sim.enqueue(playerCommand(0, { kind: 'boardVehicle', entity }));
    for (let tick = 0; tick < 512 && crew.some((id) => h.sim.world.has(id, components.Position)); tick++)
      h.sim.step();
    expect(crew.some((id) => h.sim.world.has(id, components.Position))).toBe(false);
    const before = h.sim.hashState();
    expect(await h.host.formationSlots({ hx: 99, hy: -5 }, [h.passenger, h.captain, h.captain], 2)).toEqual([
      { members: [h.captain], slots: [{ hx: 31, hy: 0 }], commandedVehicle: h.vehicle },
    ]);
    expect(h.sim.hashState()).toBe(before);
    h.dispose();
  });

  it.each(
    (['moveVehicle', 'stopVehicle', 'unloadPeople'] as const).flatMap((kind) =>
      [false, true].map((staleMirror) => ({ kind, staleMirror })),
    ),
  )(
    'never lets a delayed captain answer replace a newer $kind (stale mirror: $staleMirror)',
    async ({ kind, staleMirror }) => {
      const h = harness({ delayed: true, staleMirror });
      h.selected.delete(h.passenger);
      h.submit({ kind: 'moveVehicle', vehicle: h.vehicle, x: LATER.hx, y: LATER.hy });
      h.sim.step();
      h.issued.length = 0;
      h.orders.issueMoveTo({ col: TARGET.hx, row: TARGET.hy });
      h.submit(
        kind === 'moveVehicle'
          ? { kind, vehicle: h.vehicle, x: LATER.hx, y: LATER.hy }
          : { kind, vehicle: h.vehicle },
      );
      h.sim.step();
      await h.answer(0);
      expect(h.issued.map(({ kind }) => kind)).toEqual([kind]);
      expect(h.marks).toEqual([]);
      h.sim.step();
      expect(h.sim.world.get(h.vehicle, components.Vehicle).heldGoal).toEqual(
        kind === 'moveVehicle' ? LATER : null,
      );
      h.dispose();
    },
  );

  it('keeps reverse Shift answers ordered when both discover a captain missing from the mirror', async () => {
    const h = harness({ delayed: true, staleMirror: true });
    h.selected.delete(h.passenger);
    h.orders.issueMoveTo({ col: TARGET.hx, row: TARGET.hy });
    h.orders.issueMoveTo({ col: LATER.hx, row: LATER.hy }, undefined, true);
    await h.answer(1);
    expect(h.issued).toEqual([]);
    await h.answer(0);
    expect(h.issued).toEqual([
      { kind: 'moveUnit', entity: h.captain, x: TARGET.hx, y: TARGET.hy },
      { kind: 'moveUnit', entity: h.captain, x: LATER.hx, y: LATER.hy, queued: true },
    ]);
    h.dispose();
  });

  it('retains the click-time alias when unloading happens before the fresh query reads the world', async () => {
    const h = harness({ delayed: true, readOnRelease: true });
    h.selected.delete(h.passenger);
    h.orders.issueMoveTo({ col: TARGET.hx, row: TARGET.hy });
    h.submit({ kind: 'unloadPeople', vehicle: h.vehicle });
    h.sim.step();
    expect(h.sim.world.has(h.captain, components.Rider)).toBe(false);
    await h.answer(0);
    expect(h.issued).toEqual([{ kind: 'unloadPeople', vehicle: h.vehicle }]);
    expect(h.marks).toEqual([]);
    h.dispose();
  });

  it('waits a Shift captain order behind an unanswered order for its vehicle', async () => {
    const h = harness({ delayed: true });
    h.selected.delete(h.passenger);
    const previous = h.pending.begin([h.vehicle], false);
    h.orders.issueMoveTo({ col: TARGET.hx, row: TARGET.hy }, undefined, true);
    await h.answer(0);
    expect(h.issued).toEqual([]);
    h.pending.settle(previous, () => {
      h.submit({ kind: 'moveVehicle', vehicle: h.vehicle, x: LATER.hx, y: LATER.hy });
    });
    expect(h.issued).toEqual([
      { kind: 'moveVehicle', vehicle: h.vehicle, x: LATER.hx, y: LATER.hy },
      { kind: 'moveUnit', entity: h.captain, x: TARGET.hx, y: TARGET.hy, queued: true },
    ]);
    h.dispose();
  });
});
