import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer } from './ownership.js';

const scenarioRules = defineWorldSingleton<{ mask: number }>('ScenarioPlayers', 'players', () => ({
  mask: 0,
}));
export const ScenarioPlayers = scenarioRules.component;

/** Map-authored seats unavailable to humans, fixed at world assembly independently of AI control. */
export function seedScenarioPlayers(world: World, players: readonly number[]): void {
  let mask = 0;
  for (const player of players) if (isValidPlayer(player)) mask |= 1 << player;
  if (mask !== 0)
    scenarioRules.write(world, (state) => {
      state.mask = mask;
    });
}

export function isScenarioPlayer(world: World, player: number | undefined): boolean {
  return (
    player !== undefined && isValidPlayer(player) && (scenarioRules.read(world).mask & (1 << player)) !== 0
  );
}
