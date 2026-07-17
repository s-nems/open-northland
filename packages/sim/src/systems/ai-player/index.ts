import { type AiModuleId, AiPlayer } from '../../components/ai-player.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { buildOrderModule, DEFAULT_BUILD_ORDER } from './build-order.js';
import { populationModule } from './population.js';
import { signpostCoverageModule } from './signpost-coverage.js';
import { workforceModule } from './workforce.js';

export * from './build-order.js';
export * from './population.js';
export * from './shared.js';
export * from './signpost-coverage.js';
export * from './workforce.js';

/**
 * AiPlayerSystem — the STRATEGIC per-player brain (build order, workforce, expansion, military),
 * distinct from the settler micro-planner in `agents/ai.ts`. Each AI-flagged seat (the `AiPlayer`
 * component the `setPlayerAi` command sets) runs its enabled modules on a coarse staggered cadence
 * and enqueues the same `Command` union a human issues; CommandSystem applies them next tick through
 * the one mutation seam, so AI orders hash, log, and replay exactly like player input (replay
 * discards the re-emitted copies — see `stepReplaying`). Modules are pure functions of world state +
 * the seeded RNG, never wall-clock or app-side reads.
 */

/**
 * Ticks between one seat's decision passes — 2 s at the 12 ticks/s base clock. A genre-convention
 * approximation (Widelands/KaM/Petra re-evaluate strategy on seconds-scale timers, not per tick);
 * per-tick cost scales with decisions, not ticks.
 */
export const AI_DECISION_INTERVAL_TICKS = 24;

/** One strategic concern of the AI player (see {@link AiModuleId} — the HAI toggle decomposition).
 *  `run` returns the commands the seat issues this decision; the system enqueues them. */
export interface AiPlayerModule {
  readonly id: AiModuleId;
  readonly run: (world: World, ctx: SystemContext, player: number) => readonly Command[];
}

/**
 * The strategic modules, in fixed run order: the workforce allocator first (it is the one module
 * that claims settlers, so no later module races it for a person), then building placement, signpost
 * coverage, and population planning. A per-seat `AiPlayer.modules` flag gates each.
 */
export const AI_PLAYER_MODULES: readonly AiPlayerModule[] = [
  workforceModule,
  buildOrderModule(DEFAULT_BUILD_ORDER),
  signpostCoverageModule,
  populationModule,
];

/**
 * One tick of the strategic AI over `modules` — the system body, parameterized so tests can drive it
 * with stub modules. Seats run in ascending player order (the canonical decision order); a seat is
 * due when the tick lands on its stagger slot, so up to MAX_PLAYERS seats spread their decision cost
 * across the interval instead of spiking on one tick.
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
      for (const command of module.run(world, ctx, seat.player)) ctx.commands.enqueue(command);
    }
  }
}

export const aiPlayerSystem: System = (world, ctx) => runAiPlayerModules(world, ctx, AI_PLAYER_MODULES);
