import {
  type AiModuleEnables,
  AiPlayer,
  aiModuleEnables,
  aiPlayerEntity,
  DefenceMode,
  isValidPlayer,
  Owner,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { AI_PUBLISHED_COUNTERS } from '../ai-player/assistant-counters.js';
import { resetAssistantCounters } from './assistant.js';

/**
 * Attach or detach the strategic AI on a seat through the per-player {@link AiPlayer} carrier. The flag
 * is an ordinary component, so it hashes and replays.
 *
 * The AI plays through standing world state, so detaching the hand that published it must withdraw it:
 * the assistant counters ({@link AI_PUBLISHED_COUNTERS}) and the alarms its defence raised, which
 * nothing else would ever lower. Disable resets every AI-published kind, and an in-place module update
 * resets the kinds whose publishing gates just broke; the alarms stay, since the defence keeps
 * deciding for a seat with its military module off.
 */
export function setPlayerAi(world: World, command: Extract<Command, { kind: 'setPlayerAi' }>): void {
  if (!isValidPlayer(command.player)) return;
  const carrier = aiPlayerEntity(world, command.player);
  if (!command.enabled) {
    if (carrier === null) return; // never AI-driven: nothing standing to withdraw
    world.destroy(carrier);
    for (const { kinds } of AI_PUBLISHED_COUNTERS) resetAssistantCounters(world, command.player, kinds);
    standDownAlarms(world, command.player);
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
  world.mut(carrier, AiPlayer).modules = modules;
}

/** Lower every alarm the seat is standing on, a hand-raised one included: the seat that would have called
 *  it off is the one being detached, and no drive lowers an alarm by itself. */
function standDownAlarms(world: World, player: number): void {
  const alarmed: Entity[] = [];
  for (const e of world.query(DefenceMode, Owner)) {
    if (world.get(e, Owner).player === player) alarmed.push(e);
  }
  for (const e of alarmed) world.remove(e, DefenceMode);
}

/** Whether every gate in `gates` is on - the conjunction that keeps an entry's counters published. */
function publishes(enables: AiModuleEnables, gates: readonly (keyof AiModuleEnables)[]): boolean {
  return gates.every((gate) => enables[gate]);
}
