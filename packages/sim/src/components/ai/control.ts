import {
  ComputerModuleId as ComputerModuleSchema,
  type ComputerModuleId as DataComputerModuleId,
} from '@open-northland/data';
import { defineComponent, type Entity, type World } from '../../ecs/world.js';

/**
 * The computer player's module ids, one per autonomous concern: the map data's
 * `[AIData]` per-module toggles, so an authored flag maps onto a module one-to-one. Approximation:
 * the behavior inside each module is a genre convention.
 */
export const COMPUTER_MODULE_IDS: readonly DataComputerModuleId[] = ComputerModuleSchema.options;

export type ComputerModuleId = DataComputerModuleId;

/** How hard a computer seat plays (authored): `hard` is the full strategy, `medium` and `easy` the same
 *  modules paced slower and stopped earlier (`systems/computer-player/difficulty.ts`). */
export const COMPUTER_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type ComputerDifficulty = (typeof COMPUTER_DIFFICULTIES)[number];

/** Which modules run for one computer player - a full record (every id present), so it hashes canonically. */
export type ComputerModuleEnables = Record<ComputerModuleId, boolean>;

/** A full {@link ComputerModuleEnables} from a partial override: an omitted module defaults to enabled
 *  (the original's empty `[AIData]` = full HAI). */
export function computerModuleEnables(overrides?: Partial<ComputerModuleEnables>): ComputerModuleEnables {
  const enables = {} as ComputerModuleEnables;
  for (const id of COMPUTER_MODULE_IDS) enables[id] = overrides?.[id] ?? true;
  return enables;
}

/** Machine-player identity and independent permissions for its two decision sources.
 * Disabling both preserves machine-specific unit rules; removing the component returns human rules. */
export const AiControl = defineComponent<{
  player: number;
  /** Master permission: future autonomous modules cannot escape a map's blanket disable. */
  computerEnabled: boolean;
  modules: ComputerModuleEnables;
  mapAiEnabled: boolean;
  difficulty: ComputerDifficulty;
}>('AiControl', 'players');

/** Each seat's lowest-id {@link AiControl} carrier, rebuilt when the store's membership or values move.
 *  Derived read state, never hashed or saved. */
interface CarrierIndex {
  generation: number;
  valueGeneration: number;
  readonly bySeat: Map<number, Entity>;
}

const carrierIndexByWorld = new WeakMap<World, CarrierIndex>();

/** The {@link AiControl} carrier for `player`, or null when the seat is not AI-driven. The lowest-id
 *  carrier wins should more than one ever exist. Asked per settler by the needs and unlock rules, so the
 *  answer comes from a per-world index rather than a store walk. */
export function aiControlEntity(world: World, player: number): Entity | null {
  const generation = world.componentGeneration(AiControl);
  const valueGeneration = world.componentValueGeneration(AiControl);
  let index = carrierIndexByWorld.get(world);
  if (index === undefined) {
    index = { generation: -1, valueGeneration: -1, bySeat: new Map() };
    carrierIndexByWorld.set(world, index);
  }
  if (index.generation !== generation || index.valueGeneration !== valueGeneration) {
    index.bySeat.clear();
    for (const e of world.query(AiControl)) {
      const seat = world.get(e, AiControl).player;
      const held = index.bySeat.get(seat);
      if (held === undefined || e < held) index.bySeat.set(seat, e);
    }
    index.generation = generation;
    index.valueGeneration = valueGeneration;
  }
  return index.bySeat.get(player) ?? null;
}

/** Whether `player` has machine identity, independently of its controller permissions. */
export function isMachinePlayer(world: World, player: number): boolean {
  return aiControlEntity(world, player) !== null;
}

/** Whether a computer controller runs for `player`: the seat has machine identity and its master
 *  permission on, so at least its diplomacy decides. A map-AI-only seat has identity alone. */
export function computerControllerRuns(world: World, player: number): boolean {
  const carrier = aiControlEntity(world, player);
  return carrier !== null && world.get(carrier, AiControl).computerEnabled;
}

/** Whether `player` is a map-scripted machine seat: the computer player does not run its economy, so the
 *  map AI's town pass holds its goods. A seat whose economy the computer player runs plays like a human. */
export function isScriptedEconomySeat(world: World, player: number): boolean {
  return isMachinePlayer(world, player) && !computerModuleRuns(world, player, 'collectResources');
}

/** The toggles a computer seat's colony needs, all of them: it raises houses, gathers and posts its own
 *  signposts. A colony is no `[AIData]` toggle of its own, or every game's hashed
 *  {@link ComputerModuleEnables} would move. */
export const COLONY_MODULES: readonly ComputerModuleId[] = ['houseBuild', 'collectResources', 'guideBuild'];

/** Whether the computer player may run `module`; both master and module permission are required. */
export function computerModuleRuns(world: World, player: number, module: ComputerModuleId): boolean {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return false;
  const control = world.get(carrier, AiControl);
  return control.computerEnabled && control.modules[module];
}

/** Whether `enables`, master permission folded in, let a colony run ({@link COLONY_MODULES}). */
export function everyColonyModule(enables: ComputerModuleEnables): boolean {
  return COLONY_MODULES.every((module) => enables[module]);
}

/** Whether the computer player may run `player`'s colony ({@link everyColonyModule}). */
export function colonyRuns(world: World, player: number): boolean {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return false;
  const control = world.get(carrier, AiControl);
  return control.computerEnabled && everyColonyModule(control.modules);
}
