import { Health, HerdMember, MoveSpeed, Position, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { animalHitpoints, herdParams, locomotionOf } from '../../readviews/index.js';
import { COMPASS_DIRECTIONS } from '../../spatial.js';

/**
 * Spawn a **herd of an animal tribe** around a birth point — the animal-placement mechanic the plan
 * Phase-4 "animals as non-controllable tribes" item names: it actually puts a group of creatures on the
 * map, consuming the {@link herdParams}/{@link animalHitpoints} read views the previous slices landed.
 *
 * The herd is `max(1, maximumgroupsize)` creatures (`maximumgroupsize` 0 — a source-omitted/solitary
 * animal — still yields one), each a {@link Settler} of the animal `tribe` (animals reuse the **same
 * entity/AI model** as a settler — the plan requirement, not a bolt-on) at `jobType: null` (an animal
 * isn't born into a trade) carrying a {@link Health} pool stamped from its `hitpoints_adult`
 * ({@link animalHitpoints}). The creatures are scattered around (x,y) within `maximumdistancetobirthpoint`
 * by a **deterministic** offset ({@link herdMemberOffset} — an expanding 8-direction ring, no RNG), so a
 * herd spreads out instead of stacking on one tile, reproducibly. When the animal's `searchforleader` is
 * set the herd gets a **leader** — its lowest-id member (the first created), which every member (including
 * the leader, self-referentially) records via a {@link HerdMember} — the relation the follow-the-leader
 * movement drive (`herdingSystem`) reads to keep a strayed follower within `maximumleaderdistance`; a
 * solitary (`searchforleader` false) animal carries no `HerdMember`.
 *
 * A `tribe` with no `animaltypes` record (a civilization, or an unknown tribe) is bad input — there are
 * no herd params to read — so the command is skipped (still logged by commandSystem, so replay stays
 * faithful), the same recoverable-boundary-failure stance as an unknown building/job id.
 *
 * source-basis: the **group size**, **HP pool**, **birth-point range**, **leader presence**, and the
 * **walking/running-pace magnitudes** (`movespeed`/`runspeed`) are the verbatim extracted
 * `animaltypes.ini` params (faithful). A creature with an explicit `movespeed` gets a
 * {@link MoveSpeed}{`perTick = ONE/movespeed`} (a larger `movespeed` walks a *slower* step), so it grazes
 * at its own data-pinned pace; one whose record omits `movespeed` carries no `MoveSpeed` and walks at the
 * universal settler default. Its `runspeed` is stamped as the same view's `runPerTick` (`ONE/runspeed`,
 * the *faster* gait — a `runspeed` is always a smaller number than its `movespeed`). The movement
 * system reads it whenever an entity flees; the animal drive that would select that mode remains
 * outside this slice (source basis "Animal locomotion pace").
 * **Approximated (no oracle):** the *scatter pattern* (where within the range each creature lands), that
 * animals spawn at `jobType: null` (so they carry no weapon yet — the animal→weapon `(tribeType, typeId)`
 * binding is a deferred refinement), that the spawn is a one-shot placement with no respawn/territory
 * upkeep, and the **direction of the `movespeed` scale** (that a larger number is slower — the
 * step-period reading, the only reading consistent with `runspeed < movespeed`) — the original's herd-AI
 * is the undocumented "soul" (recorded in source basis). No births→growth here: an animal is spawned
 * adult (carries no {@link Age}); the per-tribe spawn cadence / map populator is a later slice.
 *
 * Determinism: the leader is the herd's lowest-id member (creation is monotonic, so the first `create()`
 * is the lowest id — a canonical pick), the scatter offsets are a fixed function of the member index, and
 * `animalHitpoints`/`herdParams` are pure content reads — no RNG, no wall-clock.
 */
export function spawnAnimalHerd(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnAnimalHerd' }>,
): void {
  const herd = herdParams(ctx.content, command.tribe);
  if (herd === null) return; // not an animal tribe (a civilization / unknown) — bad input, skip
  const hitpoints = animalHitpoints(ctx.content, command.tribe) ?? 0; // an animal record always has both

  // The animal's data-pinned locomotion paces: a `movespeed`/`runspeed` of N moves ONE/N tile/tick (a
  // larger speed value = a slower step — see source basis "Animal locomotion pace"). A record that
  // omits `movespeed` (walkSpeed 0) stamps NO MoveSpeed, so it walks at the universal settler default;
  // one that omits `runspeed` carries a null run pace (only its walk gait is known). The run pace is
  // available to the MovementSystem's fleeing gait; normal movement uses the walk pace, and no
  // animal drive selects the fleeing mode yet (source basis "Animal locomotion pace").
  // A record with a `runspeed` but NO `movespeed` would drop its run pace (no MoveSpeed is stamped at
  // all), but no real animal does that (0/35 — verified) and the run gait is meaningless without a base
  // walk pace to deviate from, so the walk-gait gate below is the right anchor.
  const locomotion = locomotionOf(ctx.content, command.tribe);
  const walkSpeed = locomotion?.walkSpeed ?? 0;
  const runSpeed = locomotion?.runSpeed ?? 0;
  const movePace = walkSpeed > 0 ? fx.div(ONE, fx.fromInt(walkSpeed)) : null;
  const runPace = runSpeed > 0 ? fx.div(ONE, fx.fromInt(runSpeed)) : null;

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
    // Stamp the data-pinned paces when the creature has an explicit walk gait: `perTick` walks it, and
    // `runPerTick` records its run gait for the deferred flee/charge drive (null if `runspeed` omitted).
    if (movePace !== null) world.add(e, MoveSpeed, { perTick: movePace, runPerTick: runPace });
    members.push(e);
    ctx.events.emit({ kind: 'settlerBorn', entity: e });
  }

  // A herd whose animal seeks a leader gets one: the lowest-id member (members[0] — `create()` ids are
  // monotonic, so the first is the lowest), which every member records via HerdMember (the leader points
  // at itself). A solitary (searchforleader false) animal carries no HerdMember.
  if (herd.searchForLeader) {
    const leader = members[0];
    if (leader !== undefined) for (const e of members) world.add(e, HerdMember, { leader });
  }
}

/**
 * The deterministic (no-RNG) tile offset for the `i`-th member of a herd, kept within `range` of the
 * birth point. Member 0 lands ON the birth point; the rest spiral out along an expanding 8-direction
 * ring (`(±r, ±r)` / axis steps), the radius growing each time the 8 directions are exhausted and
 * **clamped at `range`** so no creature strays past `maximumdistancetobirthpoint`. A fixed function of
 * `(i, range)`, so the same herd command always scatters identically — reproducible, hashable.
 *
 * Distinct tiles hold up to **9** members (the centre + 8 first-ring directions) given `range >= 1`;
 * beyond that — or with `range` 0 — the radius clamp re-uses ring directions, so two creatures can land
 * on the same tile. That is harmless (the sim places no position-uniqueness invariant — entities share
 * tiles freely) and never reached by real data (`animaltypes` `maximumgroupsize` is 3..6, well under 9);
 * the scatter is an explicitly *approximated* placement (source basis), not a packing guarantee.
 */
function herdMemberOffset(i: number, range: number): { dx: number; dy: number } {
  if (i === 0 || range <= 0) return { dx: 0, dy: 0 }; // the first (leader) sits on the birth point
  // The shared 8-compass-direction ring (spatial.ts), in its fixed canonical order. Ring `r`
  // (1-based) places up to 8 members at radius `min(r, range)`; member index within the ring picks
  // the direction.
  const DIRS = COMPASS_DIRECTIONS;
  const ring = Math.floor((i - 1) / DIRS.length) + 1; // 1, 2, 3, … as the rings fill
  const dir = DIRS[(i - 1) % DIRS.length] as readonly [number, number];
  const radius = Math.min(ring, range); // never past the birth-point range
  return { dx: dir[0] * radius, dy: dir[1] * radius };
}
