import { type AiModuleId, AiPlayer } from '../../components/ai-player.js';
import { aiCommand, type PlayerCommand } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { buildOrderModule, DEFAULT_BUILD_ORDER } from './build-order/index.js';
import { militaryModule } from './military/index.js';
import { populationModule } from './population.js';
import { scoutModule } from './scout/index.js';
import { AI_DECISION_INTERVAL_TICKS } from './shared.js';
import { workforceModule } from './workforce/index.js';

export * from './base.js';
export * from './build-order/index.js';
export * from './military/index.js';
export * from './population.js';
export * from './scout/index.js';
export * from './shared.js';
export * from './workforce/index.js';

/**
 * The STRATEGIC per-player brain (build order, workforce, expansion, military), distinct from the settler
 * micro-planner in `settlers/planner/system.ts`. Its modules return the same `PlayerCommand` union a
 * human issues, so AI orders hash, log, and replay exactly like player input.
 */

/** One strategic concern of the AI player (see {@link AiModuleId} - the HAI toggle decomposition).
 *  `run` returns the commands the seat issues this decision; the system enqueues them. */
export interface AiPlayerModule {
  readonly id: AiModuleId;
  readonly run: (world: World, ctx: SystemContext, player: number) => readonly PlayerCommand[];
}

/**
 * The strategic modules, in fixed run order.
 *
 * Two modules claim settlers, and they cannot race for one: the allocator's spare pool holds no fighter
 * (`workforce/pool.ts`) and the army's census admits nothing else (`military/census.ts`).
 */
export const AI_PLAYER_MODULES: readonly AiPlayerModule[] = [
  workforceModule(DEFAULT_BUILD_ORDER),
  buildOrderModule(DEFAULT_BUILD_ORDER),
  scoutModule,
  populationModule,
  militaryModule,
];

/**
 * One tick of the strategic AI over `modules`. Seats run in ascending player order (the canonical
 * decision order); a seat is due when the tick lands on its stagger slot, so up to MAX_PLAYERS seats
 * spread their decision cost across the interval instead of spiking on one tick.
 */
export function runAiPlayerModules(
  world: World,
  ctx: SystemContext,
  modules: readonly AiPlayerModule[],
): void {
  const seats: Array<{ player: number; modules: Record<AiModuleId, boolean> }> = [];
  for (const e of world.query(AiPlayer)) seats.push(world.get(e, AiPlayer));
  seats.sort((a, b) => a.player - b.player);
  for (const seat of seats) {
    if (ctx.tick % AI_DECISION_INTERVAL_TICKS !== seat.player % AI_DECISION_INTERVAL_TICKS) continue;
    for (const module of modules) {
      if (!seat.modules[module.id]) continue;
      for (const command of module.run(world, ctx, seat.player)) {
        ctx.commands.enqueue(aiCommand(seat.player, command));
      }
    }
  }
}

export const aiPlayerSystem: System = (world, ctx) => runAiPlayerModules(world, ctx, AI_PLAYER_MODULES);
