import type { AtomicAnimation, ContentSet } from '@vinland/data';

// Pure, terminal **read views** for atomic animations — the canonical name→record resolver over
// `content.atomicAnimations` plus thin accessors for the two animation scalars no sim system reads
// yet (`interruptible`, `startDirection`). The `length` scalar already drives `atomicDuration`
// (ai.ts) and the combat swing cadence (combat.ts) via an inline `atomicAnimations.find(...)`; this
// gives that name-lookup a single named home and surfaces the remaining extracted-but-unread fields,
// the read-side consumer the deferred interrupt/facing drives join on. No mechanic is added here
// (nothing is interrupted, nothing faces a direction); see ./index.ts for why read views live apart
// from systems/shared.ts.

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
