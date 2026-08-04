import {
  Health,
  HerdMember,
  Livestock,
  MoveSpeed,
  Position,
  Settler,
  StayPoint,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { evictSettlerFromBlockedSpawn } from '../movement/evict.js';
import { animalHitpoints, herdParams, isCatchableAnimal, locomotionOf } from '../readviews/index.js';
import { COMPASS_DIRECTIONS, entityNode } from '../spatial/nodes.js';

/** Upper bound on one spawn command's herd size - the real `maximumgroupsize` values are 2..6, so any
 *  count near this cap is corrupted input, not content. */
const HERD_COUNT_CAP = 100;

/**
 * Spawn a herd of an animal tribe around a birth point: `max(1, maximumgroupsize)` creatures, or the
 * command's clamped `count` override, each a {@link Settler} of the animal `tribe` at `jobType: null`
 * carrying its `hitpoints_adult` pool. Members scatter around (x,y) within `maximumdistancetobirthpoint`,
 * and an animal with `searchforleader` records the herd's lowest-id member as every member's
 * {@link HerdMember} leader. A tribe with no `animaltypes` record is bad input.
 *
 * Source basis: group size, HP pool, birth-point range, leader presence, and `movespeed` are the verbatim
 * extracted `animaltypes.ini` params. `runspeed` is deliberately not consumed, since no run gait exists.
 *
 * Approximations: the scatter pattern, pushing a member off blocked ground, spawning adult at
 * `jobType: null` with no weapon binding, the one-shot placement with no respawn or territory upkeep, and
 * reading `movespeed` as a step period so a larger value walks slower, which is the only direction
 * consistent with the source's `runspeed < movespeed`.
 *
 * Determinism: the leader is the herd's lowest-id member, the scatter offsets are a fixed function of the
 * member index, and the content reads are pure.
 */
export function spawnAnimalHerd(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnAnimalHerd' }>,
): void {
  const herd = herdParams(ctx.content, command.tribe);
  if (herd === null) return; // not an animal tribe (a civilization / unknown) - bad input, skip
  const hitpoints = animalHitpoints(ctx.content, command.tribe) ?? 0; // an animal record always has both
  // A `hitpoints 0` record (the real butterflies, bees, and mosquitos) is a decorative swarm rather than a
  // creature, and a living Settler minted from one would be born dead and reaped the same tick.
  // Approximation: no swarm-effect layer exists yet.
  if (hitpoints <= 0) return;

  // `movespeed` N walks ONE/N tile per tick; a record omitting it walks at the universal settler default.
  const locomotion = locomotionOf(ctx.content, command.tribe);
  const walkSpeed = locomotion?.walkSpeed ?? 0;
  const movePace = walkSpeed > 0 ? fx.div(ONE, fx.fromInt(walkSpeed)) : null;

  // A solitary group still yields one creature, and the floor plus cap keep a malformed external count
  // (fractional, negative, absurd) from minting a map of creatures in one tick.
  const count = Math.min(HERD_COUNT_CAP, Math.max(1, Math.floor(command.count ?? herd.maxGroupSize)));
  const range = Math.max(0, herd.birthPointRange);
  const members: Entity[] = [];
  // One claim set across the herd: each member records its final node, so neither a push nor a
  // radius-clamped scatter ends two members on one cell - animals have no de-stacking drive.
  const claimed = new Set<NodeId>();
  for (let i = 0; i < count; i++) {
    const off = herdMemberOffset(i, range);
    const e = world.create();
    world.add(e, Position, positionOfNode(command.x + off.dx, command.y + off.dy));
    world.add(e, Settler, {
      tribe: command.tribe,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    world.add(e, Health, { hitpoints, max: hitpoints });
    // The marker mirrors the content flag so the husbandry systems query this small store rather than the
    // whole population.
    if (isCatchableAnimal(ctx.content, command.tribe)) world.add(e, Livestock, {});
    if (movePace !== null) world.add(e, MoveSpeed, { perTick: movePace });
    // The birth point or a scatter offset may name blocked or already-taken ground, and no drive ever
    // re-tasks an idle animal off a blocked cell, so the push has to happen here.
    evictSettlerFromBlockedSpawn(world, ctx, e, claimed);
    // The territory anchor is read after the push, so a creature moved off blocked ground anchors where it
    // ends up standing.
    if (ctx.terrain !== undefined) {
      world.add(e, StayPoint, { cell: entityNode(world, ctx.terrain, e) });
    }
    members.push(e);
    ctx.events.emit({ kind: 'settlerBorn', entity: e });
  }

  // `members[0]` is the lowest-id member because `create()` ids are monotonic; the leader points at itself.
  if (herd.searchForLeader) {
    const leader = members[0];
    if (leader !== undefined) for (const e of members) world.add(e, HerdMember, { leader });
  }
}

/**
 * The deterministic tile offset for the `i`-th member of a herd, kept within `range` of the birth point.
 * Member 0 lands on the birth point and the rest spiral out along an expanding 8-direction ring whose radius
 * is clamped at `range`, a fixed function of `(i, range)` with no RNG.
 *
 * Past 9 members, or with `range` 0, the clamp re-uses ring directions and two members can be offset onto
 * the same tile; real `maximumgroupsize` values (3..6) never reach that, and the spawn's claim set fans the
 * later one aside. This is an approximated placement, not a packing guarantee.
 */
function herdMemberOffset(i: number, range: number): { dx: number; dy: number } {
  if (i === 0 || range <= 0) return { dx: 0, dy: 0 }; // the first (leader) sits on the birth point
  // COMPASS_DIRECTIONS is in a fixed canonical order, so the scatter reproduces exactly.
  const ring = Math.floor((i - 1) / COMPASS_DIRECTIONS.length) + 1; // 1, 2, 3, … as the rings fill
  const dir = COMPASS_DIRECTIONS[(i - 1) % COMPASS_DIRECTIONS.length];
  if (dir === undefined) return { dx: 0, dy: 0 }; // unreachable: a modulo index is always in range
  const radius = Math.min(ring, range); // never past the birth-point range
  return { dx: dir[0] * radius, dy: dir[1] * radius };
}
