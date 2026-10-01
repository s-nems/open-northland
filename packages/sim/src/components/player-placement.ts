import type { ContentSet } from '@open-northland/data';
import { contentIndex } from '../core/content-index.js';
import { insertSortedById } from '../core/sorted-id.js';
import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer } from './ownership.js';
import { scriptEnabledHouseTribes } from './unlocks.js';

const placementRules = defineWorldSingleton<{ tribes: Map<number, number[]> }>(
  'PlayerPlacementRules',
  'players',
  () => ({ tribes: new Map() }),
);

export const PlayerPlacementRules = placementRules.component;

/** The seat's home nations. Null means undeclared, which places nothing; an empty list declares no home
 *  nation, so the seat places only the nations it unlocks ({@link buildTribes}). */
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

/**
 * Per player, the tribes its ordinary settlers unlocked beyond its declared ones, ascending. Sticky: a
 * tribe stays unlocked after its last settler dies. Original behavior (unconfirmed against the running
 * game): each player keeps per-tribe
 * enabled flags that only a human of that tribe or a script line ever sets, and none ever clears.
 */
const seatTribeUnlocks = defineWorldSingleton<{ byPlayer: Map<number, number[]> }>(
  'SeatTribeUnlocks',
  'players',
  () => ({ byPlayer: new Map() }),
);

export const SeatTribeUnlocks = seatTribeUnlocks.component;

const NO_TRIBES: readonly number[] = [];

export function seatUnlockedTribes(world: World, player: number): readonly number[] {
  return seatTribeUnlocks.read(world).byPlayer.get(player) ?? NO_TRIBES;
}

/** Record `tribe` as unlocked for `player`; a repeat writes nothing, so it bumps no store generation. */
export function unlockSeatTribe(world: World, player: number, tribe: number): void {
  if (!isValidPlayer(player) || seatUnlockedTribes(world, player).includes(tribe)) return;
  seatTribeUnlocks.write(world, (state) => {
    let tribes = state.byPlayer.get(player);
    if (tribes === undefined) {
      tribes = [];
      state.byPlayer.set(player, tribes);
    }
    insertSortedById(tribes, tribe, (id) => id);
  });
}

/**
 * Whether `owner`'s progression covers `tribe` at all: a declared tribe, or one its ordinary settlers
 * unlocked. A neutral owner and a seat without declared placement rules (scenes and tests without a
 * roster) treat every tribe as unlocked.
 */
export function tribeUnlockedFor(world: World, owner: number | undefined, tribe: number): boolean {
  if (owner === undefined) return true;
  const declared = playerPlacementTribes(world, owner);
  return declared === null || declared.includes(tribe) || seatUnlockedTribes(world, owner).includes(tribe);
}

/**
 * The tribes whose houses `player` may place: its declared tribes in roster order, then the tribes its
 * settlers unlocked, then those a script enabled a house of, each later group ascending and without the
 * tribes already listed. Whether a single house of one is enabled stays the `buildingEnabled` gate's
 * call. A seat without declared rules places nothing, as the command authority fails closed for it.
 */
export function buildTribes(world: World, player: number): readonly number[] {
  const declared = playerPlacementTribes(world, player);
  if (declared === null) return NO_TRIBES;
  const tribes = [...declared];
  for (const tribe of seatUnlockedTribes(world, player)) if (!tribes.includes(tribe)) tribes.push(tribe);
  for (const tribe of scriptEnabledHouseTribes(world, player))
    if (!tribes.includes(tribe)) tribes.push(tribe);
  return tribes;
}
