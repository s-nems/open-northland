import { Vehicle } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { vehicleAnchor } from './vehicle-footprint.js';

// Where the vehicles stand, as a per-world revision the placement-blocker version keys on. A drive writes
// `Vehicle` every leg (facing, task, seats), so its value generation churns while any vehicle moves; this
// revision moves only when a vehicle's anchor or type changes, the inputs of its blocker cells. Derived
// state, never hashed: an absolute value means nothing across worlds, only a change does.

interface AnchorMemo {
  valueGeneration: number;
  membershipGeneration: number;
  /** Each vehicle's {@link vehicleCellsKey} as of the revision. */
  readonly keys: Map<Entity, string>;
  revision: number;
}

const memoByWorld = new WeakMap<World, AnchorMemo>();

/** What a vehicle's blocker cells are a function of: its anchor and its type (a harnessed cart changes
 *  type in place). Null for a vehicle off the map or gone. */
export function vehicleCellsKey(world: World, e: Entity): string | null {
  const vehicle = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (vehicle === undefined || anchor === null) return null;
  return `${anchor.hx},${anchor.hy},${vehicle.vehicleType}`;
}

/** Re-key `e`; true when its cells key changed. */
function resync(world: World, memo: AnchorMemo, e: Entity): boolean {
  const live = vehicleCellsKey(world, e);
  const held = memo.keys.get(e) ?? null;
  if (live === held) return false;
  if (live === null) memo.keys.delete(e);
  else memo.keys.set(e, live);
  return true;
}

/** Re-key every held and every live vehicle; true when any key changed. */
function resyncAll(world: World, memo: AnchorMemo): boolean {
  let moved = false;
  for (const e of [...memo.keys.keys()]) if (resync(world, memo, e)) moved = true;
  for (const e of world.canonicalQuery(Vehicle)) if (resync(world, memo, e)) moved = true;
  return moved;
}

/**
 * The revision of the vehicles' anchors and types: unchanged across a tick in which no vehicle entered a
 * node, left the map or changed type. A vehicle's cells move only through a `World.mut(e, Vehicle)` write
 * (the mover writes its facing on every node it enters), so the value-write journal narrows a bump to the
 * written vehicles; a membership change or a journal gap re-keys them all.
 */
export function vehicleAnchorRevision(world: World): number {
  const valueGeneration = world.componentValueGeneration(Vehicle);
  const membershipGeneration = world.componentGeneration(Vehicle);
  const memo = memoByWorld.get(world);
  if (memo === undefined) {
    world.journalValueWrites(Vehicle);
    const fresh: AnchorMemo = { valueGeneration, membershipGeneration, keys: new Map(), revision: 0 };
    resyncAll(world, fresh);
    memoByWorld.set(world, fresh);
    return fresh.revision;
  }
  if (memo.valueGeneration === valueGeneration && memo.membershipGeneration === membershipGeneration) {
    return memo.revision;
  }
  const written =
    memo.membershipGeneration === membershipGeneration
      ? world.valueWritesSince(Vehicle, memo.valueGeneration)
      : null;
  let moved = false;
  if (written === null) moved = resyncAll(world, memo);
  else for (const e of written) if (resync(world, memo, e)) moved = true;
  memo.valueGeneration = valueGeneration;
  memo.membershipGeneration = membershipGeneration;
  if (moved) memo.revision++;
  return memo.revision;
}
