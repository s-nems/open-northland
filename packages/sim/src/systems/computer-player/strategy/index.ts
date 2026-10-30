import {
  aiControlEntity,
  ComputerStrategy,
  type ComputerStrategyState,
  computerControllerRuns,
  type EconomicChoice,
  type EconomicStrategyState,
  mapBriefOf,
} from '../../../components/index.js';
import { isPlayerDead } from '../../../components/match.js';
import type { DeepReadonly, World } from '../../../ecs/world.js';
import { computerDecisionDue, moduleBeatDue } from '../../ai-shared/cadence.js';
import type { SystemContext } from '../../context.js';
import { type SeatBrief, seatBriefOf } from '../knowledge/seat-brief.js';
import { selectEconomy } from './select.js';

export * from './select.js';

/** Every how many of a seat's decisions its strategy is reviewed: 3 game minutes at the 4 s decision
 *  beat. Authored; the inputs are static today, so the beat is the hook for later ones. */
export const STRATEGY_REVIEW_EVERY_DECISIONS = 45;
/** How many reviews in a row a different archetype must win before it replaces the current one.
 *  Authored: keeps a seat from flapping on an input that hovers at a threshold. */
export const STRATEGY_SWITCH_REVIEWS = 3;

/**
 * Decide each running computer seat's strategy once the map brief exists, then review it on its own
 * slow beat. A seat whose computer controller does not run (the master permission) is never decided.
 */
export function reviewComputerStrategies(world: World, ctx: SystemContext, seats: readonly number[]): void {
  const brief = mapBriefOf(world);
  if (brief === null) return;
  for (const seat of seats) {
    const carrier = aiControlEntity(world, seat);
    if (carrier === null || !computerControllerRuns(world, seat) || isPlayerDead(world, seat)) continue;
    const held = world.tryGet(carrier, ComputerStrategy);
    if (held !== undefined && !reviewDue(ctx.tick, seat)) continue;
    const seatBrief = seatBriefOf(brief, seat);
    if (seatBrief === null) continue;
    const choice = selectEconomy(seatBrief);
    if (held === undefined) {
      world.add(carrier, ComputerStrategy, { economy: { ...choice, decidedAt: ctx.tick, challenger: null } });
      continue;
    }
    const next = reviewEconomy(held.economy, choice, ctx.tick);
    if (next !== null) world.mut(carrier, ComputerStrategy).economy = next;
  }
}

function reviewDue(tick: number, seat: number): boolean {
  return computerDecisionDue(tick, seat) && moduleBeatDue(tick, seat, STRATEGY_REVIEW_EVERY_DECISIONS);
}

/**
 * The economy after one review, or null when it stands unchanged. The same archetype refreshes its
 * sides and evidence and drops a challenger; a different one replaces it only once it has won
 * {@link STRATEGY_SWITCH_REVIEWS} reviews in a row.
 */
export function reviewEconomy(
  held: DeepReadonly<EconomicStrategyState>,
  choice: EconomicChoice,
  tick: number,
): EconomicStrategyState | null {
  if (choice.archetype === held.archetype) {
    if (
      held.challenger === null &&
      sameList(held.sides, choice.sides) &&
      sameList(held.evidence, choice.evidence)
    )
      return null;
    return { ...choice, decidedAt: held.decidedAt, challenger: null };
  }
  const reviews = (held.challenger?.archetype === choice.archetype ? held.challenger.reviews : 0) + 1;
  if (reviews >= STRATEGY_SWITCH_REVIEWS) return { ...choice, decidedAt: tick, challenger: null };
  return {
    archetype: held.archetype,
    sides: [...held.sides],
    evidence: [...held.evidence],
    decidedAt: held.decidedAt,
    challenger: { archetype: choice.archetype, reviews },
  };
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** One seat's strategy and the seat brief it was chosen from, for a debug view. */
export interface SeatStrategyView {
  /** A copy of the saved record; null before the seat's first decision. */
  readonly strategy: ComputerStrategyState | null;
  /** Null before the map brief, or for a seat the brief holds no start for. */
  readonly brief: SeatBrief | null;
}

export function seatStrategyOf(world: World, player: number): SeatStrategyView {
  const mapBrief = mapBriefOf(world);
  const carrier = aiControlEntity(world, player);
  const held = carrier === null ? undefined : world.tryGet(carrier, ComputerStrategy);
  const economy = held?.economy;
  return {
    strategy:
      economy === undefined
        ? null
        : {
            economy: {
              archetype: economy.archetype,
              sides: [...economy.sides],
              evidence: [...economy.evidence],
              decidedAt: economy.decidedAt,
              challenger: economy.challenger === null ? null : { ...economy.challenger },
            },
          },
    brief: mapBrief === null ? null : seatBriefOf(mapBrief, player),
  };
}
