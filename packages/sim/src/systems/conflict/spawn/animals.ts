import { Health, HerdMember, MoveSpeed, Position, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { animalHitpoints, herdParams, locomotionOf } from '../../readviews/index.js';
import { COMPASS_DIRECTIONS } from '../../spatial.js';

/**
 * Spawn a herd of an animal tribe around a birth point — put a group of creatures on the map, consuming the
 * {@link herdParams}/{@link animalHitpoints} read views.
 *
 * The herd is `max(1, maximumgroupsize)` creatures (a 0/solitary group still yields one), each a
 * {@link Settler} of the animal `tribe` (animals reuse the same entity/AI model as a settler) at
 * `jobType: null` carrying a {@link Health} pool stamped from its `hitpoints_adult` ({@link animalHitpoints}).
 * The creatures are scattered around (x,y) within `maximumdistancetobirthpoint` by a deterministic offset
 * ({@link herdMemberOffset} — an expanding 8-direction ring, no RNG), so a herd spreads out instead of stacking
 * on one tile. When the animal's `searchforleader` is set the herd gets a leader — its lowest-id member, which
 * every member (including the leader, self-referentially) records via a {@link HerdMember} — the relation the
 * follow-the-leader drive (`herdingSystem`) reads to keep a strayed follower within `maximumleaderdistance`; a
 * solitary animal carries no `HerdMember`.
 *
 * A `tribe` with no `animaltypes` record (a civilization, or an unknown tribe) is bad input — no herd params to
 * read — so the command is skipped (still logged for faithful replay).
 *
 * Source basis: the group size, HP pool, birth-point range, leader presence, and walking-pace magnitude
 * (`movespeed`) are the verbatim extracted `animaltypes.ini` params (faithful). A creature with an explicit
 * `movespeed` gets a {@link MoveSpeed}{`perTick = ONE/movespeed`} (a larger `movespeed` walks a slower step);
 * one whose record omits it carries no `MoveSpeed` and walks at the universal settler default. The `runspeed`
 * param is deliberately not consumed — no run/sprint gait exists.
 * Approximated (no oracle): the scatter pattern, that animals spawn at `jobType: null` (so no weapon yet — the
 * animal→weapon `(tribeType, typeId)` binding is a deferred refinement), that the spawn is a one-shot placement
 * with no respawn/territory upkeep, and the direction of the `movespeed` scale (larger = slower — the
 * step-period reading, the only one consistent with the source's `runspeed < movespeed`). No births→growth
 * here: an animal is spawned adult (carries no {@link Age}); the spawn cadence / map populator is a later slice.
 *
 * Determinism: the leader is the herd's lowest-id member (creation is monotonic — a canonical pick), the
 * scatter offsets are a fixed function of the member index, and `animalHitpoints`/`herdParams` are pure content
 * reads.
 */
export function spawnAnimalHerd(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnAnimalHerd' }>,
): void {
  const herd = herdParams(ctx.content, command.tribe);
  if (herd === null) return; // not an animal tribe (a civilization / unknown) — bad input, skip
  const hitpoints = animalHitpoints(ctx.content, command.tribe) ?? 0; // an animal record always has both

  // The animal's data-pinned pace: `movespeed` N → ONE/N tile/tick (see the movespeed note above). A record
  // omitting it (walkSpeed 0) stamps no MoveSpeed and walks at the universal settler default.
  const locomotion = locomotionOf(ctx.content, command.tribe);
  const walkSpeed = locomotion?.walkSpeed ?? 0;
  const movePace = walkSpeed > 0 ? fx.div(ONE, fx.fromInt(walkSpeed)) : null;

  const count = Math.max(1, herd.maxGroupSize); // a 0/solitary group still yields one creature
  const range = Math.max(0, herd.birthPointRange);
  const members: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const off = herdMemberOffset(i, range);
    const e = world.create();
    world.add(e, Position, positionOfNode(command.x + off.dx, command.y + off.dy));
    world.add(e, Settler, {
      tribe: command.tribe,
      jobType: null, // an animal isn't born into a trade (no weapon binding yet — see fidelity note)
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map<number, number>(),
    });
    world.add(e, Health, { hitpoints, max: hitpoints });
    if (movePace !== null) world.add(e, MoveSpeed, { perTick: movePace });
    members.push(e);
    ctx.events.emit({ kind: 'settlerBorn', entity: e });
  }

  // A herd whose animal seeks a leader gets one: the lowest-id member (members[0], `create()` ids being
  // monotonic), recorded on every member via HerdMember (the leader points at itself).
  if (herd.searchForLeader) {
    const leader = members[0];
    if (leader !== undefined) for (const e of members) world.add(e, HerdMember, { leader });
  }
}

/**
 * The deterministic (no-RNG) tile offset for the `i`-th member of a herd, kept within `range` of the birth
 * point. Member 0 lands on the birth point; the rest spiral out along an expanding 8-direction ring, the radius
 * growing each time the 8 directions are exhausted and clamped at `range`. A fixed function of `(i, range)`, so
 * the same herd command always scatters identically.
 *
 * Distinct tiles hold up to 9 members (the centre + 8 first-ring directions) given `range >= 1`; beyond that —
 * or with `range` 0 — the radius clamp re-uses ring directions, so two creatures can land on the same tile.
 * That is harmless (the sim has no position-uniqueness invariant) and never reached by real data
 * (`maximumgroupsize` is 3..6); the scatter is an approximated placement (source basis), not a packing guarantee.
 */
function herdMemberOffset(i: number, range: number): { dx: number; dy: number } {
  if (i === 0 || range <= 0) return { dx: 0, dy: 0 }; // the first (leader) sits on the birth point
  // The shared 8-compass-direction ring (spatial.ts), in its fixed canonical order. Ring `r`
  // (1-based) places up to 8 members at radius `min(r, range)`; member index within the ring picks
  // the direction.
  const ring = Math.floor((i - 1) / COMPASS_DIRECTIONS.length) + 1; // 1, 2, 3, … as the rings fill
  const dir = COMPASS_DIRECTIONS[(i - 1) % COMPASS_DIRECTIONS.length];
  if (dir === undefined) return { dx: 0, dy: 0 }; // unreachable: a modulo index is always in range
  const radius = Math.min(ring, range); // never past the birth-point range
  return { dx: dir[0] * radius, dy: dir[1] * radius };
}
