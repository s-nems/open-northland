import { insertSortedById } from '../../core/sorted-id.js';
import type { World } from '../../ecs/world.js';
import { defineWorldSingleton } from '../../ecs/world-singleton.js';

/** The players who unmarked the coin on one of their barracks; a barracks they finish afterwards gets no
 *  coin mark by default. Sticky for the match. Our own rule, not the original's. */
const barracksCoinOptOut = defineWorldSingleton<{ players: number[] }>(
  'BarracksCoinOptOut',
  'players',
  () => ({
    players: [],
  }),
);

export const BarracksCoinOptOut = barracksCoinOptOut.component;

/** Whether `player` turned the barracks' default coin mark off. */
export function barracksCoinOptedOut(world: World, player: number): boolean {
  return barracksCoinOptOut.read(world).players.includes(player);
}

/** Turn the barracks' default coin mark off for `player` until the match ends; a repeat writes nothing. */
export function optOutOfBarracksCoin(world: World, player: number): void {
  if (barracksCoinOptedOut(world, player)) return;
  barracksCoinOptOut.write(world, (state) => insertSortedById(state.players, player, (id) => id));
}
