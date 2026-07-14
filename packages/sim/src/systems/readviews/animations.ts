import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';

// Pure, terminal read views for atomic animations — the canonical name→record resolver over
// `content.atomicAnimations`, accessors for the scalars no sim system reads directly (`interruptible`,
// `startDirection`), the per-channel net delta over `events`, and the `eventx`/`event` stream split
// (`extended`). The `length` scalar drives `atomicDuration` and the combat swing cadence
// (conflict/weapons.ts). See ./index.ts for why read views are grouped here.

/**
 * The `atomicanimations.ini` `event <at> <type> <value>` channel ids — the numbered need bar a timed event
 * restores or drains. Verified across the real IR (`..._eat_slot_food` carries `event 30 2 +4000`, `..._sleep`
 * `event <at> 1 +100`, `..._enjoy`/`..._make_love` `event <at> 3 +800`, `..._pray` `event <at> 4 +800`);
 * {@link atomicEventChannelDelta} looks them up. The wider `type` vocabulary (sounds/cues/yields at ids 8..36)
 * stays an undocumented render/effect channel space.
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
 * The `event <at> <type>` type id marking the frame a swing's blow lands. Unlike the
 * {@link ATOMIC_EVENT_CHANNEL} need-bar ids this is a bare timing cue with no magnitude (`event <at> 25`):
 * the frame the CombatSystem resolves the hit at rather than waiting for the whole animation (a spear thrust
 * connects at frame 17 of its 27-frame swing). {@link atomicEventFrame} reads it.
 *
 * source-basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_ATTACK` (l.745).
 */
export const ATOMIC_EVENT_TYPE_ATTACK = 25;

/**
 * The `event <at> <type>` type id marking the frame a swing plays its sound FX — like
 * {@link ATOMIC_EVENT_TYPE_ATTACK}, a mid-animation timing cue: the builder's `viking_builder_build_house`
 * carries `event 4 34 1`, so the hammer knock lands on the visual strike at frame 4 rather than at
 * completion. The AtomicSystem fires an `atomicSound` event at this frame and audio drives the per-swing SFX
 * off it. An animation with no such event plays no mid-swing sound (a consumer may still sound its
 * completion).
 *
 * source-basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX` (l.754).
 */
export const ATOMIC_EVENT_TYPE_PLAY_SOUND_FX = 34;

/**
 * Resolve an {@link AtomicAnimation} by its exact `name` — the join key a tribe's `setatomic <job> <atomic>
 * "anim"` binding references ({@link AtomicAnimation.name}, not the lowercased `id`). Returns `undefined`
 * when the name doesn't resolve: the readable mod set is a subset of the base-game animations and a test
 * fixture may bind a `setatomic` name with no `[atomicanimation]`, so an absent name is expected and callers
 * fall back to a default duration. The {@link contentIndex} table is built first-wins over declaration order.
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
 * timing must not hang or zero-out the atomic. Shared by the AI planner and combat's attack swing, so both
 * resolve durations identically.
 */
export function atomicDuration(
  content: ContentSet,
  settler: { tribe: number; jobType: number | null },
  atomicId: number,
): number {
  return atomicDurationForName(content, atomicAnimationName(content, settler, atomicId));
}

/**
 * The duration (ticks) of a named animation — its `atomicanimations.ini` `length`, or
 * {@link DEFAULT_ATOMIC_DURATION} when the name is undefined / unresolved / zero-length. The name-keyed half
 * of {@link atomicDuration}, split out so a caller that already resolved the animation name (the combat
 * swing-start, which reads the same animation's hit-frame too) need not re-resolve the tribe's `setatomic`
 * binding.
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
 * tribe isn't in content, or no binding matches. The shared name lookup behind {@link atomicDuration} and the
 * combat swing's hit-frame / need-drain reads, so all three resolve the animation identically.
 */
export function atomicAnimationName(
  content: ContentSet,
  settler: { tribe: number; jobType: number | null },
  atomicId: number,
): string | undefined {
  if (settler.jobType === null) return undefined;
  return contentIndex(content).atomicBindingsByTribe.get(settler.tribe)?.get(settler.jobType)?.get(atomicId);
}

/**
 * Whether the named atomic animation may be interrupted mid-play (`atomicanimations.ini` `interruptable 1`).
 * The original distinguishes an interruptible animation (an idle/walk a settler can abandon the instant a
 * higher-priority drive fires) from an uninterruptible one (a harvest swing or attack that must play to
 * completion); read by the deferred atomic-preemption drive.
 *
 * Returns `false` for an unknown name — a missing animation is non-interruptible, the safe default that never
 * preempts work with no timing record.
 */
export function isInterruptibleAtomic(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.interruptible ?? false;
}

/**
 * The initial facing-direction index the named atomic animation pins (`atomicanimations.ini`
 * `startdirection`), or `undefined` when it pins none (only ~10% of base animations carry one). The original
 * uses it to orient a settler at the start of a directional atomic (a chop facing the tree). Carries
 * `undefined` through rather than coercing to `0` ("north") because "no pinned facing" is distinct from "face
 * north".
 */
export function atomicStartDirection(content: ContentSet, name: string): number | undefined {
  return atomicAnimationByName(content, name)?.startDirection;
}

/**
 * The net signed delta the named atomic animation contributes to one event `channel` — the sum of
 * `event.value` over every `event`/`eventx` whose `type` equals `channel` (see
 * {@link ATOMIC_EVENT_CHANNEL}). A restoring animation returns a positive total (`..._eat_slot_food` over
 * `HUNGER` = `+4000`; a multi-tick `..._sleep` over `REST` sums its repeated `+100`), a draining one a
 * negative total. Returns `0` for an unknown name and for an animation with no event on that channel. `value`
 * is optional in the IR (a bare `event <at> <type>` cue with no magnitude); such an event contributes `0`.
 *
 * source-basis: the extracted `events` array, summing the original's own per-tick deltas — the magnitudes the
 * needs drives currently only assert in prose.
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
 * production run: the worker's need bars drain while they labour (`eventx 50 1 -100` rest / `eventx 50 2 -100`
 * hunger) plus start/end markers (`eventx 0 22 0` / `eventx 99 23 0`), distinct from the plain `event`
 * yields/cues. Only 43 of ~2900 event lines are `eventx`, clustered on `*_produce_*`, so this doubles as the
 * "is this a producing animation that self-drains the worker" marker.
 *
 * Returns `false` for an unknown name and for an animation whose events are all plain `event`s.
 */
export function atomicHasExtendedEvents(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.events.some((e) => e.extended) ?? false;
}

/**
 * The frame (`at`) of the named animation's first `event`/`eventx` of `eventType`, or `undefined` when the
 * animation carries none (or the name doesn't resolve). Used for mid-animation timing cues — most notably
 * {@link ATOMIC_EVENT_TYPE_ATTACK}: a combat atomic resolves its hit when `elapsed` reaches this frame rather
 * than at completion, falling back to completion when there is no such event. The first matching event wins
 * (attack animations carry exactly one ATTACK cue); an animation with several of the same type resolves to
 * the earliest by declaration order.
 */
export function atomicEventFrame(content: ContentSet, name: string, eventType: number): number | undefined {
  const anim = atomicAnimationByName(content, name);
  if (anim === undefined) return undefined;
  for (const event of anim.events) {
    if (event.type === eventType) return event.at;
  }
  return undefined;
}
