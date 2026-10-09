import { type ContentSet, unitVariantFor } from '@open-northland/data';
import {
  Health,
  isScenarioPlayer,
  ownerOf,
  Person,
  removeCurrentAtomic,
  Settler,
  type SettlerIdentity,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/** Original default; class exceptions are content, and an authored spawn may override its initial pool. */
export const HUMAN_HITPOINTS = 5000;

export function unitHitpoints(content: ContentSet, identity: SettlerIdentity): number {
  return unitVariantFor(content, identity)?.hitpoints ?? HUMAN_HITPOINTS;
}

/** Authored rule: preserve the health fraction on a form change, rounding down with a living minimum of one HP. */
export function resizeUnitHealth(world: World, e: Entity, previous: number, next: number): void {
  const health = world.tryGet(e, Health);
  if (previous === next || health === undefined) return;
  const changed = world.mut(e, Health);
  changed.hitpoints =
    health.hitpoints <= 0 ? 0 : Math.max(1, Math.floor((health.hitpoints * next) / health.max));
  changed.max = next;
}

/** A mission handover changes the form with its owner; an old form's pending strike cannot survive it. */
export function syncScenarioIdentity(world: World, content: ContentSet, e: Entity): void {
  if (!world.has(e, Person)) return;
  const identity = world.get(e, Settler);
  const scenario = isScenarioPlayer(world, ownerOf(world, e));
  if ((identity.scenario === true) === scenario) return;
  const previous = unitHitpoints(content, identity);
  const previousVariant = unitVariantFor(content, identity);
  world.mut(e, Settler).scenario = scenario ? true : undefined;
  resizeUnitHealth(world, e, previous, unitHitpoints(content, world.get(e, Settler)));
  if (previousVariant !== unitVariantFor(content, world.get(e, Settler))) removeCurrentAtomic(world, e);
}
