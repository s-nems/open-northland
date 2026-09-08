import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * The original models the couple engine-internally - no readable spouse field, the pairing shows only
 * through the paired kiss/make_love/give_birth atomics (20/21/78/79/80, `logicdefines.inc`) - so these
 * components are the explicit form of that hidden state.
 */

/**
 * Marks a female settler - present means female, absent means male. Stamped at creation from the sex-tagged
 * age-class/woman job ids or the parents' `makeChild` choice and never removed, so it outlives `jobType`,
 * which is where the original encodes sex and which an adult trade overwrites.
 */
export const Female = defineComponent<{ readonly female: true }>('Female', 'settlers');

/**
 * A married settler: `spouse` is its partner for life, mirrored on both, removed on a spouse's death unless
 * the couple's child still grows - the widowed parent then carries the parent-child edge until the child
 * grows up or dies. `child` is the couple's one growing child; they may conceive again only once it reaches
 * adulthood or dies. Entity ids are never recycled, so a stale `child` id stays a safe liveness probe.
 */
export const Marriage = defineComponent<{ spouse: Entity; child: Entity | null }>('Marriage', 'settlers');

/**
 * A wedding in progress: the pair walks together, kisses (atomics 20/21), then both get a {@link Marriage}.
 * Mirrored on both partners. `kissing` flips when the kiss atomics start, so completion is "kissing and
 * both atomics done".
 */
export const Wedding = defineComponent<{ partner: Entity; kissing: boolean }>('Wedding', 'settlers');

/** Where a settler lives: the built `home` building it is assigned to. The `assignHouse` command assigns a
 *  whole family at once; a home houses up to `homeSize` families rather than settlers (see `familiesOf`). */
export const Residence = defineComponent<{ home: Entity }>('Residence', 'settlers');

/**
 * A married woman's standing make-a-child order. The player picks the sex - the one readable
 * sex-determination seam, so no RNG is needed at birth. It persists until the birth succeeds; other orders
 * interrupt but never cancel it.
 */
export const ChildOrder = defineComponent<{ child: 'female' | 'male' }>('ChildOrder', 'settlers');

/**
 * Per-tick marker: the FamilySystem is driving this settler, so the planner's economy drives leave it alone
 * and its `Resting` marker survives a replan that would otherwise strip it.
 */
export const FamilyDuty = defineComponent<{ readonly duty: true }>('FamilyDuty', 'settlers');

/**
 * Food units in a home's stockpile held back for the resident couple's child-making: the eat drive treats
 * the home's edible stock minus this as available. The FamilySystem holds it at `min(CHILD_FOOD_UNITS,
 * stocked food)` while a resident woman's {@link ChildOrder} is active.
 */
export const FoodReserve = defineComponent<{ amount: number }>('FoodReserve', 'settlers');

/**
 * A home where a resident couple is currently making love - both parents inside, hearts over the house (the
 * original's `HOUSE_ACTION_OVERLAY_TYPE_MAKE_LOVE = 2` overlay and `PARTICEL_EFFECT_HOUSE_BASE_POINT` in
 * the make_love animations, `logicdefines.inc`). `wife` names the couple whose order advances or cancels
 * this session, since a home may house several order-holding couples. At `elapsed >= duration` the baby is
 * born.
 */
export const MakingLove = defineComponent<{ wife: Entity; elapsed: number; duration: number }>(
  'MakingLove',
  'settlers',
);

/** How much food a home must stock, and the couple consumes, to conceive a child. Authored: the original
 *  gates conception on home food engine-internally; homes are the food-stocking residences (`houses.ini`
 *  `logicstock 16/17`) and the exact threshold is not readable. */
export const CHILD_FOOD_UNITS = 3;
