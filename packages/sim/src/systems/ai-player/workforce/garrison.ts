import {
  ASSISTANT_COUNTER_MAX,
  AssistantRecruit,
  aiModuleRuns,
  Female,
  Owner,
  ownerOf,
  Settler,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { mayMarry } from '../../family/eligibility.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { baseSoldierJobType, isBarracks } from '../../readviews/index.js';
import { assistantCounterCommand, ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';

/**
 * The garrison sizing: the seat trains through the settlement assistant (user rule 2026-08-02) -
 * this rung keeps the `trainSoldiers` counter at the number of men the settlement can spare, and the
 * dispatcher (`systems/assistant/`) drafts, walks and drills them. The more free civilians, the
 * larger the standing order; the AI hand-picks no recruit.
 *
 * The army has no size cap (user rule: as many soldiers as the settlement can raise). Its real bound
 * is the breeding engine that grows the next recruits: a fighter neither marries nor fathers
 * children, and the conversion is one-way, so the target is capped by the bachelor surplus beyond
 * the seat's waiting brides ({@link bachelorSurplus}) - in aggregate, every family line keeps a
 * husband. Named approximation: the dispatcher picks free men in canonical order, not bachelors
 * first, so WHICH man drills can differ from the old hand-pick; the cap bounds how many go.
 *
 * Runs last in the workforce ladder: the target counts only the draft-shaped men (civilist or
 * trade-less - the assistant's own free-man rule) left unclaimed by every post, reserve and flag,
 * plus the recruits already booked in flight (a counter's value counts everything still
 * unproduced). Outflow pacing is the assistant's trickle brake, no longer one man per decision.
 * The seat's `military` HAI toggle gates the rung.
 */
export function trainGarrison(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
): Command[] {
  if (!aiModuleRuns(world, player, 'military')) return [];
  const target = garrisonTarget(world, ctx, player, force);
  const command = assistantCounterCommand(world, player, 'trainSoldiers', target, false);
  return command === null ? [] : [command];
}

/** The wanted `trainSoldiers` value: spare free civilians capped by the bachelor surplus, plus the
 *  in-flight bookings; zero when the content has no soldier class or the seat no barracks. */
function garrisonTarget(world: World, ctx: SystemContext, player: number, force: SpareForce): number {
  if (baseSoldierJobType(ctx.content) === null) return 0; // no soldier class to enlist into
  if (!ownedBuildings(world, player).some((e) => isBarracks(world, ctx, e))) return 0;
  const surplus = Math.max(0, bachelorSurplus(world, ctx, player));
  const free = force.remaining().filter((e) => {
    const job = world.get(e, Settler).jobType;
    return job === CIVILIST_JOB || job === null;
  }).length;
  return Math.min(ASSISTANT_COUNTER_MAX, Math.min(free, surplus) + bookedRecruits(world, player));
}

/** The seat's marriageable men beyond its marriageable women - the men the family plan will never
 *  need as husbands. {@link mayMarry} decides both sides (it already rejects a recruit committed to
 *  a drill). A commutative sum, so it walks store order rather than paying for a canonical sort it
 *  cannot observe. */
function bachelorSurplus(world: World, ctx: SystemContext, player: number): number {
  let surplus = 0;
  for (const e of world.query(Settler, Owner)) {
    if (ownerOf(world, e) !== player) continue;
    if (!mayMarry(world, ctx.content, e)) continue;
    surplus += world.has(e, Female) ? -1 : 1;
  }
  return surplus;
}

/** The seat's in-flight plain-drill bookings - recruits the assistant already dispatched for
 *  `trainSoldiers` but has not enlisted yet (enlistment pays the counter and drops the mark). */
function bookedRecruits(world: World, player: number): number {
  let booked = 0;
  for (const e of world.query(AssistantRecruit)) {
    if (ownerOf(world, e) !== player) continue;
    if (world.get(e, AssistantRecruit).intent === 'trainSoldiers') booked++;
  }
  return booked;
}
