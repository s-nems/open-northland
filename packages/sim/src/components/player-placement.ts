import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../core/content-index.js';
import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer } from './ownership.js';

const placementRules = defineWorldSingleton<{ tribes: Map<number, number[]> }>(
  'PlayerPlacementRules',
  'players',
  () => ({ tribes: new Map() }),
);

export const PlayerPlacementRules = placementRules.component;

/** Null means undeclared; an empty list explicitly denies placements. Both fail closed. */
export function playerPlacementTribes(world: World, player: number): readonly number[] | null {
  return placementRules.read(world).tribes.get(player) ?? null;
}

export function validPlacementTribes(content: ContentSet, tribes: unknown): tribes is readonly number[] {
  if (!Array.isArray(tribes)) return false;
  const known = contentIndex(content).tribes;
  for (const tribe of tribes) {
    if (typeof tribe !== 'number' || !Number.isSafeInteger(tribe) || !known.has(tribe)) return false;
  }
  return true;
}

/** Trusted roster setup; the first declared tribe is the AI's preferred civilization. */
export function setPlayerPlacementTribes(
  world: World,
  content: ContentSet,
  player: number,
  tribes: readonly number[],
): void {
  if (!isValidPlayer(player) || !validPlacementTribes(content, tribes)) return;
  const owned = [...new Set(tribes)];
  const current = playerPlacementTribes(world, player);
  if (current !== null && current.length === owned.length && current.every((tribe, i) => tribe === owned[i]))
    return;
  placementRules.write(world, (rules) => rules.tribes.set(player, owned));
}
