import {
  type AiModuleId,
  ASSISTANT_COUNTER_MAX,
  ASSISTANT_COUNTER_MIN,
  type AssistantCounterKind,
  AssistantCounters,
  assistantCountersEntity,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';

/**
 * The standing assistant counters the strategic modules publish, keyed by the module gates that must
 * ALL run for the kinds to stay published (the garrison rung lives inside the workforce module and
 * self-gates on `military`, so its counter needs both).
 */
export const AI_PUBLISHED_COUNTERS: ReadonlyArray<{
  readonly modules: readonly AiModuleId[];
  readonly kinds: readonly AssistantCounterKind[];
}> = [
  { modules: ['homeExpansion'], kinds: ['extraWomen', 'extraMen'] },
  {
    modules: ['collectResources', 'military'],
    kinds: ['trainSoldiers', 'trainSword', 'trainSpear', 'trainBow'],
  },
];

/**
 * The `setAssistantCounter` command moving `player`'s `kind` to exactly `{value, infinite}`, or null
 * when the counter already sits there. `value` is clamped to the counter bounds here, so a want past
 * the cap settles instead of re-issuing an unsatisfiable set every decision. Accepted race: the
 * absolute value is a decision-tick snapshot applied one tick later, so a counter payment inside that
 * window is transiently re-added and the next decision corrects it.
 */
export function assistantCounterCommand(
  world: World,
  player: number,
  kind: AssistantCounterKind,
  value: number,
  infinite: boolean,
): PlayerCommand | null {
  const wanted = Math.min(ASSISTANT_COUNTER_MAX, Math.max(ASSISTANT_COUNTER_MIN, value));
  const carrier = assistantCountersEntity(world, player);
  const current =
    carrier === null ? { value: 0, infinite: false } : world.get(carrier, AssistantCounters).counters[kind];
  if (current.value === wanted && current.infinite === infinite) return null;
  return { kind: 'setAssistantCounter', player, counter: kind, value: wanted, infinite };
}
