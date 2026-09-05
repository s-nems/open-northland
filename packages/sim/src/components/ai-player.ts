import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The strategic AI player's module ids, one per concern the AI runs for a seat. The list mirrors the
 * original's per-module HAI map-data toggles (`Game.exe` strings `HAI_DisableCollectResources`,
 * `HAI_DisableGuideBuild`, `HAI_DisableHomeExpansion`, `HAI_DisableHouseBuild`, `HAI_DisableHouseUpgrade`,
 * `HAI_DisableMilitary`, `HAI_DisableRoadBuild`), so `[AIData]` flags map onto it one-to-one.
 * Approximation: the behavior inside each module is a genre convention.
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

/** Which modules run for one AI seat - a full record (every id present), so it hashes canonically. */
export type AiModuleEnables = Record<AiModuleId, boolean>;

/** A full {@link AiModuleEnables} from a partial override: an omitted module defaults to enabled
 *  (the original's empty `[AIData]` = full HAI). */
export function aiModuleEnables(overrides?: Partial<AiModuleEnables>): AiModuleEnables {
  const enables = {} as AiModuleEnables;
  for (const id of AI_MODULE_IDS) enables[id] = overrides?.[id] ?? true;
  return enables;
}

/**
 * The per-seat strategic-AI marker, set by the `setPlayerAi` command (original: `PLAYER_TYPE_AI`,
 * `Data/GameSourceIncludes/logicdefines.inc:358`). At most one carrier entity exists per player, and a
 * player with no carrier is not AI-driven.
 */
export const AiPlayer = defineComponent<{
  /** The player slot this brain drives (`[0, MAX_PLAYERS)`). */
  player: number;
  modules: AiModuleEnables;
}>('AiPlayer');

export interface MusterPlanState {
  /** Soldiers to gather before the wave marches. */
  waveSize: number;
  /** The tick this wave was drawn - the gathering window runs from here. */
  drawnAt: number;
}

/**
 * The wave one seat's barracks is gathering, held between decisions on the muster barracks itself, so it
 * dies with the door. The military decision mints it when a worthy band first stands there and retires it
 * when the wave marches, the army falls under a wave, or the campaign has no objective; a disabled military
 * leaves it in place, window and all.
 */
export const MusterPlan = defineComponent<MusterPlanState>('MusterPlan');

/** The {@link AiPlayer} carrier for `player`, or null when the seat is not AI-driven. The lowest-id
 *  carrier wins should more than one ever exist. */
export function aiPlayerEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(AiPlayer)) {
    if (world.get(e, AiPlayer).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

export function isAiPlayer(world: World, player: number): boolean {
  return aiPlayerEntity(world, player) !== null;
}

/** Whether `player`'s seat runs `module`. A non-AI seat runs none. */
export function aiModuleRuns(world: World, player: number, module: AiModuleId): boolean {
  const carrier = aiPlayerEntity(world, player);
  return carrier !== null && world.get(carrier, AiPlayer).modules[module];
}
