import { type AtomicAnimation, type ContentSet, unitVariantFor } from '@open-northland/data';
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
 * The clip frame whose events fire on the tick `elapsed` ticks into an atomic. Original behavior: a clip's
 * frame counter starts at 0, and each tick fires the events authored at the counter before advancing it,
 * so `event <at>` lands on tick `at + 1` ({@link eventTick}). A clip shorter than the atomic running it
 * replays, so a multi-stroke harvest or a long crank at a well pays its events once per playthrough. Only
 * frames `0` to `length - 1` are ever reached, so an event authored outside that window never fires.
 */
export function clipFrameAt(elapsed: number, length: number): number {
  return length > 0 ? (elapsed - 1) % length : elapsed - 1;
}

/** The tick of an atomic (`elapsed`, counted from 1) that fires an event authored at clip frame `at`, the
 *  inverse of {@link clipFrameAt} for a clip that does not replay. */
export function eventTick(at: number): number {
  return at + 1;
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
  return clipBindingFor(content, settler, atomicId).name;
}

/** The clip {@link atomicClipName} resolves for the settler, or `undefined` when none resolves. */
export function atomicClip(
  content: ContentSet,
  settler: SettlerIdentity,
  atomicId: number,
): AtomicAnimation | undefined {
  return clipBindingFor(content, settler, atomicId).clip;
}

interface ClipBinding {
  readonly name: string | undefined;
  readonly clip: AtomicAnimation | undefined;
}

/** The clip join memo, one flat table per content set keyed by {@link clipBindingKey}: the atomic passes
 *  ask it for every running clip each tick, so one lookup replaces a walk down nested tables. */
const clipBindingTables = new WeakMap<ContentSet, Map<number, ClipBinding>>();
/** The table of the content set asked last, so a pass over one world skips the weak-map lookup. These
 *  strong references keep that content set and its table alive until another set is asked, so the last
 *  one outlives its simulation for the module's lifetime. */
let lastClipContent: ContentSet | undefined;
let lastClipTable: Map<number, ClipBinding> | undefined;
const UNBOUND: ClipBinding = { name: undefined, clip: undefined };
/** Exclusive bounds of the packed key's fields; an identity outside them is joined unmemoized. The job
 *  field holds `jobType + 1`, so a settler without a trade packs as 0. */
const CLIP_KEY_TRIBE_SPAN = 1 << 8;
const CLIP_KEY_JOB_SPAN = 1 << 10;
const CLIP_KEY_ATOMIC_SPAN = 1 << 11;
/** The form's two values, the unit variant it picks. */
const CLIP_KEY_FORM_SPAN = 2;

/** The flat memo key of a settler's clip join, or -1 when a field falls outside its span. */
function clipBindingKey(settler: SettlerIdentity, atomicId: number): number {
  const { tribe } = settler;
  const job = settler.jobType === null ? 0 : settler.jobType + 1;
  if (
    tribe < 0 ||
    tribe >= CLIP_KEY_TRIBE_SPAN ||
    (settler.jobType !== null && settler.jobType < 0) ||
    job >= CLIP_KEY_JOB_SPAN ||
    atomicId < 0 ||
    atomicId >= CLIP_KEY_ATOMIC_SPAN ||
    !Number.isInteger(atomicId)
  )
    return -1;
  const form = settler.humanForm === true ? 1 : 0;
  return ((atomicId * CLIP_KEY_JOB_SPAN + job) * CLIP_KEY_TRIBE_SPAN + tribe) * CLIP_KEY_FORM_SPAN + form;
}

function clipBindingFor(content: ContentSet, settler: SettlerIdentity, atomicId: number): ClipBinding {
  const key = clipBindingKey(settler, atomicId);
  if (key < 0) return joinClipBinding(content, settler, atomicId);
  let table = content === lastClipContent ? lastClipTable : clipBindingTables.get(content);
  if (table === undefined) {
    table = new Map();
    clipBindingTables.set(content, table);
  }
  lastClipContent = content;
  lastClipTable = table;
  let binding = table.get(key);
  if (binding === undefined) {
    binding = joinClipBinding(content, settler, atomicId);
    table.set(key, binding);
  }
  return binding;
}

function joinClipBinding(content: ContentSet, settler: SettlerIdentity, atomicId: number): ClipBinding {
  const name =
    boundAtomicAnimation(content, settler, atomicId) ??
    boundAtomicAnimation(content, { tribe: settler.tribe, jobType: CIVILIST_JOB }, atomicId);
  return name === undefined ? UNBOUND : { name, clip: atomicAnimationByName(content, name) };
}

/** A placeable sound cue of a clip: the atomic tick it fires on and the sound bank's `logicSoundType`. */
export interface ClipSoundCue {
  readonly tick: number;
  readonly soundType: number;
}

/** The facts the per-tick atomic passes read off a clip, derived once per clip. */
export interface ClipEventFacts {
  /** Clip frames carrying a valued rest, hunger, leisure or piety event. */
  readonly needFrames: ReadonlySet<number>;
  /** Every valued sound FX event inside the clip's length, in event order. */
  readonly soundCues: readonly ClipSoundCue[];
  /** The last atomic tick a negative piety event inside the clip fires on, {@link NO_PIETY_SPEND_TICK} when
   *  the clip has none. */
  readonly lastPietySpendTick: number;
}

/** {@link ClipEventFacts.lastPietySpendTick} of a clip without a spend; event ticks count from 1. */
export const NO_PIETY_SPEND_TICK = 0;

const clipEventFacts = new WeakMap<AtomicAnimation, ClipEventFacts>();
/** The clip asked last and its facts: one running atomic's religion, need and sound reads ask for the
 *  same clip in a row, so they share one weak-map lookup. Holds that clip alive until another is asked. */
let lastFactsClip: AtomicAnimation | undefined;
let lastFacts: ClipEventFacts | undefined;

export function clipEventFactsOf(anim: AtomicAnimation): ClipEventFacts {
  if (anim === lastFactsClip && lastFacts !== undefined) return lastFacts;
  const facts = clipEventFacts.get(anim) ?? deriveClipEventFacts(anim);
  lastFactsClip = anim;
  lastFacts = facts;
  return facts;
}

function deriveClipEventFacts(anim: AtomicAnimation): ClipEventFacts {
  const needFrames = new Set<number>();
  const soundCues: ClipSoundCue[] = [];
  let lastPietySpendTick = NO_PIETY_SPEND_TICK;
  for (const event of anim.events) {
    const value = event.value ?? 0;
    if (isNeedChannel(event.type) && value !== 0) needFrames.add(event.at);
    if (event.at >= anim.length) continue;
    if (event.type === ATOMIC_EVENT_TYPE_PLAY_SOUND_FX && event.value !== undefined)
      soundCues.push({ tick: eventTick(event.at), soundType: event.value });
    if (event.type === ATOMIC_EVENT_CHANNEL.PIETY && value < 0)
      lastPietySpendTick = Math.max(lastPietySpendTick, eventTick(event.at));
  }
  const facts = { needFrames, soundCues, lastPietySpendTick };
  clipEventFacts.set(anim, facts);
  return facts;
}

function isNeedChannel(type: number): boolean {
  return (
    type === ATOMIC_EVENT_CHANNEL.REST ||
    type === ATOMIC_EVENT_CHANNEL.HUNGER ||
    type === ATOMIC_EVENT_CHANNEL.LEISURE ||
    type === ATOMIC_EVENT_CHANNEL.PIETY
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
  const jobType = unitVariantFor(content, settler)?.animationJobType ?? settler.jobType;
  return contentIndex(content).atomicBindingsByTribe.get(settler.tribe)?.get(jobType)?.get(atomicId);
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
