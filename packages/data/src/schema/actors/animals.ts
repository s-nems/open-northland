import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/** The engine's juvenile pool for an `[animaltype]` without `hitpoints_baby`. */
const ANIMAL_BABY_HITPOINTS_DEFAULT = 500;

/**
 * One `[animaltype]` record from the base `Data/logic/animaltypes.ini`: the behaviour of a
 * non-controllable creature tribe (bear, wolf, boar, cow, sheep). Unlike every other type table it keys
 * on `tribetype`, not `type` - the source carries no `type` id - so `tribeType` is the cross-reference
 * key, validated against the tribe table.
 */
export const AnimalType = z.strictObject({
  /** Slug of `name`/comment when present, else `animal_<tribeType>`. Not a cross-ref key - `tribeType` is. */
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`animaltype` `tribetype`) - the cross-ref into {@link TribeType}, and the record key. */
  tribeType: TypeId,
  /** `aggressive` - attacks civilizations unprovoked. */
  aggressive: z.boolean().default(false),
  /** `getangry` - can be provoked into hostility (vs always-passive). */
  getAngry: z.boolean().default(false),
  /** `angryGameTime` - how long (game ticks) an angered animal stays hostile. */
  angryGameTime: z.number().int().nonnegative().default(0),
  /** `hitpoints_adult` - the adult HP pool (200..20000 in the base data). */
  hitpointsAdult: z.number().int().nonnegative().default(0),
  /** `hitpoints_baby` - the juvenile HP pool, not inferred from `hitpointsAdult`. An omitted key reads as
   *  the engine's pre-parse default 500 (the original 0x411c16), which is what a calf gets: the base
   *  cow block has none. The adult pool keeps 0 for an omitted key instead of the engine's 1000, since the
   *  sim reads a pool-less record as a decorative swarm. */
  hitpointsBaby: z.number().int().nonnegative().default(ANIMAL_BABY_HITPOINTS_DEFAULT),
  /** `maximumgroupsize` - how many of this animal form a herd/pack. */
  maximumGroupSize: z.number().int().nonnegative().default(0),
  /** `maximumcadaversize` - herd-corpse cap. */
  maximumCadaverSize: z.number().int().nonnegative().default(0),
  /** `maximumleaderdistance` - how far a member roams from its herd leader. */
  maximumLeaderDistance: z.number().int().nonnegative().default(0),
  /** `searchforleader` - whether a member seeks a leader to follow (herd animals) vs roams solo. */
  searchForLeader: z.boolean().default(false),
  /** `maximumdistancetostaypoint` - territory radius around the animal's stay point. */
  maximumDistanceToStayPoint: z.number().int().nonnegative().default(0),
  /** `maximumdistancetobirthpoint` - how far the herd ranges from its birth/spawn point. */
  maximumDistanceToBirthPoint: z.number().int().nonnegative().default(0),
  /** `movespeed` - walking speed (0 = the source default). */
  moveSpeed: z.number().int().nonnegative().default(0),
  /** `runspeed` - the original's animal run gait; 0 when the source omits it. Extracted for fidelity
   *  but unconsumed: the sim models no run gait. */
  runSpeed: z.number().int().nonnegative().default(0),
  /** `catchable` - livestock a scout claims by contact (cows/sheep) vs wild-only. */
  catchable: z.boolean().default(false),
  /** `warrantable` - can be claimed/owned (livestock vs wildlife). */
  warrantable: z.boolean().default(false),
  /** `cannotbeattacked` - immune to civ attacks (bees/decorative fauna). */
  cannotBeAttacked: z.boolean().default(false),
  /** `ignorehouses` - pathing ignores buildings (it walks through/over them). */
  ignoreHouses: z.boolean().default(false),
  source: Provenance.optional(),
});
export type AnimalType = z.infer<typeof AnimalType>;
