import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/**
 * One `[animaltype]` record from the base `Data/logic/animaltypes.ini` — the per-tribe behaviour of a
 * non-controllable creature/monster tribe (bear, wolf, boar, cow, sheep, …). Unlike every other type
 * table, an animal record keys on `tribetype`, not `type`: the source carries no `type` id, and an
 * animal's identity IS its owning tribe (the `Settler.tribe` cross-reference into {@link TribeType}).
 * `tribeType` is therefore the cross-ref key (validated against the tribe table). A handful of source
 * records carry no `tribetype` (a leftover/disabled stub); they are dropped at extract time since they
 * cannot resolve to a tribe.
 *
 * Captured per record:
 *   - `aggressive` / `getangry` — whether the animal attacks unprovoked / can be provoked into anger
 *     (the inputs to the civ-vs-animal aggression model the later combat slice consumes).
 *   - `angryGameTime` — how long (game ticks) an angered animal stays hostile.
 *   - `hitpoints_adult` / `hitpoints_baby` — the HP pool by life-stage (200..20000; the param the sim's
 *     `Health`-component stamp already reads — humans have no readable equivalent below the `.ini`).
 *   - the group/territory params (`maximumgroupsize`, `maximumcadaversize`, `maximumleaderdistance`,
 *     `searchforleader`, `maximumdistancetostaypoint`, `maximumdistancetobirthpoint`) — herd/leader
 *     structure for the later spawn/herding slice.
 *   - `movespeed` / `runspeed` — locomotion (`runspeed` is extracted for fidelity only; the sim
 *     models no run gait).
 *   - the flags `catchable` (can be tamed/captured), `warrantable`, `cannotbeattacked`, `ignorehouses`.
 * The graphics/sound/spawn extras are skipped — this is the behaviour type-table slice, not a renderer.
 */
export const AnimalType = z.strictObject({
  /** Slug of `name`/comment when present, else `animal_<tribeType>`. Not a cross-ref key — `tribeType` is. */
  id: z.string(),
  name: z.string().optional(),
  /** Owning tribe (`animaltype` `tribetype`) — the cross-ref into {@link TribeType}, and the record key. */
  tribeType: TypeId,
  /** `aggressive` — attacks civilizations unprovoked (the civ-vs-animal aggression driver). */
  aggressive: z.boolean().default(false),
  /** `getangry` — can be provoked into hostility (vs always-passive). */
  getAngry: z.boolean().default(false),
  /** `angryGameTime` — how long (game ticks) an angered animal stays hostile. */
  angryGameTime: z.number().int().nonnegative().default(0),
  /** `hitpoints_adult` — the adult HP pool (200..20000); the `Health`-stamp source for animal combatants. */
  hitpointsAdult: z.number().int().nonnegative().default(0),
  /** `hitpoints_baby` — the juvenile HP pool. Not inferred from `hitpointsAdult`; 0 when the source omits it. */
  hitpointsBaby: z.number().int().nonnegative().default(0),
  /** `maximumgroupsize` — how many of this animal form a herd/pack. */
  maximumGroupSize: z.number().int().nonnegative().default(0),
  /** `maximumcadaversize` — herd-corpse cap. */
  maximumCadaverSize: z.number().int().nonnegative().default(0),
  /** `maximumleaderdistance` — how far a member roams from its herd leader. */
  maximumLeaderDistance: z.number().int().nonnegative().default(0),
  /** `searchforleader` — whether a member seeks a leader to follow (herd animals) vs roams solo. */
  searchForLeader: z.boolean().default(false),
  /** `maximumdistancetostaypoint` — territory radius around the animal's stay point. */
  maximumDistanceToStayPoint: z.number().int().nonnegative().default(0),
  /** `maximumdistancetobirthpoint` — how far the herd ranges from its birth/spawn point. */
  maximumDistanceToBirthPoint: z.number().int().nonnegative().default(0),
  /** `movespeed` — walking speed (0 = the source default). */
  moveSpeed: z.number().int().nonnegative().default(0),
  /** `runspeed` — the original's animal run gait; 0 when the source omits it. Extracted for
   *  fidelity but deliberately unconsumed by the sim — no run/sprint gait is modeled. */
  runSpeed: z.number().int().nonnegative().default(0),
  /** `catchable` — can be tamed/captured by a hunter (cows/sheep) vs wild-only. */
  catchable: z.boolean().default(false),
  /** `warrantable` — can be claimed/owned (livestock vs wildlife). */
  warrantable: z.boolean().default(false),
  /** `cannotbeattacked` — immune to civ attacks (bees/decorative fauna). */
  cannotBeAttacked: z.boolean().default(false),
  /** `ignorehouses` — pathing ignores buildings (it walks through/over them). */
  ignoreHouses: z.boolean().default(false),
  source: Provenance.optional(),
});
export type AnimalType = z.infer<typeof AnimalType>;
