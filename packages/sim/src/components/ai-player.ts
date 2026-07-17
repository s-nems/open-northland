import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The strategic AI player's module ids — one per concern the AI runs for a seat. The list mirrors the
 * original's per-module HAI map-data toggles (`Game.exe` strings: `HAI_DisableCollectResources`,
 * `HAI_DisableGuideBuild`, `HAI_DisableHomeExpansion`, `HAI_DisableHouseBuild`,
 * `HAI_DisableHouseUpgrade`, `HAI_DisableMilitary`, `HAI_DisableRoadBuild`), so `[AIData]` flags map
 * onto it one-to-one; the behavior INSIDE each module is a named genre-convention approximation
 * (no byte-level evidence of the original's internals exists).
 */
export const AI_MODULE_IDS = [
  'collectResources',
  'guideBuild',
  'homeExpansion',
  'houseBuild',
  'houseUpgrade',
  'military',
  'roadBuild',
] as const;

export type AiModuleId = (typeof AI_MODULE_IDS)[number];

/** Which modules run for one AI seat — a full record (every id present), so it hashes canonically. */
export type AiModuleEnables = Record<AiModuleId, boolean>;

/** A full {@link AiModuleEnables} from a partial override: an omitted module defaults to enabled
 *  (the original's empty `[AIData]` = full HAI). */
export function aiModuleEnables(overrides?: Partial<AiModuleEnables>): AiModuleEnables {
  const enables = {} as AiModuleEnables;
  for (const id of AI_MODULE_IDS) enables[id] = overrides?.[id] ?? true;
  return enables;
}

/**
 * The per-seat strategic-AI marker — "this player is AI-driven", the sim-side flag the `setPlayerAi`
 * command sets (original: `PLAYER_TYPE_AI`, `Data/GameSourceIncludes/logicdefines.inc:358`). At most
 * one carrier entity exists per player (the command handler updates in place); a player with no
 * carrier is not AI-driven, so a command stream that never flags a seat leaves every existing golden
 * hash untouched. Part of hashed, replayed state like any component — the AiPlayerSystem's decisions
 * depend on it.
 */
export const AiPlayer = defineComponent<{
  /** The player slot this brain drives (`[0, MAX_PLAYERS)`). */
  player: number;
  modules: AiModuleEnables;
}>('AiPlayer');

/** The {@link AiPlayer} carrier for `player`, or null when the seat is not AI-driven. Canonical:
 *  the lowest-id carrier wins should more than one ever exist (the rules-singleton convention). */
export function aiPlayerEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AiPlayer)) {
    if (world.get(e, AiPlayer).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/** Whether `player`'s seat is driven by the strategic AI. */
export function isAiPlayer(world: World, player: number): boolean {
  return aiPlayerEntity(world, player) !== null;
}
