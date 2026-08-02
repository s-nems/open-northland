import {
  type AiModuleEnables,
  AiPlayer,
  aiModuleEnables,
  aiPlayerEntity,
  isValidPlayer,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { AI_PUBLISHED_COUNTERS } from '../ai-player/shared.js';
import { resetAssistantCounters } from './assistant.js';

/**
 * Attach/detach the strategic AI on a seat (the per-player {@link AiPlayer} carrier - the
 * rules-singleton pattern, keyed by player): created on first enable, updated in place thereafter,
 * destroyed on disable. The flag drives the AiPlayerSystem, so it hashes/replays like any component.
 * An out-of-range player is skipped (still logged for faithful replay).
 *
 * The AI plays through standing assistant counters ({@link AI_PUBLISHED_COUNTERS}), so detaching the
 * hand that published them must withdraw them: disable resets every AI-published kind, and an
 * in-place module update resets the kinds whose publishing gates just broke. Without this a headless
 * seat would keep breeding and drafting forever on its last standing order.
 */
export function setPlayerAi(world: World, command: Extract<Command, { kind: 'setPlayerAi' }>): void {
  if (!isValidPlayer(command.player)) return;
  const carrier = aiPlayerEntity(world, command.player);
  if (!command.enabled) {
    if (carrier === null) return; // never AI-driven: nothing standing to withdraw
    world.destroy(carrier);
    for (const { kinds } of AI_PUBLISHED_COUNTERS) resetAssistantCounters(world, command.player, kinds);
    return;
  }
  const modules = aiModuleEnables(command.modules);
  if (carrier === null) {
    world.add(world.create(), AiPlayer, { player: command.player, modules });
    return;
  }
  const previous = world.get(carrier, AiPlayer).modules;
  for (const entry of AI_PUBLISHED_COUNTERS) {
    if (publishes(previous, entry.modules) && !publishes(modules, entry.modules)) {
      resetAssistantCounters(world, command.player, entry.kinds);
    }
  }
  world.get(carrier, AiPlayer).modules = modules;
}

/** Whether every gate in `gates` is on - the conjunction that keeps an entry's counters published. */
function publishes(enables: AiModuleEnables, gates: readonly (keyof AiModuleEnables)[]): boolean {
  return gates.every((gate) => enables[gate]);
}
