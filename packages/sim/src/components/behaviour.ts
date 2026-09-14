import { type Component, defineComponent, type Entity, type World } from '../ecs/world.js';

/**
 * The 32-bit behaviour mask a placed or scripted human carries (`MISSIONS.md`, "Human behaviour
 * flags"). Stored verbatim, bits without a reader included, because a script may set and clear any of
 * them and a later line reads the whole word back.
 */
export const MissionBehaviour = defineComponent<{ flags: number }>('MissionBehaviour', 'settlers');

/** A house's own mask, written by `SetHouseBehaviourFlag` one bit index at a time. */
export const HouseBehaviour = defineComponent<{ flags: number }>('HouseBehaviour', 'economy');

/**
 * The human bits this build acts on. Each is a reading of the original that names a mechanic the sim
 * has; the values are the engine's own bit positions, so an unread bit still round-trips.
 */
export const MISSION_BEHAVIOUR = {
  NEEDS_FROZEN: 1 << 0,
  /** Stands where it is left instead of drifting on the idle rungs. */
  STAYS_PUT: 1 << 1,
  /** Acquires no target of its own and never flees. */
  PASSIVE: 1 << 2,
  INVULNERABLE: 1 << 3,
  /** Beyond the player's orders; its own seat's AI still commands it. */
  NOT_CONTROLLABLE: 1 << 5,
  JOB_LOCKED: 1 << 6,
  /** The import marker `SetImportHumanFlag` writes; drawn on the human, no rule reads it. */
  IMPORTED: 1 << 7,
  /** Earns no experience for the work it does. */
  NO_JOB_EXPERIENCE: 1 << 11,
  /** Walks at half pace. */
  WALKS_SLOWLY: 1 << 9,
  /** Walks faster than its trade would. */
  WALKS_FAST: 1 << 17,
} as const;

/** The house bits this build acts on; bit 0 is the only one with a located reader. */
export const HOUSE_BEHAVIOUR = {
  /** Ignores weapon hits and script damage alike. */
  INDESTRUCTIBLE: 1 << 0,
} as const;

/** Stamps nothing for 0, the value a placement column writes for "no flags". Normalised like a script
 *  write, so one mask hashes the same whichever half of the join delivered it. */
export function stampMissionBehaviour(world: World, e: Entity, flags: number | undefined): void {
  if (flags !== undefined && flags !== 0) world.add(e, MissionBehaviour, { flags: flags >>> 0 });
}

export function hasMissionBehaviour(world: World, e: Entity, bits: number): boolean {
  return ((world.tryGet(e, MissionBehaviour)?.flags ?? 0) & bits) !== 0;
}

export function hasHouseBehaviour(world: World, e: Entity, bits: number): boolean {
  return ((world.tryGet(e, HouseBehaviour)?.flags ?? 0) & bits) !== 0;
}

/** Set or clear `mask` on a human. An emptied mask drops the component, so a script that gives a bit
 *  and takes it back leaves the world it found. */
export function setMissionBehaviour(world: World, e: Entity, mask: number, on: boolean): void {
  writeFlags(world, e, MissionBehaviour, mask, on);
}

export function setHouseBehaviour(world: World, e: Entity, mask: number, on: boolean): void {
  writeFlags(world, e, HouseBehaviour, mask, on);
}

function writeFlags(
  world: World,
  e: Entity,
  component: Component<{ flags: number }>,
  mask: number,
  on: boolean,
): void {
  const before = world.tryGet(e, component)?.flags ?? 0;
  // `>>> 0` keeps bit 31 out of the negative range the bitwise operators would leave it in.
  const after = (on ? before | mask : before & ~mask) >>> 0;
  if (after === before) return; // re-adding would bump the store generation for nothing
  if (after === 0) world.remove(e, component);
  else world.add(e, component, { flags: after });
}
