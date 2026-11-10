import {
  aiControlEntity,
  ComputerStrategy,
  type ComputerStrategyState,
  computerControllerRuns,
  mapBriefOf,
} from '../../../components/index.js';
import { isPlayerDead } from '../../../components/match.js';
import type { World } from '../../../ecs/world.js';
import { computerDecisionDue, moduleBeatDue, POSTURE_REVIEW_PHASE } from '../../ai-shared/cadence.js';
import type { SystemContext } from '../../context.js';
import { type SeatBrief, seatBriefOf } from '../knowledge/seat-brief.js';
import {
  firstMilitary,
  POSTURE_REVIEW_EVERY_DECISIONS,
  postureInputsOf,
  reviewMilitary,
  selectPosture,
} from './military.js';
import { selectEconomy } from './select.js';

export * from './military.js';
export * from './select.js';

/**
 * Decide each running computer seat's strategy once the map brief exists, its economy from the static
 * seat brief and its drawn military plan, then review the military posture on its own beat and phase. A
 * seat whose computer controller does not run (the master permission) is never decided.
 */
export function reviewComputerStrategies(world: World, ctx: SystemContext, seats: readonly number[]): void {
  const brief = mapBriefOf(world);
  if (brief === null) return;
  for (const seat of seats) {
    const carrier = aiControlEntity(world, seat);
    if (carrier === null || !computerControllerRuns(world, seat) || isPlayerDead(world, seat)) continue;
    const held = world.tryGet(carrier, ComputerStrategy);
    const decision = ctx.tick - POSTURE_REVIEW_PHASE;
    if (held !== undefined && !computerDecisionDue(decision, seat)) continue;
    const seatBrief = seatBriefOf(brief, seat);
    if (seatBrief === null) continue;
    if (held === undefined) {
      world.add(carrier, ComputerStrategy, {
        economy: { ...selectEconomy(seatBrief), decidedAt: ctx.tick },
        military: firstMilitary(world, ctx, seat),
      });
      continue;
    }
    if (moduleBeatDue(decision, seat, POSTURE_REVIEW_EVERY_DECISIONS)) {
      const military = world.get(carrier, ComputerStrategy).military;
      const choice = selectPosture(military.plan, postureInputsOf(world, ctx, seat), military.posture);
      world.mut(carrier, ComputerStrategy).military = reviewMilitary(military, choice, ctx.tick);
    }
  }
}

/** One seat's strategy and the seat brief it was chosen from, for a debug view. */
export interface SeatStrategyView {
  /** The saved record; null before the seat's first decision. */
  readonly strategy: ComputerStrategyState | null;
  /** Null before the map brief, or for a seat the brief holds no start for. */
  readonly brief: SeatBrief | null;
}
