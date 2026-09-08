import type { EquipCategory } from '@open-northland/data';
import type { Entity } from '../ecs/world.js';

/** The effect an atomic action applies on completion. */
export type AtomicEffect =
  | { readonly kind: 'move'; readonly to: { x: number; y: number } }
  | { readonly kind: 'harvest'; readonly resource: Entity; readonly goodType: number }
  | {
      readonly kind: 'pickup';
      readonly goodType: number;
      readonly amount: number;
      /** The store the goods come out of, or null for a sourceless pickup (the goods appear on the
       *  settler's back). Goods are conserved: a pickup `from` a store removes exactly what it adds to
       *  the carrier. */
      readonly from: Entity | null;
    }
  | { readonly kind: 'pileup'; readonly store: Entity }
  | { readonly kind: 'produce'; readonly recipeOutput: number }
  /** A consumer worker draws one unit of `goodType` from the input-less shared utility `utility` (a well
   *  for water, a hive for honey) onto its back. The utility mints from no inputs, so the draw creates
   *  the unit; a utility gone since the planner chose it still yields. */
  | { readonly kind: 'draw'; readonly goodType: number; readonly utility: Entity }
  | {
      readonly kind: 'eat';
      readonly goodType: number;
      /** The store the food is consumed from (a stockpile the eater stands on), or null when the eater
       *  consumes a unit it already carries. One unit of `goodType` is destroyed on completion. */
      readonly from: Entity | null;
    }
  /** The settler drinks the draught in misc equipment slot `slot`, in place, on the eat animation. */
  | { readonly kind: 'drink'; readonly slot: number }
  /** The settler sleeps: its clip's `event <at> 1 <delta>` pulses take the rest off its `fatigue`. No
   *  goods are consumed. */
  | { readonly kind: 'sleep' }
  /** The settler prays: its clip's `event <at> 4 <delta>` pulses take the prayer off its `piety`. It must
   *  stand on a temple to run it. */
  | { readonly kind: 'pray' }
  /** The settler runs one drill repetition inside a barracks, charged against the errand's remaining
   *  drill time. Nothing else accrues: the TRAINING bucket grants no experience. */
  | { readonly kind: 'exercise' }
  /** The settler swings at `target`, subtracting `damage` from its `Health.hitpoints`, clamped at 0.
   *  `damage` arrives already resolved from the weapon's `damagevalue[targetMaterial]`. A `target` with
   *  no `Health` is a no-op. */
  | {
      readonly kind: 'attack';
      readonly target: Entity;
      readonly damage: number;
      /** The animation's `ATOMIC_EVENT_TYPE_ATTACK` frame the blow lands on; the completion frame when
       *  omitted. */
      readonly hitAt?: number;
      /** `WeaponType.mainType`, which keys the fight-experience bucket; omitting it accrues no fight XP. */
      readonly weaponMainType?: number;
      /** The melee weapon's reach in half-cell nodes, re-checked at the hit frame: a target that stepped
       *  beyond it during the swing takes no damage. Absent means no reach check. */
      readonly maxRange?: number;
      /** Present for a ranged swing: at `hitAt` a projectile of this ammunition class and travel speed
       *  flies at `target` instead of the blow landing in place, dealing the same `damage` on contact. */
      readonly projectile?: { readonly munitionType: number; readonly speed: number };
    }
  /** A builder's construction swing at `site`: advances the site's builder-work `labor` by one strike's
   *  quantum (`+ONE / (totalConstructionUnits · strikesPerUnit)`), clamped at ONE. No goods move here;
   *  the visible `Building.built` is derived from `min(labor, deliveredFraction)`. */
  | { readonly kind: 'construct'; readonly site: Entity }
  /** The scout's build-guide swing completed: a signpost owned by the swinging scout's player appears at
   *  half-cell node `(x, y)`. Observation: one hammer strike, instant, no materials. The spot is
   *  re-validated at application, and an illegal spot means the swing whiffs. */
  | { readonly kind: 'erectSignpost'; readonly x: number; readonly y: number }
  /** A farmer's sowing swing plants a `goodType` crop field for `farm` at free field node `(x, y)`
   *  (half-cell coords); a node taken since the planner chose it plants nothing. Growth parameters
   *  resolve from the good's content `farming` block at apply time. */
  | {
      readonly kind: 'sow';
      readonly farm: Entity;
      readonly goodType: number;
      readonly x: number;
      readonly y: number;
    }
  /** A hungry settler forages a wild ripe `bush`: the bush flips ripe to bare and regrows, and the eat
   *  clip's own events feed the forager. No stored or carried good is consumed and no job or tool is
   *  needed; a bush already bare or gone consumes nothing but the meal still counts. */
  | { readonly kind: 'forage'; readonly bush: Entity }
  /** A farmer's watering (the original's cultivate atomic) steps `crop` and every field on its six lattice
   *  neighbours one growth stage; nothing else grows a field. Approximation: the reach is not readable. A
   *  target already reaped or gone waters nothing; a ripe field in reach stands. */
  | { readonly kind: 'water'; readonly crop: Entity }
  /** The settler sets its whole carried load down on its own tile, spilling any remainder over the
   *  `MAX_GROUND_STACK` cap onto the nearest free walkable nodes. No good is lost. */
  | { readonly kind: 'drop' }
  /** The settler lifts one unit of `goodType` out of the store or pile `from` straight into equipment
   *  slot (`group`, `slot`). A fresh swapped-out good moves onto the back for stowing and a part-used
   *  one is destroyed; otherwise goods are conserved, and a source gone or emptied mid-swing whiffs. */
  | {
      readonly kind: 'equip';
      readonly from: Entity;
      readonly goodType: number;
      readonly group: EquipCategory;
      readonly slot: number;
    }
  /** The settler takes the good in equipment slot (`group`, `slot`) off at the stow store `sink`, so the
   *  item stays visibly worn for the walk there. A fresh unit deposits into `sink`; a part-used one is
   *  destroyed in place with `sink` null. An already-empty slot whiffs. */
  | {
      readonly kind: 'unequip';
      readonly group: EquipCategory;
      readonly slot: number;
      readonly sink: Entity | null;
    }
  | { readonly kind: 'idle' };
