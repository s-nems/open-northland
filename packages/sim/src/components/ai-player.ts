import { type MapAiModule, MapAiModule as MapAiModuleSchema } from '@open-northland/data';
import { defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The strategic AI player's module ids, one per concern the AI runs for a seat: the map data's
 * `[AIData]` per-module toggles, so an authored flag maps onto a module one-to-one. Approximation:
 * the behavior inside each module is a genre convention.
 */
export const AI_MODULE_IDS: readonly MapAiModule[] = MapAiModuleSchema.options;

export type AiModuleId = MapAiModule;

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
 * The per-seat computer-player marker, set by the `setPlayerAi` command (original: `PLAYER_TYPE_AI`,
 * `Data/GameSourceIncludes/logicdefines.inc:358`). At most one carrier entity exists per player, and a
 * player with no carrier is a human seat. The original runs two handlers for such a seat: the
 * strategic one behind `modules`, and the scripted one behind `scripted` (the map's `[AIData]`
 * program, tower manning, the defence answer and the minute refill of its soldiers' food and stamina).
 * `AI_Disable` switches both off yet leaves the seat a computer player, which the needs rules read.
 */
export const AiPlayer = defineComponent<{
  /** The player slot this brain drives (`[0, MAX_PLAYERS)`). */
  player: number;
  modules: AiModuleEnables;
  /** Whether the seat's scripted handler runs. */
  scripted: boolean;
}>('AiPlayer', 'players');

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
export const MusterPlan = defineComponent<MusterPlanState>('MusterPlan', 'players');

export interface StalledPlacementState {
  /** The stalled entry's index in the seat's build order. */
  entry: number;
  /** The first tick the seat searches a spot for that entry again. */
  retryTick: number;
}

/**
 * The build-order placement whose spot search last found nothing, held on the seat's {@link AiPlayer}
 * carrier so it dies with the seat. The build order skips that entry's search until `retryTick` and
 * drops the record once the entry places or another entry acts.
 */
export const StalledPlacement = defineComponent<StalledPlacementState>('StalledPlacement', 'players');

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

/** Whether `player` is a computer seat, whatever its handlers are set to. */
export function isAiPlayer(world: World, player: number): boolean {
  return aiPlayerEntity(world, player) !== null;
}

/** Whether `player`'s seat runs `module`. A non-AI seat runs none. */
export function aiModuleRuns(world: World, player: number, module: AiModuleId): boolean {
  const carrier = aiPlayerEntity(world, player);
  return carrier !== null && world.get(carrier, AiPlayer).modules[module];
}
