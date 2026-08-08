import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';

/**
 * The `atomicanimations.ini` `event <at> <type> <value>` channel ids - the need bar a timed event restores
 * or drains. The wider `type` vocabulary (ids 8..36) stays an undocumented render/effect channel space.
 */
export const ATOMIC_EVENT_CHANNEL = {
  /** Rest/fatigue bar - `..._sleep` animations restore it. */
  REST: 1,
  /** Hunger bar - `..._eat_slot_food` restores it. */
  HUNGER: 2,
  /** Leisure/enjoyment bar - `..._enjoy` and `..._make_love` restore it. */
  LEISURE: 3,
  /** Piety bar - `..._pray` restores it. */
  PIETY: 4,
} as const;

/**
 * The `event <at> <type>` type id marking the frame a swing's blow lands - a bare cue with no magnitude, so
 * the hit resolves at that frame rather than at animation completion.
 *
 * Source basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_ATTACK` (l.745).
 */
export const ATOMIC_EVENT_TYPE_ATTACK = 25;

/**
 * The `event <at> <type>` type id marking the frame a swing plays its sound FX. An animation carrying no
 * such event plays no mid-swing sound.
 *
 * Source basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX` (l.754).
 */
export const ATOMIC_EVENT_TYPE_PLAY_SOUND_FX = 34;

/**
 * Resolve an {@link AtomicAnimation} by its exact `name` - the join key a tribe's `setatomic <job> <atomic>
 * "anim"` binding references, not the lowercased `id`. An unresolved name is expected, since the readable
 * mod set is a subset of the base-game animations. The lookup table is first-wins over declaration order.
 */
export function atomicAnimationByName(content: ContentSet, name: string): AtomicAnimation | undefined {
  return contentIndex(content).atomicAnimationsByName.get(name);
}

/** Duration (ticks) used when an atomic's animation-length chain doesn't resolve - a non-zero default
 *  so an unresolved atomic still takes visible time rather than completing instantly. */
const DEFAULT_ATOMIC_DURATION = 4;

/** An atomic's duration in ticks: the `length` of the animation the settler's tribe binds it to. */
export function atomicDuration(content: ContentSet, settler: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(content, atomicAnimationName(content, settler, atomicId));
}

/**
 * The duration in ticks of a settler's need atomic (eat, sleep), falling back to the tribe's civilist clip
 * when the settler's own trade binds none. `tribetypes.ini` `setatomic` covers eat only for jobs
 * 3,4,5,6,31,34 and sleep only for 1-6,31, so a builder, collector, farmer, carrier or scout binds neither.
 *
 * Approximation: routing the gap to the generic civilist body, the same join the render makes (every
 * civilian look draws through `logicJob: 6`).
 */
export function needAtomicDuration(content: ContentSet, settler: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(content, needAtomicAnimationName(content, settler, atomicId));
}

/** The animation name behind {@link needAtomicDuration}, including its civilist fallback. */
export function needAtomicAnimationName(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): string | undefined {
  return (
    atomicAnimationName(content, settler, atomicId) ??
    atomicAnimationName(content, { tribe: settler.tribe, jobType: CIVILIST_JOB }, atomicId)
  );
}

/** The duration in ticks of a named animation - its `atomicanimations.ini` `length`, or
 *  {@link DEFAULT_ATOMIC_DURATION} when the name is undefined, unresolved, or zero-length. */
export function atomicDurationForName(content: ContentSet, animation: string | undefined): number {
  if (animation === undefined) return DEFAULT_ATOMIC_DURATION;
  const length = atomicAnimationByName(content, animation)?.length ?? 0;
  return length > 0 ? length : DEFAULT_ATOMIC_DURATION;
}

/**
 * The animation name a settler's tribe binds `(jobType, atomicId)` to - the `setatomic` join key, last-wins
 * over file order, matching the original's config-override semantics.
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
 * Whether the named atomic animation may be interrupted mid-play (`atomicanimations.ini` `interruptable 1`) -
 * an idle or walk a settler can abandon, versus a harvest swing or attack that must play to completion.
 *
 * Approximation: most clips carry no `interruptable` key and extraction defaults them to `false`. The data
 * backs that reading (idles, walks, talk and sleep are marked `1`, the work swings are unmarked, the few
 * explicit `0` rows are dock and animal clips), but the original's missing-key default is unverified.
 */
export function isInterruptibleAtomic(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.interruptible ?? false;
}

/**
 * The facing-direction index the named atomic animation pins (`atomicanimations.ini` `startdirection`), or
 * `undefined` when it pins none (only ~10% of base animations carry one). Not coerced to `0`, since "no
 * pinned facing" differs from "face north".
 */
export function atomicStartDirection(content: ContentSet, name: string): number | undefined {
  return atomicAnimationByName(content, name)?.startDirection;
}

/**
 * The net signed delta the named atomic animation contributes to one {@link ATOMIC_EVENT_CHANNEL} - the sum
 * of `event.value` over every `event`/`eventx` of that `type`. A restoring animation totals positive
 * (`..._eat_slot_food` over `HUNGER` is `+4000`), a draining one negative; a bare cue carrying no `value`
 * contributes nothing.
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
 * Whether the named atomic animation carries any `eventx` event - the second event stream the source spells
 * with that key. In the real data `eventx` lines cluster on `*_produce_*` clips, bracketing the run and
 * draining the worker's rest and hunger bars, so this doubles as the self-draining-production marker.
 */
export function atomicHasExtendedEvents(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.events.some((e) => e.extended) ?? false;
}

/** The frame (`at`) of the named animation's first `event`/`eventx` of `eventType`, or `undefined` when it
 *  carries none. First match wins, so several events of one type resolve to the earliest declared. */
export function atomicEventFrame(content: ContentSet, name: string, eventType: number): number | undefined {
  const anim = atomicAnimationByName(content, name);
  if (anim === undefined) return undefined;
  for (const event of anim.events) {
    if (event.type === eventType) return event.at;
  }
  return undefined;
}
