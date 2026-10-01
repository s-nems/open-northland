import type { ContentSet } from '@open-northland/data';
import {
  Age,
  hasMissionBehaviour,
  isAboardVehicle,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  type NeedDrain,
  Person,
  Position,
  Rider,
  Settler,
  SettlerNeeds,
  type SettlerView,
} from '../../../components/index.js';
import type { Component, Entity, World } from '../../../ecs/world.js';
import { declaresNoTrades, isFighterJob, isHeroJob } from '../../readviews/index.js';
import { isAboardShip } from '../../readviews/vehicles.js';

// Everything a person's drain class reads, so a write to none of them leaves the class as it was.
export const DRAIN_CLASS_MEMBERSHIP: readonly Component<unknown>[] = [
  Person,
  Settler,
  SettlerNeeds,
  Age,
  MissionBehaviour,
  Rider,
  Position,
];
export const DRAIN_CLASS_VALUES: readonly Component<unknown>[] = [Settler, MissionBehaviour, Rider];

/** Frozen inside a cart, hitpoints included (approximation); a ship's passengers eat and sleep aboard. */
export function frozenInCart(world: World, content: ContentSet, e: Entity): boolean {
  return isAboardVehicle(world, e) && !isAboardShip(world, content, e);
}

/** Whether `e`'s bars move at all - the one gate the drain and the clip events share. */
export function carriesNeeds(world: World, content: ContentSet, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && settlerCarriesNeeds(world, content, e, settler);
}

export function settlerCarriesNeeds(
  world: World,
  content: ContentSet,
  e: Entity,
  settler: SettlerView,
): boolean {
  return (
    !hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NEEDS_FROZEN) &&
    !world.has(e, Age) &&
    !isHeroJob(content, settler.jobType) &&
    !declaresNoTrades(content, settler.tribe)
  );
}

/** The bars a carrying settler drains: a fighter's company is frozen. */
export function carriedDrain(content: ContentSet, settler: SettlerView): NeedDrain {
  return isFighterJob(content, settler.jobType) ? 'body' : 'all';
}

/** The drain the needs pass leaves on a person while needs are on. */
export function drainClassOf(world: World, content: ContentSet, e: Entity): NeedDrain {
  if (frozenInCart(world, content, e)) return 'none';
  return carriesNeeds(world, content, e) ? carriedDrain(content, world.get(e, Settler)) : 'none';
}
