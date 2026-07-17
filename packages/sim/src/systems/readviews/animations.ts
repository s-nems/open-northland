import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';

// Pure, terminal read views over `content.atomicAnimations`. See ./index.ts for why read views are
// grouped here.

/**
 * The `atomicanimations.ini` `event <at> <type> <value>` channel ids — the numbered need bar a timed event
 * restores or drains; {@link atomicEventChannelDelta} looks them up. The wider `type` vocabulary
 * (sounds/cues/yields at ids 8..36) stays an undocumented render/effect channel space.
 *
 * source-basis: the original's own channel ids from the mod's readable `atomicanimations.ini`.
 */
export const ATOMIC_EVENT_CHANNEL = {
  /** Rest/fatigue bar — `..._sleep` animations restore it. */
  REST: 1,
  /** Hunger bar — `..._eat_slot_food` restores it. */
  HUNGER: 2,
  /** Leisure/enjoyment bar — `..._enjoy` and `..._make_love` restore it. */
  LEISURE: 3,
  /** Piety bar — `..._pray` restores it. */
  PIETY: 4,
} as const;

/**
 * The `event <at> <type>` type id marking the frame a swing's blow lands — a bare timing cue with no
 * magnitude (`event <at> 25`), so the CombatSystem resolves the hit at that frame rather than at animation
 * completion (a spear thrust connects at frame 17 of its 27-frame swing). {@link atomicEventFrame} reads it.
 *
 * source-basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_ATTACK` (l.745).
 */
export const ATOMIC_EVENT_TYPE_ATTACK = 25;

/**
 * The `event <at> <type>` type id marking the frame a swing plays its sound FX — a mid-animation timing cue
 * like {@link ATOMIC_EVENT_TYPE_ATTACK}, so the builder's hammer knock lands on the visual strike rather
 * than at completion. The AtomicSystem fires an `atomicSound` event at this frame; an animation with no such
 * event plays no mid-swing sound (a consumer may still sound its completion).
 *
 * source-basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX` (l.754).
 */
export const ATOMIC_EVENT_TYPE_PLAY_SOUND_FX = 34;

/**
 * Resolve an {@link AtomicAnimation} by its exact `name` — the join key a tribe's `setatomic <job> <atomic>
 * "anim"` binding references ({@link AtomicAnimation.name}, not the lowercased `id`). Returns `undefined`
 * for an unresolved name — expected, since the readable mod set is a subset of the base-game animations — so
 * callers fall back to a default duration. The {@link contentIndex} table is built first-wins over
 * declaration order.
 */
export function atomicAnimationByName(content: ContentSet, name: string): AtomicAnimation | undefined {
  return contentIndex(content).atomicAnimationsByName.get(name);
}

/** Duration (ticks) used when an atomic's animation-length chain doesn't resolve — a non-zero default
 *  so an unresolved atomic still takes visible time rather than completing instantly. */
const DEFAULT_ATOMIC_DURATION = 4;

/**
 * Resolve an atomic's duration (animation length in ticks) through the data: the settler's tribe binds
 * `(jobType, atomicId)` to an animation name (`setatomic`, last-wins) and `atomicAnimations` gives that
 * name's `length`. Falls back to {@link DEFAULT_ATOMIC_DURATION} when the chain doesn't resolve — a missing
 * timing must not hang or zero-out the atomic.
 */
export function atomicDuration(content: ContentSet, settler: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(content, atomicAnimationName(content, settler, atomicId));
}

/**
 * The duration (ticks) of a named animation — its `atomicanimations.ini` `length`, or
 * {@link DEFAULT_ATOMIC_DURATION} when the name is undefined / unresolved / zero-length. The name-keyed half
 * of {@link atomicDuration}, for a caller that already resolved the animation name.
 */
export function atomicDurationForName(content: ContentSet, animation: string | undefined): number {
  if (animation === undefined) return DEFAULT_ATOMIC_DURATION;
  const length = atomicAnimationByName(content, animation)?.length ?? 0;
  return length > 0 ? length : DEFAULT_ATOMIC_DURATION;
}

/**
 * Resolve the animation name a settler's tribe binds `(jobType, atomicId)` to — the `setatomic` join key,
 * last-wins over the file-order bindings (matching the original's config-override semantics, the rule the
 * {@link contentIndex} binding table is built with). Returns `undefined` when the settler has no job, its
 * tribe isn't in content, or no binding matches.
 */
export function atomicAnimationName(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): string | undefined {
  if (settler.jobType === null) return undefined;
  return contentIndex(content).atomicBindingsByTribe.get(settler.tribe)?.get(settler.jobType)?.get(atomicId);
}

/**
 * Whether the named atomic animation may be interrupted mid-play (`atomicanimations.ini` `interruptable 1`) —
 * an idle/walk a settler can abandon the instant a higher-priority drive fires, versus a harvest swing or
 * attack that must play to completion. Returns `false` for an unknown name, the safe default that never
 * preempts work with no timing record.
 */
export function isInterruptibleAtomic(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.interruptible ?? false;
}

/**
 * The initial facing-direction index the named atomic animation pins (`atomicanimations.ini`
 * `startdirection`), or `undefined` when it pins none (only ~10% of base animations carry one) — the original
 * orients a settler by it at the start of a directional atomic (a chop facing the tree). Carries `undefined`
 * through rather than coercing to `0` ("north") because "no pinned facing" is distinct from "face north".
 */
export function atomicStartDirection(content: ContentSet, name: string): number | undefined {
  return atomicAnimationByName(content, name)?.startDirection;
}

/**
 * The net signed delta the named atomic animation contributes to one event `channel` — the sum of
 * `event.value` over every `event`/`eventx` whose `type` equals `channel` (see
 * {@link ATOMIC_EVENT_CHANNEL}). A restoring animation totals positive (`..._eat_slot_food` over `HUNGER` =
 * `+4000`), a draining one negative. Returns `0` for an unknown name, for an animation with no event on that
 * channel, and for a bare `event <at> <type>` cue carrying no `value`.
 *
 * source-basis: the extracted `events` array, summing the original's own per-tick deltas.
 */
export function atomicEventChannelDelta(content: ContentSet, name: string, channel: number): number {
  const anim = atomicAnimationByName(content, name);
  if (anim === undefined) return 0;
  let total = 0;
  for (const event of anim.events) {
    if (event.type === channel) total += event.value ?? 0;
  }
  return total;
}

/**
 * Whether the named atomic animation carries any extended (`eventx`) event — the rare second event stream the
 * source spells with the `eventx` key instead of plain `event`. In the real data `eventx` lines bracket a
 * production run — the worker's rest/hunger bars draining while they labour, plus start/end markers —
 * clustered on `*_produce_*`, so this doubles as the "is this a producing animation that self-drains the
 * worker" marker. Returns `false` for an unknown name.
 */
export function atomicHasExtendedEvents(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.events.some((e) => e.extended) ?? false;
}

/**
 * The frame (`at`) of the named animation's first `event`/`eventx` of `eventType`, or `undefined` when the
 * animation carries none (or the name doesn't resolve) — the mid-animation timing cue behind
 * {@link ATOMIC_EVENT_TYPE_ATTACK}, whose consumers fall back to completion when there is no such event. The
 * first matching event wins, so an animation with several of the same type resolves to the earliest by
 * declaration order.
 */
export function atomicEventFrame(content: ContentSet, name: string, eventType: number): number | undefined {
  const anim = atomicAnimationByName(content, name);
  if (anim === undefined) return undefined;
  for (const event of anim.events) {
    if (event.type === eventType) return event.at;
  }
  return undefined;
}
