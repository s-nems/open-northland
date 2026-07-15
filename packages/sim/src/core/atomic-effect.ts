import type { Entity } from '../ecs/world.js';

/**
 * The effect an atomic action applies on completion. Keeps the numeric `atomicId` as the content
 * cross-reference (required for fidelity), but the effect a system applies is a typed union so the
 * AtomicSystem's apply switch is exhaustive and golden traces are human-readable, not opaque ints.
 */
export type AtomicEffect =
  | { readonly kind: 'move'; readonly to: { x: number; y: number } }
  | { readonly kind: 'harvest'; readonly resource: Entity; readonly goodType: number }
  | {
      readonly kind: 'pickup';
      readonly goodType: number;
      readonly amount: number;
      /** The store the goods come out of (a workplace's stockpile a carrier hauls from), or null for a
       *  sourceless pickup (the goods appear on the settler's back). Goods are conserved: a pickup `from` a
       *  store removes exactly what it adds to the carrier. */
      readonly from: Entity | null;
    }
  | { readonly kind: 'pileup'; readonly store: Entity }
  | { readonly kind: 'produce'; readonly recipeOutput: number }
  | {
      readonly kind: 'eat';
      readonly goodType: number;
      /** The store the food is consumed from (a stockpile the eater stands on), or null when the eater
       *  consumes a unit it already carries. One unit of `goodType` is removed on completion — eating destroys
       *  the food (conserved up to that consumption). */
      readonly from: Entity | null;
    }
  /** The settler sleeps to restore rest: zeroes its `fatigue` on completion (no goods consumed —
   *  unlike `eat`, resting is free). The pairing reset for the NeedsSystem's fatigue rise. */
  | { readonly kind: 'sleep' }
  /** The settler prays to restore devotion: zeroes its `piety` on completion (no goods consumed — like
   *  `sleep`, praying is free). The pairing reset for the NeedsSystem's piety rise. Unlike `sleep` (in place)
   *  this is the first target-bound need — the settler must stand on a temple to run it. */
  | { readonly kind: 'pray' }
  /** The settler enjoys itself to restore leisure: zeroes its `enjoyment` on completion (no goods consumed —
   *  like `sleep`/`pray`). The pairing reset for the NeedsSystem's enjoyment rise (the `enjoy` atomic, id 17).
   *  The need→satisfier drive is deferred — `enjoy` has no readable building satisfier (see source basis) — so
   *  for now this effect is the reset half, exercised directly. */
  | { readonly kind: 'enjoy' }
  /** The settler makes love to restore leisure: zeroes its `enjoyment` on completion (no goods consumed — like
   *  `enjoy`/`sleep`/`pray`). The `make_love` atomic (id 78) is not a separate need — its animation
   *  (`viking_civilist_make_love`) restores the same channel 3 as `enjoy` via `event <at> 3 +800` tuples (a
   *  bigger leisure boost than enjoy's +100), so it resets `enjoyment` too. The need→satisfier drive is
   *  deferred for the same reason as `enjoy` (see source basis) — so for now this is the reset half only. */
  | { readonly kind: 'make_love' }
  /** The settler swings at `target`: the blow subtracts `damage` from the target's `Health.hitpoints`,
   *  clamped at 0. `damage` is the resolved column damage — the planner looked it up from the weapon's
   *  `damagevalue[targetMaterial]` (attacker weapon × target armor material) and carried it here already
   *  resolved, so the executor stays a pure subtraction. The hit lands at `hitAt` (the animation's
   *  `ATOMIC_EVENT_TYPE_ATTACK` frame), falling back to the completion frame when omitted. `weaponMainType`
   *  (`WeaponType.mainType`) keys the fight-experience bucket the swing accrues into; omitted → no fight XP.
   *  A `target` with no `Health` is a no-op.
   *
   *  `projectile` is present iff this is a ranged swing (bow/catapult): at `hitAt` the executor launches a
   *  {@link import('../components/combat.js').Projectile} toward `target` instead of landing the blow in
   *  place; the projectile (`projectileSystem`) deals the same `damage` on contact. It carries the ammunition
   *  class + travel `speed`. Absent → a melee swing that lands here at `hitAt`.
   *
   *  `maxRange` is the melee weapon's reach (half-cell nodes), re-checked at the hit frame: if the target has
   *  stepped beyond it during the swing, the blow whiffs (no damage). Present only on a melee swing; absent →
   *  the blow always lands on a live target (e.g. a mapless fixture with no nodes). */
  | {
      readonly kind: 'attack';
      readonly target: Entity;
      readonly damage: number;
      readonly hitAt?: number;
      readonly weaponMainType?: number;
      readonly maxRange?: number;
      readonly projectile?: { readonly munitionType: number; readonly speed: number };
    }
  /** A builder's construction swing at a {@link import('../components/economy/index.js').UnderConstruction}
   *  site: on completion it advances the site's builder-work `labor` by one strike's quantum
   *  (`+ONE / (totalConstructionUnits · strikesPerUnit)`), clamped at ONE. No goods move here — the delivered
   *  materials sit in the site's stockpile until the ConstructionSystem consumes the whole cost at completion,
   *  and the visible `Building.built` is derived from `min(labor, deliveredFraction)`. A `site` no longer
   *  under construction (finished or demolished) is a no-op. */
  | { readonly kind: 'construct'; readonly site: Entity }
  /** A farmer's sowing swing at a free field node `(x, y)` (half-cell coords): on completion it plants a
   *  {@link import('../components/economy/index.js').Crop} field of `goodType` there for `farm`, unless the
   *  node was taken since the planner chose it (another field, a fresh resource/heap), in which case it plants
   *  nothing (the raced-target no-op, like `harvest`). Growth parameters are resolved from the good's content
   *  `farming` block at apply time. */
  | {
      readonly kind: 'sow';
      readonly farm: Entity;
      readonly goodType: number;
      readonly x: number;
      readonly y: number;
    }
  /** A hungry settler forages a wild {@link import('../components/economy/index.js').BerryBush}: on completion
   *  it eats the ripe bush's fruit — the bush flips ripe→bare and regrows (BerryGrowthSystem) — and the eater's
   *  hunger zeroes, like `eat`. Unlike `eat` no stored/carried good is consumed and no job/tool is needed (a
   *  bush is wild food anyone can graze). A `bush` already bare (a forager beat this one to it) or gone consumes
   *  nothing, but hunger still resets (the raced-source stance, like `eat`'s empty store). Runs on the eat
   *  animation (id 10). */
  | { readonly kind: 'forage'; readonly bush: Entity }
  /** A farmer's watering (the original's cultivate atomic) of a growing field: on completion the
   *  {@link import('../components/economy/index.js').Crop} is marked `watered`, which enables its growth — an
   *  unwatered field stalls at its sown stage (a named approximation — the engine's watering semantics are not
   *  decoded). A field already reaped/ripe, or gone, is a no-op. */
  | { readonly kind: 'water'; readonly crop: Entity }
  /** The settler sets its carried load down on the ground before an interrupt takes over (a profession
   *  change, or fleeing an enemy): on completion the whole {@link import('../components/settler.js').Carrying}
   *  load is placed on the settler's own tile, spilling any remainder over the `MAX_GROUND_STACK` cap to the
   *  nearest free walkable hexes ({@link import('../systems/agents/effects-goods/index.js').dropCarriedLoad}).
   *  No good is lost — a dropped load becomes loose ground heaps. Carries no payload: the load is read off the
   *  settler at apply time. */
  | { readonly kind: 'drop' }
  | { readonly kind: 'idle' };
