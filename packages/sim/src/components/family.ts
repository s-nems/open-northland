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
 * Why a standing child order waits undriven: the wife has no home, it is still a building site, the
 * husband lives in another one, or his trade never comes home.
 */
export type ChildOrderBlocker = 'noHome' | 'homeUnbuilt' | 'livesApart' | 'husbandAway';

/**
 * A married woman's standing make-a-child order. The player picks the sex - the one readable
 * sex-determination seam, so no RNG is needed at birth. It persists until the birth succeeds; other orders
 * interrupt but never cancel it, and only the assistant gives back a booking of its own that blocks.
 */
export const ChildOrder = defineComponent<{
  child: 'female' | 'male';
  /** Her last search for food outside the home found none, so she searches again only on retry ticks. */
  foodSearchMissed?: true | undefined;
  /** Set while the order waits on something only the player can change, so the HUD can say what. */
  blocked?: ChildOrderBlocker | undefined;
}>('ChildOrder', 'settlers');

/**
 * Per-tick marker: the FamilySystem is driving this settler, so the planner's economy drives leave it alone
 * and its `Resting` marker survives a replan that would otherwise strip it.
 */
export const FamilyDuty = defineComponent<{ readonly duty: true }>('FamilyDuty', 'settlers');

/**
 * Durable household supplies held by a home. Values use the original house-quality scale rather than
 * ware units: one delivered item can add many points, while an individual use spends only a few.
 */
export const HomeQuality = defineComponent<{
  cooking: number;
  rest: number;
  piety: number;
}>('HomeQuality', 'settlers');

/** Settlement-wide permission to supply and consume each household good. Absent means
 *  {@link DEFAULT_HOUSEHOLD_GOOD_POLICY}. */
export const HouseholdGoodPolicy = defineComponent<{
  player: number;
  cooking: boolean;
  rest: boolean;
  piety: boolean;
}>('HouseholdGoodPolicy', 'players');

/** A player's household-good policy until it changes one: holy oil starts off, so its homes burn none
 *  unless the player allows it (owner rule). */
export const DEFAULT_HOUSEHOLD_GOOD_POLICY: Readonly<{ cooking: boolean; rest: boolean; piety: boolean }> = {
  cooking: true,
  rest: true,
  piety: false,
};

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

/** How much food a home must stock, and the couple consumes, to conceive a child. Original behavior: the
 *  child task starts only while the home holds at least 2 food units and takes them as the make-love
 *  begins; nothing is held back before that, so residents may eat the larder empty meanwhile. */
export const CHILD_FOOD_UNITS = 2;
