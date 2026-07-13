import type { Entity } from '../ecs/world.js';

/**
 * The effect an atomic action applies on completion. Keeps the numeric `atomicId` as the content
 * cross-reference (required for fidelity), but the EFFECT a system applies is a typed union so the
 * AtomicSystem's apply switch is exhaustive and golden traces are human-readable, not opaque ints.
 */
export type AtomicEffect =
  | { readonly kind: 'move'; readonly to: { x: number; y: number } }
  | { readonly kind: 'harvest'; readonly resource: Entity; readonly goodType: number }
  | {
      readonly kind: 'pickup';
      readonly goodType: number;
      readonly amount: number;
      /** The store the goods come OUT of (a workplace's stockpile a carrier hauls from), or null
       *  for a sourceless pickup (the goods appear on the settler's back without a source). Goods
       *  are conserved: a pickup `from` a store removes exactly what it adds to the carrier. */
      readonly from: Entity | null;
    }
  | { readonly kind: 'pileup'; readonly store: Entity }
  | { readonly kind: 'produce'; readonly recipeOutput: number }
  | {
      readonly kind: 'eat';
      readonly goodType: number;
      /** The store the food is consumed FROM (a stockpile the eater stands on), or null when the
       *  eater consumes a unit it already carries. One unit of `goodType` is removed on completion —
       *  eating destroys the food (it is conserved up to that consumption: nothing is conjured). */
      readonly from: Entity | null;
    }
  /** The settler sleeps to restore rest: zeroes its `fatigue` on completion (no goods consumed —
   *  unlike `eat`, resting is free). The pairing reset for the NeedsSystem's fatigue rise. */
  | { readonly kind: 'sleep' }
  /** The settler prays to restore devotion: zeroes its `piety` on completion (no goods consumed —
   *  like `sleep`, praying is free). The pairing reset for the NeedsSystem's piety rise. Unlike
   *  `sleep` (in place) this is the first **target-bound** need — the settler must stand on a temple
   *  to run it (the planner walks it there first). */
  | { readonly kind: 'pray' }
  /** The settler enjoys itself to restore leisure: zeroes its `enjoyment` on completion (no goods
   *  consumed — like `sleep`/`pray`, recreation is free). The pairing reset for the NeedsSystem's
   *  enjoyment rise (the `enjoy` atomic, id 17). The need→satisfier *drive* is deferred — `enjoy` has
   *  no readable building satisfier to walk to (see source basis) — so for now this effect is the
   *  reset half, exercised directly (no planner branch chooses it yet). */
  | { readonly kind: 'enjoy' }
  /** The settler makes love to restore leisure: zeroes its `enjoyment` on completion (no goods
   *  consumed — like `enjoy`/`sleep`/`pray`). The `make_love` atomic (id 78) is NOT a separate need —
   *  its animation (`viking_civilist_make_love`) restores the **same channel 3** as `enjoy` via
   *  `event <at> 3 +800` tuples (a bigger leisure boost than enjoy's +100), so it resets `enjoyment`
   *  too. The need→satisfier *drive* is deferred for the same reason as `enjoy` — no readable building
   *  satisfier in `houses.ini` (see source basis) — so for now this is the reset half only. */
  | { readonly kind: 'make_love' }
  /** The settler swings at `target`: the blow subtracts `damage` from the target's `Health.hitpoints`
   *  (clamped at 0 — armor never heals). `damage` is the **resolved column damage**, looked up by the
   *  planner from the weapon's `damagevalue[targetMaterial]` (the attacker's weapon × the target's armor
   *  material) and carried here already-resolved — exactly as `pickup`/`eat` carry a resolved `amount`,
   *  so the executor stays a pure subtraction with no content/weapon lookup of its own. The hit lands at
   *  `hitAt` (the animation's ATTACK-event frame, `ATOMIC_EVENT_TYPE_ATTACK`); when omitted it falls back
   *  to the completion frame (an animation with no ATTACK event). `weaponMainType` (the weapon's coarse
   *  class, `WeaponType.mainType`) keys the fight-experience bucket the swing accrues into; omitted → no
   *  fight XP (a weapon with no `mainType`). A `target` with no `Health` (already destroyed, or a
   *  non-combatant) is a no-op (the swing struck air).
   *
   *  `projectile` is present iff this is a **ranged** swing (a bow/catapult): at `hitAt` (the animation's
   *  release frame) the executor **launches a {@link import('../components/combat.js').Projectile}** toward
   *  `target` instead of landing the blow in place — the arrow/rock then flies (`projectileSystem`) and
   *  deals the SAME `damage` on contact (step 1's model, resolved on arrival). It carries the ammunition
   *  class + travel `speed` the projectile needs. Absent → a melee swing (the blow lands here at `hitAt`).
   *
   *  `maxRange` is the melee weapon's reach (in half-cell nodes, the same band the CombatSystem started the
   *  swing within), carried so the executor can RE-CHECK reach at the hit frame: if the target has stepped
   *  beyond it during the swing (a long animation the enemy backed out of), the blow WHIFFS — no damage, no
   *  blood, no flinch. Present only on a MELEE swing (a ranged shot homes via its projectile); absent → the
   *  blow always lands on a live target (the pre-reach-check behaviour, e.g. a mapless fixture with no nodes). */
  | {
      readonly kind: 'attack';
      readonly target: Entity;
      readonly damage: number;
      readonly hitAt?: number;
      readonly weaponMainType?: number;
      readonly maxRange?: number;
      readonly projectile?: { readonly munitionType: number; readonly speed: number };
    }
  /** A builder's **construction swing** at a {@link import('../components/economy/index.js').UnderConstruction}
   *  site: on completion it advances the site's builder-work `labor` by one hammer STRIKE's quantum
   *  (`+ONE / (totalConstructionUnits · strikesPerUnit)` — a small step, so a site rises over many
   *  strikes scaled to its size), clamped at ONE. No goods
   *  move here (the delivered materials sit in the site's stockpile until the ConstructionSystem consumes
   *  the whole cost at completion); the visible `Building.built` is derived by that system from
   *  `min(labor, deliveredFraction)`. A `site` that is no longer under construction (finished this tick,
   *  or demolished) is a no-op — the swing struck a building that no longer needs raising. */
  | { readonly kind: 'construct'; readonly site: Entity }
  /** A farmer's **sowing swing** at a free field node `(x, y)` (half-cell coords, like every command):
   *  on completion it plants a {@link import('../components/economy/index.js').Crop} field of `goodType` there
   *  for `farm` — unless the node was taken since the planner chose it (another farmer's field, a fresh
   *  resource/heap), in which case the swing struck ploughed ground and plants nothing (the same
   *  raced-target no-op stance as `harvest`). The field's growth parameters are resolved from the good's
   *  content `farming` block at apply time, so a sow is data-driven end-to-end. */
  | {
      readonly kind: 'sow';
      readonly farm: Entity;
      readonly goodType: number;
      readonly x: number;
      readonly y: number;
    }
  /** A hungry settler **forages a wild {@link import('../components/economy/index.js').BerryBush}**: on
   *  completion it eats the ripe bush's fruit — the bush flips ripe→bare and starts regrowing
   *  (BerryGrowthSystem) — and the eater's hunger zeroes, exactly like `eat`. Unlike `eat` no stored/
   *  carried good is consumed and no job/tool is needed (a bush is wild food anyone can graze); the fruit
   *  simply leaves the bush. A `bush` already bare (another forager beat this one to it since the planner
   *  chose it), or gone, consumes nothing — but hunger still resets (the bite was taken), the same
   *  raced-source stance as `eat`'s empty store. Runs on the eat animation (id 10). */
  | { readonly kind: 'forage'; readonly bush: Entity }
  /** A farmer's **watering** (the original's cultivate atomic) of a growing field: on completion the
   *  {@link import('../components/economy/index.js').Crop} is marked `watered`, which OPENS its growth — an
   *  unwatered field stands at its sown stage (a named approximation — the engine's watering semantics
   *  are not decoded). A field already reaped/ripe, or gone, is a no-op (the water hit stubble). */
  | { readonly kind: 'water'; readonly crop: Entity }
  | { readonly kind: 'idle' };
