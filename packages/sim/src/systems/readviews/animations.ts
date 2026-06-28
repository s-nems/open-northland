import type { AtomicAnimation, ContentSet } from '@vinland/data';

// Pure, terminal **read views** for atomic animations — the canonical name→record resolver over
// `content.atomicAnimations` plus thin accessors for the animation scalars no sim system reads
// directly (`interruptible`, `startDirection`), the per-channel net delta over the `events` array,
// and the `eventx`/`event` stream split (`extended` — the last unread per-event field).
// The `length` scalar already drives `atomicDuration` (ai.ts) and the combat swing cadence (combat.ts)
// via an inline `atomicAnimations.find(...)`; this gives that name-lookup a single named home and
// surfaces the remaining extracted-but-unread fields, the read-side consumer the deferred
// interrupt/facing/needs drives join on. No mechanic is added here (nothing is interrupted, nothing
// faces a direction, no bar is restored); see ./index.ts for why read views live apart from
// systems/shared.ts.

/**
 * The `atomicanimations.ini` `event <at> <type> <value>` **channel** ids — the numbered need bar a
 * timed event restores (or drains). These four are the channels the needs/eat/sleep/pray/enjoy drives
 * already reference *in prose* (needs.ts, ai.ts, atomic.ts doc comments) but never read from the data:
 * verified across the real IR (e.g. `..._eat_slot_food` carries `event 30 2 +4000`, `..._sleep` carries
 * `event <at> 1 +100`, `..._enjoy`/`..._make_love` carry `event <at> 3 +800`, `..._pray` carries
 * `event <at> 4 +800`). Naming them here turns those scattered prose claims into a single data-pinned
 * lookup ({@link atomicEventChannelDelta}). The wider `type` vocabulary (sounds/cues/yields at ids
 * 8..36) stays an undocumented render/effect channel space — deferred, not enumerated here.
 *
 * FIDELITY: pinned to the mod's readable `atomicanimations.ini` `event <at> <type> <value>` semantics
 * (golden rule #4) — these are the original's own channel ids, not invented.
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
 * Resolve an {@link AtomicAnimation} by its exact `name` — the join key a tribe's `setatomic <job>
 * <atomic> "anim"` binding references ({@link AtomicAnimation.name}, NOT the lowercased `id`). This is
 * the canonical form of the inline `content.atomicAnimations.find((a) => a.name === name)` that
 * `atomicDuration` (ai.ts) and the combat swing-cadence lookup (combat.ts) each spell out by hand:
 * the same name-keyed scan, named once. Returns `undefined` when the name doesn't resolve — the
 * readable mod animation set is a subset of the base-game animations, and a test fixture may bind a
 * `setatomic` name it has no `[atomicanimation]` for, so an absent name is expected, not malformed
 * (the callers fall back to a default duration; see {@link AtomicAnimation}).
 *
 * FIDELITY n/a: a pure name-keyed lookup over the already-extracted animation IR — it adds no
 * mechanic and invents no data (the `name` join key is the original's own `setatomic` reference).
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock); `find` returns the
 * first match in `content.atomicAnimations` declaration order, byte-stable per content.
 */
export function atomicAnimationByName(content: ContentSet, name: string): AtomicAnimation | undefined {
  return content.atomicAnimations.find((a) => a.name === name);
}

/**
 * Whether the named atomic animation may be **interrupted** mid-play (`atomicanimations.ini`
 * `interruptable 1` → {@link AtomicAnimation.interruptible}). The original engine distinguishes an
 * interruptible animation (an idle/walk a settler can abandon the instant a higher-priority drive
 * fires) from an uninterruptible one (a harvest swing or attack that must play to completion before
 * the planner re-plans). This is the data-pinned read side of that distinction — the seed the deferred
 * atomic-preemption drive reads when deciding whether an in-progress atomic can be cut short.
 *
 * Returns `false` for an unknown name (a missing animation is treated as non-interruptible — the safe
 * default that never preempts work that has no timing record), matching how {@link atomicDuration}
 * falls back rather than throwing on an unresolved name.
 *
 * FIDELITY: pinned to the extracted `interruptible` flag (`interruptable` in the source) — read
 * straight off the param the pipeline captured, not inferred. Adds no mechanic (nothing is interrupted
 * yet) — a derived classification over the already-extracted animation IR.
 */
export function isInterruptibleAtomic(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.interruptible ?? false;
}

/**
 * The initial **facing direction** index the named atomic animation pins (`atomicanimations.ini`
 * `startdirection` → {@link AtomicAnimation.startDirection}), or `undefined` when the animation pins
 * none (most don't — only ~10% of the base animations carry one). The original uses it to orient a
 * settler at the start of a directional atomic (e.g. a chop facing the tree) rather than playing the
 * animation in whatever direction the settler last faced. This is the data-pinned read side a deferred
 * facing/orientation drive reads; it carries through `undefined` (vs coercing to a `0` "north") because
 * "no pinned facing" is semantically distinct from "face north" — the schema leaves it `optional`.
 *
 * FIDELITY: pinned to the extracted `startDirection` (`startdirection` in the source) — read straight
 * off the captured param. Adds no mechanic (nothing faces a direction yet) — a derived accessor over
 * the already-extracted animation IR.
 */
export function atomicStartDirection(content: ContentSet, name: string): number | undefined {
  return atomicAnimationByName(content, name)?.startDirection;
}

/**
 * The **net signed delta** the named atomic animation contributes to one event `channel` — the sum of
 * `event.value` over every `event`/`eventx` whose `type` equals `channel` (`atomicanimations.ini`
 * `event <at> <type> <value>`; see {@link ATOMIC_EVENT_CHANNEL}). A restoring animation returns a
 * positive total (e.g. `..._eat_slot_food` over {@link ATOMIC_EVENT_CHANNEL.HUNGER} = `+4000`; a
 * multi-tick `..._sleep` over `REST` sums its repeated `+100` ticks), a draining one a negative total.
 *
 * This is the data-pinned read side of the channel-restoration semantics the needs/eat/sleep/pray/enjoy
 * drives currently assert only in prose (needs.ts/ai.ts/atomic.ts hardcode "eat restores +4000",
 * "make_love is a bigger +800 boost", etc.): it reads those magnitudes straight off the extracted
 * `events` array instead of repeating them as comments — the seed the deferred event-driven needs model
 * (the one that replaces the approximated per-tick rise/reset constants with the real per-animation
 * deltas) joins on. Returns `0` for an unknown name and for an animation with no event on that channel
 * (an absent contribution is a zero delta, matching how {@link atomicDuration} falls back rather than
 * throwing on an unresolved name).
 *
 * `value` is `optional` in the IR (a bare `event <at> <type>` with no magnitude — a cue, not a delta);
 * such an event contributes `0`, so it neither throws nor skews the sum.
 *
 * FIDELITY: pinned to the extracted `events` array (`event <at> <type> <value>` in the mod's readable
 * `atomicanimations.ini`, golden rule #4) — read straight off the captured tuples, summing the
 * original's own per-tick deltas. Adds no mechanic (no bar is restored yet) — a derived aggregate over
 * the already-extracted animation IR. Determinism: a pure left-to-right fold over `events` declaration
 * order; `+` over integers commutes/associates, so the total is byte-stable per content.
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
 * Whether the named atomic animation carries any **extended** (`eventx`) event — the rare second event
 * stream the source spells with the `eventx` key instead of plain `event` ({@link AtomicEvent.extended}).
 * In the real data the `eventx` lines bracket and accompany a *production* run: the worker's own
 * need-bar drains while they labour (`eventx 50 1 -100` rest / `eventx 50 2 -100` hunger) and the
 * production start/end markers (`eventx 0 22 0` / `eventx 99 23 0`), distinct from the plain `event`
 * lines that carry the good yields/cues. Only 43 of the ~2900 event lines across the readable
 * `atomicanimations.ini` are `eventx`, and they cluster on the `*_produce_*` animations — so this
 * predicate doubles as the data-pinned "is this a producing animation that self-drains the worker"
 * marker, the seed the deferred production/needs drive reads to know an animation has a second
 * (extended) channel to apply, not just its plain yield stream.
 *
 * Returns `false` for an unknown name and for an animation whose events are all plain `event`s,
 * matching how the sibling accessors fall back rather than throwing on an unresolved name.
 *
 * FIDELITY: pinned to the extracted `extended` flag (`eventx` vs `event` key in the mod's readable
 * `atomicanimations.ini`, golden rule #4) — read straight off the captured per-event marker, not
 * inferred. Adds no mechanic (no second-stream effect is applied yet) — a derived predicate over the
 * already-extracted animation IR, the last unread `AtomicEvent` field. Determinism: a pure
 * `some`-scan over `events` declaration order, byte-stable per content.
 */
export function atomicHasExtendedEvents(content: ContentSet, name: string): boolean {
  return atomicAnimationByName(content, name)?.events.some((e) => e.extended) ?? false;
}
