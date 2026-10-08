import { tileToScreen } from '@open-northland/render';
import { components, fx, type PlayerCommand, playerCommand } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createAnsweredOrders } from '../src/view/unit-controls/answered-orders.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import { createPendingGroundOrders } from '../src/view/unit-controls/pending-ground-orders.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';
import { COUNT, geometry, HEIGHT, makeArmy, report, WIDTH } from './support/army-march.js';

it.each(['move', 'attack-move', 'redirect'] as const)(
  'moves a 1000-soldier real app %s formation without stacking',
  async (kind) => {
    const { sim, members } = makeArmy();
    const selected = new Set(members.map(({ entity }) => entity));
    const issued: PlayerCommand[] = [];
    const pending = createPendingGroundOrders();
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
        members
          .filter(({ entity }) => ids.has(entity))
          .map(({ entity }) => {
            const p = sim.world.get(entity, components.Position);
            return { ref: entity, ...tileToScreen(fx.toFloat(p.x), fx.toFloat(p.y)) };
          }),
    };
    const orders = createUnitOrderController({
      answered: createAnsweredOrders(),
      pendingGroundOrders: pending,
      requestFormationSlots: async (target, ids, rowSpacing) => sim.formationSlots(target, ids, rowSpacing),
      snapshot: () => sim.snapshot(),
      targets,
      content: sim.content,
      mapSize: { width: WIDTH / 2, height: HEIGHT / 2 },
      toWorld: (x, y) => ({ x, y }),
      selected: () => selected,
      selectOwnSettler: () => {},
      openActions: () => {},
      enqueue: (command) =>
        pending.submit(command, (command) => {
          issued.push(command);
          sim.enqueue(playerCommand(0, command));
        }),
    });
    const accepted =
      kind === 'move'
        ? orders.issueMoveTo({ col: 250, row: 60 })
        : orders.issueAttackMove({ col: 250, row: 60 });
    expect(accepted).toBe(true);
    await Promise.resolve();
    expect(issued).toHaveLength(1);
    const command = issued[0];
    if (command?.kind !== 'moveUnitGroup' && command?.kind !== 'attackMoveUnitGroup')
      throw new Error('expected group movement');
    expect(command.members).toHaveLength(COUNT);
    expect(new Set(command.members.map(({ x, y }) => `${x},${y}`)).size).toBe(COUNT);
    sim.step();
    expect(members.filter(({ entity }) => sim.world.has(entity, components.PathFollow))).toHaveLength(COUNT);
    expect(members.filter(({ entity }) => sim.world.has(entity, components.PathRequest))).toHaveLength(0);
    let destinations = command.members;
    const reports = [geometry(sim, destinations)];
    for (const tick of [512, 1024, 2560]) {
      while (sim.tick < tick) sim.step();
      reports.push(geometry(sim, destinations));
      if (kind === 'redirect' && tick === 512) {
        expect(orders.issueAttackMove({ col: 200, row: 90 })).toBe(true);
        await Promise.resolve();
        expect(issued).toHaveLength(2);
        const redirected = issued[1];
        if (redirected?.kind !== 'attackMoveUnitGroup') throw new Error('expected group redirect');
        destinations = redirected.members;
        sim.step();
        expect(members.filter(({ entity }) => sim.world.has(entity, components.PathRequest))).toHaveLength(0);
        for (const { entity, x, y } of destinations)
          expect(sim.world.get(entity, components.PathRoute).waypoints.at(-1)?.node).toBe(
            sim.terrain?.nodeAt(x, y),
          );
      }
    }
    report(`app-${kind}`, reports);
    expect(reports[1]?.exactStacked).toBe(0);
    expect(reports.at(-1)?.arrived).toBe(COUNT);
    expect(reports.at(-1)?.nearPairs).toBe(0);
    orders.dispose();
    pending.dispose();
  },
);
