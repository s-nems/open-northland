import { insertSortedById, removeSortedById } from '../core/sorted-id.js';
import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer } from './ownership.js';

/** The condition slots one `ai.inc` may declare; a flag index at or past this is dropped (reading). */
export const AI_CONDITION_SLOTS = 100;

const aiExternalFlags = defineWorldSingleton<{
  /** player → the condition slots a script has raised, ascending. */
  raised: Map<number, number[]>;
}>('AiExternalFlags', 'players', () => ({ raised: new Map() }));

/**
 * The condition flags a map script sets on a player's AI (`SetExternalFlag`), the "external activate"
 * conditions of its `ai.inc`. The original stores them on the seat's AI handler and drops the write
 * when the seat has none; this build keeps them for any valid slot. No reader exists yet: the scripted
 * AI condition layer is not modelled, so the table waits for it.
 */
export const AiExternalFlags = aiExternalFlags.component;

export function aiExternalFlagRaised(world: World, player: number, slot: number): boolean {
  return aiExternalFlags.read(world).raised.get(player)?.includes(slot) ?? false;
}

/** Raise or clear one slot. An invalid player, a slot outside {@link AI_CONDITION_SLOTS}, or a write
 *  that changes nothing is skipped. */
export function setAiExternalFlag(world: World, player: number, slot: number, raised: boolean): void {
  if (!isValidPlayer(player) || !Number.isInteger(slot) || slot < 0 || slot >= AI_CONDITION_SLOTS) return;
  if (aiExternalFlagRaised(world, player, slot) === raised) return;
  aiExternalFlags.write(world, (state) => {
    const slots = state.raised.get(player) ?? [];
    if (raised) insertSortedById(slots, slot, (id) => id);
    else removeSortedById(slots, slot, (id) => id);
    if (slots.length === 0) state.raised.delete(player);
    else state.raised.set(player, slots);
  });
}
