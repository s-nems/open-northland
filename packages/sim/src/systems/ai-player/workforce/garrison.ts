import {
  AssistantRecruit,
  aiModuleRuns,
  Building,
  Equipment,
  Female,
  Owner,
  ownerOf,
  Settler,
  TrainingOrder,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import { draftableTrade } from '../../assistant/index.js';
import type { SystemContext } from '../../context.js';
import { isMarried, mayMarry } from '../../family/eligibility.js';
import { baseSoldierJobType, isBarracks } from '../../readviews/index.js';
import { assistantCounterCommand, ownedSettlers } from '../shared.js';
import type { SpareForce } from './pool.js';

/**
 * The garrison sizing: the seat trains through the settlement assistant (user rule 2026-08-02) -
 * this rung keeps the `trainSoldiers` counter at the number of men the settlement can spare, and the
 * dispatcher (`systems/assistant/`) drafts, walks and drills them. The more free civilians, the
 * larger the standing order; the AI hand-picks no recruit. A disabled `military` toggle publishes
 * zero, so the assistant stops with the module; only an HQ loss freezes the standing counter (the
 * whole workforce ladder stops deciding upstream).
 *
 * The army has no size cap (user rule: as many soldiers as the settlement can raise). Its real bound
 * is the breeding engine that grows the next recruits: a fighter neither marries nor fathers
 * children, and the conversion is one-way, so the target counts only UNMARRIED spare men, capped by
 * the bachelor surplus beyond the seat's waiting brides ({@link bachelorSurplus}). The dispatcher
 * drafts unmarried men first, so a want sized to the free bachelors never reaches a husband - the
 * old hand-pick's family-line guarantee, kept through the counter.
 *
 * Runs last in the workforce ladder: the target counts only the draft-shaped men (the dispatcher's
 * own {@link draftableTrade} rule) left unclaimed by every post, reserve and flag, plus the recruits
 * already booked in flight (a counter's value counts everything still unproduced - each draft moves
 * one man from free to booked, so the published value is stable while the queue works). Outflow
 * pacing is the assistant's trickle brake, no longer one man per decision.
 */
export function trainGarrison(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
): Command[] {
  const target = aiModuleRuns(world, player, 'military') ? garrisonTarget(world, ctx, player, force) : 0;
  const command = assistantCounterCommand(world, player, 'trainSoldiers', target, false);
  return command === null ? [] : [command];
}

/** The wanted `trainSoldiers` value: spare free bachelors capped by the bachelor surplus, plus the
 *  in-flight bookings; zero when the content has no soldier class or the seat no barracks. */
function garrisonTarget(world: World, ctx: SystemContext, player: number, force: SpareForce): number {
  if (baseSoldierJobType(ctx.content) === null) return 0; // no soldier class to enlist into
  if (!hasBarracks(world, ctx, player)) return 0;
  const surplus = Math.max(0, bachelorSurplus(world, ctx, player));
  const free = force.remaining().filter((e) => {
    if (!draftableTrade(world.get(e, Settler).jobType) || isMarried(world, e)) return false;
    // A man wearing a weapon good (a manual civilian equip) is persistently undraftable - counting
    // him would leave the published want standing unfillable.
    return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
  }).length;
  return Math.min(free, surplus) + bookedRecruits(world, player);
}

/** Whether the seat owns any standing barracks - existence only, so no canonical sort is paid. */
function hasBarracks(world: World, ctx: SystemContext, player: number): boolean {
  for (const e of world.query(Building, Owner)) {
    if (ownerOf(world, e) === player && isBarracks(world, ctx, e)) return true;
  }
  return false;
}

/** The seat's marriageable men beyond its marriageable women, the men the family plan will never
 *  need as husbands. {@link mayMarry} decides both sides (it already rejects a recruit committed to
 *  a drill) but judges a settler alone, so the count must come from {@link ownedSettlers}: claimed
 *  livestock is an owned `Settler` with no `Female` and reads as a marriageable bachelor, and each
 *  head would license one more draft out of the men the brides are waiting for. */
function bachelorSurplus(world: World, ctx: SystemContext, player: number): number {
  let surplus = 0;
  for (const e of ownedSettlers(world, player)) {
    if (!mayMarry(world, ctx.content, e)) continue;
    surplus += world.has(e, Female) ? -1 : 1;
  }
  return surplus;
}

/** The seat's in-flight plain-drill bookings - recruits the assistant dispatched for `trainSoldiers`
 *  and still drilling (enlistment pays the counter and drops the mark). A booking whose drill was
 *  abandoned (no `TrainingOrder` until the sweep clears it) is excluded: its man is back in the
 *  spare pool, and counting both sides would publish one recruit past the bachelor cap. */
function bookedRecruits(world: World, player: number): number {
  let booked = 0;
  for (const e of world.query(AssistantRecruit)) {
    if (ownerOf(world, e) !== player) continue;
    if (!world.has(e, TrainingOrder)) continue;
    if (world.get(e, AssistantRecruit).intent === 'trainSoldiers') booked++;
  }
  return booked;
}
