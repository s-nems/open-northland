import { HuntFocus, Owner } from '../../../components/index.js';
import { ownerOf } from '../../../components/ownership.js';
import type { Entity, World } from '../../../ecs/world.js';

/** How many hunters hold each prey animal, split by the holder's owner so a lookup sums only the holders
 *  on the seeker's side. Keyed on every write to the two stores it reads: a hold stamped or dropped, or a
 *  holder changing hands, rebuilds it, so a hold stamped earlier the same tick is always seen. */
interface PreyHolds {
  readonly huntFocusMembers: number;
  readonly huntFocusValues: number;
  readonly ownerMembers: number;
  readonly ownerValues: number;
  readonly all: Map<Entity, number>;
  readonly byOwner: Map<number, Map<Entity, number>>;
  readonly neutral: Map<Entity, number>;
}

const preyHoldsByWorld = new WeakMap<World, PreyHolds>();

function countHold(counts: Map<Entity, number>, target: Entity): void {
  counts.set(target, (counts.get(target) ?? 0) + 1);
}

function preyHolds(world: World): PreyHolds {
  const huntFocusMembers = world.componentGeneration(HuntFocus);
  const huntFocusValues = world.componentValueGeneration(HuntFocus);
  const ownerMembers = world.componentGeneration(Owner);
  const ownerValues = world.componentValueGeneration(Owner);
  const cached = preyHoldsByWorld.get(world);
  if (
    cached !== undefined &&
    cached.huntFocusMembers === huntFocusMembers &&
    cached.huntFocusValues === huntFocusValues &&
    cached.ownerMembers === ownerMembers &&
    cached.ownerValues === ownerValues
  ) {
    return cached;
  }
  const holds: PreyHolds = {
    huntFocusMembers,
    huntFocusValues,
    ownerMembers,
    ownerValues,
    all: new Map(),
    byOwner: new Map(),
    neutral: new Map(),
  };
  for (const holder of world.query(HuntFocus)) {
    const target = world.get(holder, HuntFocus).target;
    countHold(holds.all, target);
    const owner = ownerOf(world, holder);
    if (owner === undefined) {
      countHold(holds.neutral, target);
      continue;
    }
    let owned = holds.byOwner.get(owner);
    if (owned === undefined) {
      owned = new Map();
      holds.byOwner.set(owner, owned);
    }
    countHold(owned, target);
  }
  preyHoldsByWorld.set(world, holds);
  return holds;
}

/**
 * Whether a fellow hunter of `self`'s player is committed to `target` right now - the candidate test of
 * the one-hunter-per-animal rule (authored), so two hunters sharing a ground split the herd. A rival
 * player's hold does not count: contested game stays contested. A neutral holder or seeker is on every
 * side (`ownersCompatible`).
 */
export function preyHeldByOthers(world: World, self: Entity): (target: Entity) => boolean {
  const holds = preyHolds(world);
  const mine = ownerOf(world, self);
  const own = world.tryGet(self, HuntFocus)?.target;
  const owned = mine === undefined ? undefined : holds.byOwner.get(mine);
  return (target) => {
    const holders =
      mine === undefined
        ? (holds.all.get(target) ?? 0)
        : (owned?.get(target) ?? 0) + (holds.neutral.get(target) ?? 0);
    return holders > (own === target ? 1 : 0);
  };
}
