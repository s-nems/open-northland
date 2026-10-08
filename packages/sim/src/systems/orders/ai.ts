import {
  type AiModuleEnables,
  AiPeace,
  AiPlayer,
  ASSISTANT_AUDIENCE_KINDS,
  AssistantMovesFlags,
  aiModuleEnables,
  aiPlayerEntity,
  DefenceMode,
  Owner,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { AI_PUBLISHED_COUNTERS } from '../ai-player/assistant-counters.js';
import { soldierOutfitGoods } from '../ai-player/military/outfit.js';
import type { SystemContext } from '../context.js';
import {
  clearAssistantWeaponVetoes,
  resetAssistantCounters,
  revokeAssistantGrants,
  setAssistantSoldiersOnly,
  setAssistantSwitch,
} from './assistant.js';

/**
 * Attach or detach the computer player on a seat through the per-player {@link AiPlayer} carrier. The
 * flag is an ordinary component, so it hashes and replays.
 *
 * The AI plays through standing world state, so detaching the hand that published it must withdraw it:
 * the assistant counters ({@link AI_PUBLISHED_COUNTERS}), the recruit weapon vetoes and soldier outfit
 * grants its military module sets, the flag-follow switch its workforce module turns on, and the alarms
 * its defence raised, which nothing else would ever lower. Disable resets every AI-published kind, lifts
 * the vetoes, revokes the outfit and switches the flag follow off, and an in-place module update withdraws
 * what just lost its publishing gate; the alarms stay, since the defence keeps deciding for a seat with
 * its military module off.
 */
export function setPlayerAi(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setPlayerAi' }>,
): void {
  const carrier = aiPlayerEntity(world, command.player);
  if (!command.enabled) {
    if (carrier === null) return; // never AI-driven: nothing standing to withdraw
    world.destroy(carrier);
    for (const { kinds } of AI_PUBLISHED_COUNTERS) resetAssistantCounters(world, command.player, kinds);
    withdrawMilitaryPublications(world, ctx, command.player);
    setAssistantSwitch(world, AssistantMovesFlags, command.player, false);
    standDownAlarms(world, command.player);
    return;
  }
  const modules = aiModuleEnables(command.modules);
  const scripted = command.scripted ?? true;
  if (carrier === null) {
    const created = world.create();
    const difficulty = command.difficulty ?? 'hard';
    world.add(created, AiPlayer, { player: command.player, modules, scripted, difficulty });
    if (command.peaceUntil !== undefined) world.add(created, AiPeace, { untilTick: command.peaceUntil });
    return;
  }
  if (command.peaceUntil !== undefined) world.add(carrier, AiPeace, { untilTick: command.peaceUntil });
  const previous = world.get(carrier, AiPlayer).modules;
  for (const entry of AI_PUBLISHED_COUNTERS) {
    if (publishes(previous, entry.modules) && !publishes(modules, entry.modules)) {
      resetAssistantCounters(world, command.player, entry.kinds);
    }
  }
  if (previous.military && !modules.military) withdrawMilitaryPublications(world, ctx, command.player);
  if (previous.collectResources && !modules.collectResources)
    setAssistantSwitch(world, AssistantMovesFlags, command.player, false);
  const seat = world.mut(carrier, AiPlayer);
  seat.modules = modules;
  seat.scripted = scripted;
  if (command.difficulty !== undefined) seat.difficulty = command.difficulty;
}

/** Lift the recruit weapon vetoes and the soldier outfit (its grants and their soldiers-only audience) the
 *  military module published for `player`. */
function withdrawMilitaryPublications(world: World, ctx: SystemContext, player: number): void {
  clearAssistantWeaponVetoes(world, player);
  revokeAssistantGrants(world, player, soldierOutfitGoods(ctx));
  for (const kind of ASSISTANT_AUDIENCE_KINDS) setAssistantSoldiersOnly(world, player, kind, false);
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
