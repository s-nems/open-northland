import { AiControl, type ComputerModuleId, computerModuleRuns } from '../../components/ai/control.js';
import { isPlayerDead } from '../../components/match.js';
import { aiCommand, type PlayerCommand } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { computerDecisionDue, moduleBeatDue } from '../ai-shared/cadence.js';
import type { System, SystemContext } from '../context.js';
import { catchUpSeatStock } from '../stores/index.js';
import { buildOrderModule, DEFAULT_BUILD_ORDER, roomReviewModule } from './build-order/index.js';
import { colonyModule } from './colony/index.js';
import { updateComputerIntel } from './knowledge/intel/index.js';
import { ensureMapBrief } from './knowledge/map-brief/index.js';
import { militaryModule } from './military/index.js';
import { populationModule } from './population.js';
import { roadBuildModule } from './road-build.js';
import { scoutModule } from './scout/index.js';
import { reviewComputerStrategies } from './strategy/index.js';
import { workforceModule } from './workforce/index.js';

export * from '../ai-shared/cadence.js';
export * from './base.js';
export * from './build-order/index.js';
export * from './difficulty.js';
export * from './diplomacy.js';
export * from './knowledge/intel/index.js';
export * from './knowledge/map-brief/index.js';
export * from './knowledge/seat-brief.js';
export * from './military/index.js';
export * from './population.js';
export * from './road-build.js';
export * from './scout/index.js';
export * from './strategy/index.js';
export * from './traffic.js';
export * from './workforce/index.js';

/**
 * The autonomous computer player (build order, workforce, expansion, military), distinct from the settler
 * micro-planner in `settlers/planner/system.ts`. Its modules return the same `PlayerCommand` union a
 * human issues and CommandSystem applies them next tick, so AI orders hash, log, and replay exactly like
 * player input.
 */

/** The commands a seat issues this decision; the system enqueues them. */
type ComputerDecision = (world: World, ctx: SystemContext, player: number) => readonly PlayerCommand[];

interface ComputerModuleParts {
  readonly run: ComputerDecision;
  /** Every how many of the seat's decisions the module runs ({@link moduleBeatDue}); every one when
   *  absent. */
  readonly everyDecisions?: number;
  /** The phase the module shares with another; its index in the run order when absent. */
  readonly phase?: number;
}

/** One autonomous concern of the computer player (see {@link ComputerModuleId} - the HAI toggle
 *  decomposition). `colony` has no map toggle of its own, so `gate` names the toggle that runs it. */
export type ComputerModule = ComputerModuleParts &
  ({ readonly id: ComputerModuleId } | { readonly id: 'colony'; readonly gate: ComputerModuleId });

/**
 * The computer modules, in fixed run order.
 *
 * Two modules claim settlers, and they cannot race for one: the allocator's spare pool holds no fighter
 * (`workforce/pool.ts`) and the army's census admits nothing else (`../ai-shared/military/census.ts`).
 */
export const COMPUTER_MODULES: readonly ComputerModule[] = [
  workforceModule(DEFAULT_BUILD_ORDER),
  buildOrderModule(DEFAULT_BUILD_ORDER),
  // After the build order, so a road site never lands on the ground a building placed this decision takes.
  roadBuildModule,
  scoutModule(DEFAULT_BUILD_ORDER),
  populationModule,
  militaryModule,
  // Last, on phases of their own choosing: the six indices above and the military phase stay put.
  colonyModule,
  roomReviewModule(DEFAULT_BUILD_ORDER),
];

/**
 * Ticks between consecutive modules of one seat's decision: module `k` runs `k` phases after the seat's
 * slot, so a decision tick costs its dearest module rather than all of them; the seat slots
 * ({@link computerDecisionSlot}) keep two seats' modules off one tick. Each module then reads the
 * world after the commands of the modules before it have applied (commands apply on the next tick's
 * command pass): the road module, after the build order, sees the site that decision placed standing.
 * Authored.
 */
export const COMPUTER_MODULE_PHASE_TICKS = 1;

/**
 * One tick of the computer player over `modules`. Seats run in ascending player order (the canonical
 * decision order); a seat's module is due when the tick lands on its slot ({@link computerDecisionDue}) plus
 * the module's phase, so the seats and their modules spread their decision cost across the interval
 * instead of spiking on one tick or a run of them. The map brief is taken, each seat's strategy
 * decided or reviewed and its intel refreshed on its own phase, before the modules decide.
 */
export function runComputerModules(
  world: World,
  ctx: SystemContext,
  modules: readonly ComputerModule[],
): void {
  catchUpSeatStock(world);
  ensureMapBrief(world, ctx);
  const seats: number[] = [];
  for (const e of world.query(AiControl)) seats.push(world.get(e, AiControl).player);
  seats.sort((a, b) => a - b);
  reviewComputerStrategies(world, ctx, seats);
  updateComputerIntel(world, ctx, seats);
  for (const seat of seats) {
    for (let index = 0; index < modules.length; index++) {
      const module = modules[index];
      if (module === undefined) continue;
      const slot = ctx.tick - (module.phase ?? index) * COMPUTER_MODULE_PHASE_TICKS;
      if (!computerDecisionDue(slot, seat)) continue;
      if (module.everyDecisions !== undefined && !moduleBeatDue(slot, seat, module.everyDecisions)) continue;
      // The authority gate would refuse a dead seat's orders anyway; skipping keeps them out of the log.
      if (isPlayerDead(world, seat)) continue;
      if (!computerModuleRuns(world, seat, module.id === 'colony' ? module.gate : module.id)) continue;
      for (const command of module.run(world, ctx, seat)) {
        ctx.commands.enqueue(aiCommand(seat, command, module.id));
      }
    }
  }
}

export const computerPlayerSystem: System = (world, ctx) => runComputerModules(world, ctx, COMPUTER_MODULES);
