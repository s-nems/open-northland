import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * Family components — marriage, residence, and the player-ordered child. The original models the couple
 * engine-internally (no readable spouse field; the pairing shows only through the paired kiss/make_love/
 * give_birth atomics 20/21/78/79/80 and the marriage/birth jingles, `logicdefines.inc`), so these
 * components are the sim's explicit form of that hidden state.
 */

/**
 * Marks a female settler — present ⟺ female, absent ⟺ male. Stamped at creation from the sex-tagged
 * age-class/woman job ids (`baby_female`/`child_female`/`woman`) or the parents' `makeChild` choice, and never
 * removed, so the marker outlives `jobType` — which is where the original encodes sex, losing it on adult
 * trades.
 */
export const Female = defineComponent<{ readonly female: true }>('Female');

/** The one {@link Female} component value — the marker carries no per-entity data. */
export const FEMALE = { female: true } as const;

/**
 * A married settler: `spouse` is its partner for life (both partners carry the mirrored component; a
 * spouse's death removes it — see the CleanupSystem's widowing — except while the couple's child still
 * grows: the widowed parent keeps it as the carrier of the parent-child edge, and `mayMarry` treats
 * that dead-spouse marriage as dissolved once the child is grown). `child` is the couple's one child
 * while it is still growing up — the couple may conceive again only once the child reaches adulthood
 * (its `Age` component is gone) or dies; entity ids are never recycled, so a stale `child` id stays a
 * safe liveness probe.
 */
export const Marriage = defineComponent<{ spouse: Entity; child: Entity | null }>('Marriage');

/**
 * A wedding in progress: the pair walks together, kisses (atomics 20/21), then both get a {@link Marriage}.
 * Both partners carry the mirrored component; the FamilySystem drives the pair from the lower entity id.
 * `kissing` flips when the kiss atomics start, so completion is "kissing and both atomics done"; a partner
 * dying or the walk failing cancels both sides.
 */
export const Wedding = defineComponent<{ partner: Entity; kissing: boolean }>('Wedding');

/** Where a settler lives: the built `home` building it (and its family) is assigned to. Assigned family-wide
 *  by the `assignHouse` command; a home houses up to `homeSize` FAMILIES (see `familiesOf`). */
export const Residence = defineComponent<{ home: Entity }>('Residence');

/**
 * A married woman's standing "make a son/daughter" order (the player picks the sex — the one readable
 * sex-determination seam, so no RNG is needed at birth). It persists until the birth succeeds; other orders
 * interrupt but never cancel it. The FamilySystem drives its stages: stock the home with
 * {@link CHILD_FOOD_UNITS} food, wait inside for the husband, make love, give birth.
 */
export const ChildOrder = defineComponent<{ child: 'female' | 'male' }>('ChildOrder');

/**
 * Per-tick marker: the FamilySystem is driving this settler (a wedding walk, the food haul, waiting at
 * home), so the AI planner's economy drives leave it alone. Presence also preserves the settler's `Resting`
 * marker across planner passes (the planner otherwise strips it on every replan).
 */
export const FamilyDuty = defineComponent<{ readonly duty: true }>('FamilyDuty');

/** The one {@link FamilyDuty} component value — the marker carries no per-entity data. */
export const FAMILY_DUTY = { duty: true } as const;

/**
 * Food units in a home's stockpile held back for the resident couple's child-making — nobody may eat them
 * (the eat drive treats the home's edible stock minus this as available). Maintained by the FamilySystem at
 * `min(CHILD_FOOD_UNITS, stocked food)` while a resident woman's {@link ChildOrder} is active; removed when
 * the food is consumed at conception or the order deactivates.
 */
export const FoodReserve = defineComponent<{ amount: number }>('FoodReserve');

/**
 * A home where a resident couple is currently making love — both parents are inside and the hearts show
 * over the house (the original's `HOUSE_ACTION_OVERLAY_TYPE_MAKE_LOVE = 2` house overlay + the
 * `PARTICEL_EFFECT_HOUSE_BASE_POINT` events in the make_love animations, `logicdefines.inc`). `wife`
 * names the session's owning couple (a home may house several order-holding couples — they take turns;
 * only the owner's order advances or cancels the session). At `elapsed >= duration` the baby is born.
 */
export const MakingLove = defineComponent<{ wife: Entity; elapsed: number; duration: number }>('MakingLove');

/** How much food a home must stock (and the couple consumes) to conceive a child. Source basis:
 *  user-specified design (the original gates conception on home food engine-internally; homes are the only
 *  food-stocking residences — `houses.ini` `logicstock 16/17` — but the exact threshold is not readable). */
export const CHILD_FOOD_UNITS = 3;
