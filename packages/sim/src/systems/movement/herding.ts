import {
  CurrentAtomic,
  HerdMember,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Settler,
} from '../../components/index.js';
import type { System } from '../context.js';
import { herdParams } from '../readviews/index.js';
import { entityCell, manhattan } from '../spatial.js';

/**
 * HerdingSystem — the **follow-the-leader** movement drive for a herding animal.
 *
 * A herd animal that `searchforleader`s carries a {@link HerdMember} pointing at its pack's leader
 * (set once at spawn by the `spawnAnimalHerd` command — the lowest-id member, which points at
 * **itself**). This system keeps the pack together: an idle **follower** that has wandered farther
 * than its `animaltypes.ini` `maximumleaderdistance` from its leader is sent back, walking toward the
 * leader's current cell via the same {@link MoveGoal}→{@link PathRequest}→{@link PathFollow} chain a
 * settler uses (the AI navigation planner turns the goal into a route, MovementSystem walks it). The
 * **leader itself** (`HerdMember.leader === self`) runs no follow drive — it has no one to trail — and
 * a **solitary** animal carries no `HerdMember` at all, so it is never visited. This consumes the
 * `HerdMember` relation the spawn slice only *recorded*, closing the spawn row's "no system reads it
 * yet" gap.
 *
 * A follower is moved only when **idle and at rest**: no {@link CurrentAtomic} running (don't yank a
 * creature out of an attack swing) and not already travelling (no {@link MoveGoal}/{@link PathRequest}/
 * {@link PathFollow} — it is already heading somewhere; re-issuing would fight the planner). So a
 * fighting or already-returning animal is left alone; cohesion is the **idle-default** behaviour, the
 * same precedence the AI planner gives travel.
 *
 * source-basis: the **cohesion radius** is the verbatim extracted `animaltypes.ini` `maximumleaderdistance`
 * param (faithful — *how far* a follower may stray). **Approximated (no oracle):** that a strayed
 * follower walks straight back **to the leader's cell** (the original's herd-cohesion AI — flocking
 * offsets, formation, wander-while-near — is the undocumented "soul"); a `maximumleaderdistance` of 0
 * means "stay on the leader's cell", the literal reading of the param. Recorded in source basis.
 *
 * Determinism: no RNG, no wall-clock. Followers are visited in deterministic store order (the
 * `aiSystem` pattern), and each follower's decision is a pure function of **its own** components + its
 * leader's cell — no follower's outcome depends on another's, so the store-iteration order can't change
 * the result (the only mutation is adding a `MoveGoal` to the follower itself, never to the iterated
 * `HerdMember` store). The leader's cell and the distance are integer reads; the `MoveGoal` add is a
 * no-op for a follower already in range (none is added). No-ops without a terrain graph (a mapless sim
 * has no cells to measure leader distance over — the golden is untouched). Inert on the goldens/slice:
 * no entity there carries a `HerdMember`, so the follower scan finds nobody.
 */
export const herdingSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure leader distance over
  const terrain = ctx.terrain;
  for (const e of world.query(HerdMember, Settler, Position)) {
    const leader = world.get(e, HerdMember).leader;
    if (leader === e) continue; // the leader follows no one
    // Busy / already travelling: leave it (don't interrupt a swing or fight the navigation planner).
    if (world.has(e, CurrentAtomic)) continue;
    if (world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow)) continue;
    // A leader that has been reaped (killed in combat) is gone — its components are removed, so a
    // follower has no cell to return to; leave it where it stands (the herd is leaderless until a
    // later slice re-designates one).
    if (!world.has(leader, Position)) continue;

    const range = herdParams(ctx.content, world.get(e, Settler).tribe)?.leaderDistance ?? 0;
    const here = entityCell(world, terrain, e);
    const leaderCell = entityCell(world, terrain, leader);
    if (manhattan(terrain, here, leaderCell) <= range) continue; // close enough — stay put

    world.add(e, MoveGoal, { cell: leaderCell }); // strayed too far — head back to the leader
  }
};
