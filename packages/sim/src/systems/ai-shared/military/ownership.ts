import {
  AiControl,
  aiControlEntity,
  MapAiState,
  mapAiEntity,
  Owner,
  WaveMarch,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';

interface ClaimCache {
  readonly key: readonly number[];
  readonly seats: Map<number, ReadonlySet<Entity>>;
}

const claimsByWorld = new WeakMap<World, ClaimCache>();

/** Explicit map tasks take precedence over autonomous plans and local defence. The implicit home
 * guard and default position remain available to answer a raid or man a tower. */
export function mapAiSoldierClaims(world: World, player: number): ReadonlySet<Entity> {
  const key = [
    world.componentGeneration(AiControl),
    world.componentValueGeneration(AiControl),
    world.componentGeneration(MapAiState),
    world.componentValueGeneration(MapAiState),
    world.componentGeneration(Owner),
    world.componentValueGeneration(Owner),
  ];
  const previous = claimsByWorld.get(world);
  const cache =
    previous !== undefined && key.every((value, i) => value === previous.key[i])
      ? previous
      : { key, seats: new Map<number, ReadonlySet<Entity>>() };
  if (cache !== previous) claimsByWorld.set(world, cache);
  const held = cache.seats.get(player);
  if (held !== undefined) return held;
  const control = aiControlEntity(world, player);
  const program = mapAiEntity(world, player);
  const claims = new Set<Entity>();
  if (control !== null && program !== null && world.get(control, AiControl).mapAiEnabled) {
    const state = world.get(program, MapAiState);
    for (let j = 0; j < state.soldiers.length; j++) {
      const soldier = state.soldiers[j];
      if (soldier === undefined) continue;
      if (world.tryGet(soldier.entity, Owner)?.player !== player) continue;
      const fallback = state.defaultDefend !== null && soldier.task === state.tasks.length - 1;
      if (soldier.task !== null && !fallback) claims.add(soldier.entity);
    }
  }
  cache.seats.set(player, claims);
  return claims;
}

/** A newly activated map task can take men back from a campaign. Remove the old ownership immediately,
 * including men currently fighting, so the wave cannot recover them on its next decision. */
export function releaseCampaignClaims(world: World, player: number, claimed: ReadonlySet<Entity>): void {
  if (claimed.size === 0) return;
  for (const carrier of world.query(WaveMarch, Owner)) {
    if (world.get(carrier, Owner).player !== player) continue;
    const wave = world.get(carrier, WaveMarch);
    if (!wave.men.some((e) => claimed.has(e))) continue;
    world.mut(carrier, WaveMarch).men = wave.men.filter((e) => !claimed.has(e));
  }
}
