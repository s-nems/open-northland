import type { DeepReadonly, World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer } from './ownership.js';

/**
 * What one player's war has cost and taken. Counters only rise, and a script removal never touches
 * them: `RemoveHumans` and `RemoveAnimals` take their victims off the board silently.
 */
export interface PlayerTally {
  /** Humans of this player that died, soldiers included. */
  humansDied: number;
  soldiersDied: number;
  /** Humans this player's units killed. The original counts soldiers and civilians in two counters
   *  and no goal reads them apart, so they are summed here. */
  humansKilled: number;
}

/** Materialized by the first death, saved and hashed from there on; absent in a world where nothing
 *  has died yet. */
const playerStatistics = defineWorldSingleton<{ byPlayer: Map<number, PlayerTally> }>(
  'PlayerStatistics',
  'players',
  () => ({ byPlayer: new Map() }),
);

const NO_TALLY: DeepReadonly<PlayerTally> = Object.freeze({
  humansDied: 0,
  soldiersDied: 0,
  humansKilled: 0,
});

/** A player that has neither lost nor killed anyone reads zeroes, as does an invalid slot. */
export function playerTally(world: World, player: number): DeepReadonly<PlayerTally> {
  return playerStatistics.read(world).byPlayer.get(player) ?? NO_TALLY;
}

/** Count one human of `player` dead. An unowned casualty - wildlife, a neutral settler - belongs to
 *  no tally and is skipped. */
export function recordHumanDeath(world: World, player: number | undefined, soldier: boolean): void {
  tally(world, player, (t) => {
    t.humansDied++;
    if (soldier) t.soldiersDied++;
  });
}

/** Credit `player` with one human killed. Approximation: a blow that lands after its attacker has
 *  fallen - a dead archer's arrow - reaches no owner and is credited to nobody. */
export function recordHumanKill(world: World, player: number | undefined): void {
  tally(world, player, (t) => {
    t.humansKilled++;
  });
}

function tally(world: World, player: number | undefined, apply: (tally: PlayerTally) => void): void {
  if (player === undefined || !isValidPlayer(player)) return;
  playerStatistics.write(world, (state) => {
    let held = state.byPlayer.get(player);
    if (held === undefined) {
      held = { humansDied: 0, soldiersDied: 0, humansKilled: 0 };
      state.byPlayer.set(player, held);
    }
    apply(held);
  });
}
