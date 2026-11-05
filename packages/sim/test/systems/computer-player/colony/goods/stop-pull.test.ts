import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerColony,
  StorePriority,
  TradeRoute,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import type { Simulation } from '../../../../../src/index.js';
import { stopPullOrders } from '../../../../../src/systems/computer-player/colony/goods/stop-pull.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { stepUntil } from '../../../../fixtures/colony-islands.js';
import { twoColonies } from '../../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { MUD, SEAT } from '../../support.js';

const MUD_ID = 'mud';
/** More mud than a colony could hold by then. */
const MUD_LACKED = 1000;
const SECOND_LINE_TICKS = minutesToTicks(60);

/** Each colony's trader once its route stands with marks at the colony's stop. */
function routeTraders(sim: Simulation): Entity[] {
  const state = sim.world.get(aiControlEntity(sim.world, SEAT) as Entity, ComputerColony);
  return state.colonies.flatMap((colony) => {
    const trader = colony.route?.trader ?? null;
    const route = trader === null ? undefined : sim.world.tryGet(trader, TradeRoute);
    return trader !== null && (route?.stops[1]?.imports.length ?? 0) > 0 ? [trader] : [];
  });
}

/** Fill the colony's stop of `trader` up to `upTo` units of mud. */
function markMud(sim: Simulation, trader: Entity, upTo: number): void {
  const stop = sim.world.mut(trader, TradeRoute).stops[1];
  if (stop === undefined) throw new Error('setup: no colony stop');
  stop.imports = [...stop.imports.filter((m) => m.good !== MUD), { good: MUD, upTo, keep: 0 }];
}

describe("a seat's home stop store", () => {
  it('pulls a good while any colony routed through it lacks it, and lets go once no live route does', () => {
    const sim = twoColonies();
    expect(stepUntil(sim, SECOND_LINE_TICKS, () => routeTraders(sim).length === 2)).toBe(true);
    const [short, full] = routeTraders(sim);
    if (short === undefined || full === undefined) throw new Error('setup: two routes');
    const store = sim.world.get(short, TradeRoute).stops[0]?.house;
    expect(sim.world.get(full, TradeRoute).stops[0]?.house).toBe(store);
    if (store === undefined) throw new Error('setup: no home stop');
    const ctx = ctxOf(sim);
    const terrain = ctx.terrain;
    const carrier = aiControlEntity(sim.world, SEAT);
    if (terrain === undefined || carrier === null) throw new Error('setup: no seat');
    const pull = () => stopPullOrders({ world: sim.world, ctx, terrain, seat: SEAT, carrier }, [MUD_ID]);
    const order = (priority: boolean) => [
      { kind: 'setStorePriority', building: store, goodType: MUD, priority },
    ];
    markMud(sim, short, MUD_LACKED);
    markMud(sim, full, 0);
    expect(pull()).toEqual(order(true));
    sim.world.add(store, StorePriority, { goods: [MUD] });
    expect(pull()).toEqual([]);
    markMud(sim, short, 0);
    expect(pull()).toEqual(order(false));
    markMud(sim, short, MUD_LACKED);
    sim.world.destroy(short);
    expect(pull()).toEqual(order(false));
  });
});
