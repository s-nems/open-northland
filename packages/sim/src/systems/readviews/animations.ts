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

/** The forward map-point step authored in some animal attack clips. */
export const ATOMIC_EVENT_TYPE_MOVE_FORWARD = 26;

/**
 * The `event <at> <type>` type id marking the frame a swing plays its sound FX. An animation carrying no
 * such event plays no mid-swing sound.
 *
 * Source basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX` (l.754).
 */
export const ATOMIC_EVENT_TYPE_PLAY_SOUND_FX = 34;

/**
 * The `event <at> <type> <good>` type id that puts one unit of the event's good in the worker's work
 * house, the only way the breeder's slaughter yields anything.
 *
 * Source basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_PUT_GOOD_IN_STOCK` (l.747).
 */
export const ATOMIC_EVENT_TYPE_PUT_GOOD_IN_STOCK = 27;

/**
 * The gathering clips' work event types: a pickup takes one unit per clip, while a split-up (stone, clay,
 * ore) or transform (tree, herb, wheat) clip is one stroke of the trade's per-unit count.
 *
 * Source basis: `logicdefines.inc` `ATOMIC_ANIMATION_EVENT_TYPE_PICKUP` (l.731), `_SPLITUP` (l.733) and
 * `_TRANSFORM` (l.738).
 */
export const ATOMIC_EVENT_TYPE_PICKUP = 11;
export const ATOMIC_EVENT_TYPE_SPLIT_UP = 13;
export const ATOMIC_EVENT_TYPE_TRANSFORM = 18;

/**
 * Whether the harvest clip a settler plays for `atomicId` is stroke-counted: it carries a split-up or
 * transform event. A clip with neither gathers like a pickup, one unit per playthrough.
 */
export function isStrokeCountedAtomic(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): boolean {
  return (
    atomicCarriesEvent(content, settler, atomicId, ATOMIC_EVENT_TYPE_SPLIT_UP) ||
    atomicCarriesEvent(content, settler, atomicId, ATOMIC_EVENT_TYPE_TRANSFORM)
  );
}

/** Whether the clip a settler plays for `atomicId` carries a transform work event: the strokes that run
 *  the stroke cadence (`atomics/stroke-cadence.ts`), as opposed to a split-up's strokes chained in place. */
export function isTransformAtomic(content: ContentSet, settler: SettlerIdentity, atomicId: number): boolean {
  return atomicCarriesEvent(content, settler, atomicId, ATOMIC_EVENT_TYPE_TRANSFORM);
}

function atomicCarriesEvent(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
  eventType: number,
): boolean {
  const name = atomicClipName(content, settler, atomicId);
  const anim = name === undefined ? undefined : atomicAnimationByName(content, name);
  return anim?.events.some((e) => e.type === eventType) ?? false;
}

/**
 * The clip frame `elapsed` ticks into an atomic. A clip shorter than the atomic running it replays, so a
 * multi-stroke harvest or a long crank at a well pays its events once per playthrough. Only frames `1` to
 * `length` are ever reached, so an event authored outside that window never fires.
 */
export function clipFrameAt(elapsed: number, length: number): number {
  return length > 0 ? ((elapsed - 1) % length) + 1 : elapsed;
}

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

/** An atomic's duration in ticks: the `length` of the clip `atomicClipName` resolves for the settler. */
export function atomicDuration(content: ContentSet, settler: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(content, atomicClipName(content, settler, atomicId));
}

/** The `length` of the clip `atomicClipName` resolves for the settler, or undefined when no clip resolves
 *  or it is zero-length, so the caller picks its own fallback instead of {@link DEFAULT_ATOMIC_DURATION}. */
export function resolvedAtomicLength(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): number | undefined {
  const name = atomicClipName(content, settler, atomicId);
  const length = name === undefined ? 0 : (atomicAnimationByName(content, name)?.length ?? 0);
  return length > 0 ? length : undefined;
}

/**
 * The clip a settler actually plays for `atomicId`: its own trade's `setatomic` binding, falling back to
 * the tribe's civilist body.
 *
 * Approximation: `jobtypes.ini` gives each job its own `baseatomics` parent (6 for the civilian trades,
 * but 31 for armed soldiers and 33-41 for the hero bodies), so routing every gap to the civilist is a
 * flattening of that chain, the same join the render makes.
 */
export function atomicClipName(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): string | undefined {
  return (
    boundAtomicAnimation(content, settler, atomicId) ??
    boundAtomicAnimation(content, { tribe: settler.tribe, jobType: CIVILIST_JOB }, atomicId)
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
 * over file order, matching the original's config-override semantics. A trade that binds none resolves
 * nothing; {@link atomicClipName} is the lookup that then inherits the civilist's.
 */
export function boundAtomicAnimation(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): string | undefined {
  if (settler.jobType === null) return undefined;
  return contentIndex(content).atomicBindingsByTribe.get(settler.tribe)?.get(settler.jobType)?.get(atomicId);
}

const adultAnimalJobs = new WeakMap<ContentSet, number | null>();

/** Resolve a wild creature's authored adult job while its runtime Settler has no player trade. */
export function boundAnimalAtomicAnimation(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): string | undefined {
  if (settler.jobType !== null) return boundAtomicAnimation(content, settler, atomicId);
  let adultJob = adultAnimalJobs.get(content);
  if (adultJob === undefined) {
    adultJob = content.jobs.find((job) => job.id === 'adult_animal')?.typeId ?? null;
    adultAnimalJobs.set(content, adultJob);
  }
  return adultJob === null
    ? undefined
    : boundAtomicAnimation(content, { tribe: settler.tribe, jobType: adultJob }, atomicId);
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

/** Every occurrence of an event type in clip order. An attack clip may contain several timed blows. */
export function atomicEventFrames(content: ContentSet, name: string, eventType: number): number[] {
  return (
    atomicAnimationByName(content, name)
      ?.events.filter((event) => event.type === eventType)
      .map((event) => event.at) ?? []
  );
}
