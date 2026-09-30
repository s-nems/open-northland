import { type AiModuleId, AiPlayer } from '../../components/ai-player.js';
import { isPlayerDead } from '../../components/match.js';
import { aiCommand, type PlayerCommand } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { catchUpSeatStock } from '../stores/index.js';
import { buildOrderModule, DEFAULT_BUILD_ORDER } from './build-order/index.js';
import { aiDecisionDue } from './cadence.js';
import { militaryModule } from './military/index.js';
import { populationModule } from './population.js';
import { roadBuildModule } from './road-build.js';
import { scoutModule } from './scout/index.js';
import { workforceModule } from './workforce/index.js';

export * from './base.js';
export * from './build-order/index.js';
export * from './cadence.js';
export * from './difficulty.js';
export * from './diplomacy.js';
export * from './military/index.js';
export * from './population.js';
export * from './road-build.js';
export * from './scout/index.js';
export * from './traffic.js';
export * from './workforce/index.js';

/**
 * The STRATEGIC per-player brain (build order, workforce, expansion, military), distinct from the settler
 * micro-planner in `settlers/planner/system.ts`. Its modules return the same `PlayerCommand` union a
 * human issues and CommandSystem applies them next tick, so AI orders hash, log, and replay exactly like
 * player input.
 */

/** The commands a seat issues this decision; the system enqueues them. */
type AiDecision = (world: World, ctx: SystemContext, player: number) => readonly PlayerCommand[];

/** One strategic concern of the AI player (see {@link AiModuleId} - the HAI toggle decomposition). */
export interface AiPlayerModule {
  readonly id: AiModuleId;
  readonly run: AiDecision;
  /** What the seat's scripted handler does with the module switched off. The original's `HAI_Disable`
   *  toggles address only its strategic handler, and the part of a module the scripted one owns keeps
   *  deciding here until `AI_Disable` stops that handler too. */
  readonly whileDisabled?: AiDecision;
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
  // After the build order, so a road site never lands on the ground a building placed this decision takes.
  roadBuildModule,
  scoutModule(DEFAULT_BUILD_ORDER),
  populationModule,
  militaryModule,
];

/**
 * One tick of the strategic AI over `modules`. Seats run in ascending player order (the canonical
 * decision order); a seat is due when the tick lands on its slot ({@link aiDecisionDue}), so the seats
 * spread their decision cost across the interval instead of spiking on one tick or a run of them.
 */
export function runAiPlayerModules(
  world: World,
  ctx: SystemContext,
  modules: readonly AiPlayerModule[],
): void {
  catchUpSeatStock(world);
  const seats: Array<{ player: number; modules: Record<AiModuleId, boolean>; scripted: boolean }> = [];
  for (const e of world.query(AiPlayer)) seats.push(world.get(e, AiPlayer));
  seats.sort((a, b) => a.player - b.player);
  for (const seat of seats) {
    if (!aiDecisionDue(ctx.tick, seat.player)) continue;
    // The authority gate would refuse a dead seat's orders anyway; skipping keeps them out of the log.
    if (isPlayerDead(world, seat.player)) continue;
    for (const module of modules) {
      const decide = seat.modules[module.id] ? module.run : seat.scripted ? module.whileDisabled : undefined;
      if (decide === undefined) continue;
      for (const command of decide(world, ctx, seat.player)) {
        ctx.commands.enqueue(aiCommand(seat.player, command));
      }
    }
  }
}

export const aiPlayerSystem: System = (world, ctx) => runAiPlayerModules(world, ctx, AI_PLAYER_MODULES);
