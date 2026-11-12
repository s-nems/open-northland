import {
  AttackOrder,
  BuildMode,
  Engagement,
  Evicted,
  GraduateWait,
  isValidPlayer,
  isWildlife,
  Owner,
  ownerOf,
  Person,
  Position,
  Residence,
  Rider,
  Settler,
  Signpost,
  SiteAssignment,
  Stance,
  stampOwner,
  TradeRoute,
  TrainingOrder,
} from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import { releaseEmployment } from '../../economy/jobs/binding.js';
import { releaseSiteClaim } from '../../economy/site-claim.js';
import { householdGoodAllowed } from '../../family/home-quality.js';
import { moveOutOfUnfurnishedHomes } from '../../family/lodging.js';
import { leaveFamily } from '../../family/widowhood.js';
import { cutAnimalBindings } from '../../livestock/capture.js';
import { anchorAtFeet } from '../../orders/combat.js';
import { isFighterJob, MILITARY_MODE } from '../../readviews/index.js';
import { callOffCoinDrill } from '../../settlers/drives/coin-drill-coins.js';
import { releaseTowerPost } from '../../settlers/drives/tower-post.js';
import { relinkSignpost } from '../../signposts/index.js';
import { releaseTradeShip } from '../../vehicles/hauling-cart.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHouses, ownedBy, ownedInRange, scriptedHumans, withinRange } from '../targets.js';
import { type Handed, withOwners } from './seat-tribes.js';
import { detachScriptedRider } from './vehicles.js';

/** How many animals one `ChangeAnimalPlayerIdInArea` may take, whatever it asks for (reading). */
const ANIMAL_HANDOVER_CAP = 50;

/** Hand every human stamped with the id to `player`, cut loose from what it held under its old owner
 *  ({@link cutLoose}). A unit keeps its form (`lifecycle/unit-form.ts`): a script's dragons stay dragons
 *  in the receiver's hands. Returns the humans handed. */
export function handHumansToPlayer(pass: MissionPass, id: number, player: number): readonly Handed[] {
  if (!isValidPlayer(player)) return [];
  const handed = withOwners(pass.world, scriptedHumans(pass.world, id));
  for (const { entity: e } of handed) {
    cutLoose(pass, e);
    restamp(pass, e, player);
  }
  leaveForeignVehicles(pass, handed);
  return handed;
}

/** Hand every house stamped with the id to `player`. Returns the houses handed. */
export function handHousesToPlayer(pass: MissionPass, id: number, player: number): readonly Handed[] {
  const handed = withOwners(pass.world, missionHouses(pass.world, id));
  for (const { entity } of handed) stampOwner(pass.world, entity, player);
  return handed;
}

/** Hand everything one player owns to another - units, houses, vehicles and animals alike. No human
 *  is cut loose: a town changes flag whole, so a home or a workplace still points at the same owner. */
export function handPlayerToPlayer(pass: MissionPass, from: number, to: number): readonly Handed[] {
  const { world } = pass;
  if (!isValidPlayer(from) || !isValidPlayer(to) || from === to) return [];
  const handed = withOwners(
    world,
    world.canonicalQuery(Owner).filter((e) => world.get(e, Owner).player === from),
  );
  for (const { entity } of handed) restamp(pass, entity, to);
  relinkHandedSignposts(pass, handed);
  // The receiver's household policy now rules the homes: one that forbids furniture houses no extras.
  if (!householdGoodAllowed(world, to, 'lodging')) moveOutOfUnfurnishedHomes(world, pass.ctx, to);
  return handed;
}

/** Hand everything one player owns within `range` of the point to another; its humans are cut loose as
 *  under `ChangeHumanPlayerId` (original behavior), a crew aboard a vehicle handed with it keeping its
 *  seats. */
export function handAreaToPlayer(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'ChangePlayerIdInArea' }>,
): readonly Handed[] {
  if (!isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) return [];
  const handed = withOwners(pass.world, ownedInRange(pass.world, op.player, op.point, op.range));
  for (const { entity: e } of handed) {
    if (pass.world.has(e, Person)) cutLoose(pass, e);
    restamp(pass, e, op.otherPlayer);
  }
  leaveForeignVehicles(pass, handed);
  relinkHandedSignposts(pass, handed);
  return handed;
}

/** Relink the signposts among `handed` once every one carries its new owner, so posts handed together
 *  link to each other as well as to the receiver's. */
function relinkHandedSignposts(pass: MissionPass, handed: readonly Handed[]): void {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined) return;
  for (const { entity } of handed)
    if (pass.world.has(entity, Signpost)) relinkSignpost(pass.world, terrain, entity, pass.ctx.content);
}

/**
 * Hand animals of one species within `range` to another player: `amount` of them, or every match for
 * an amount of 0, and never more than {@link ANIMAL_HANDOVER_CAP} either way - the corpus asks for
 * 1,000 goats on a line the original serves 50 of. The wild slot names the creatures the sim leaves
 * ownerless, so a script can tame a herd nobody owned.
 */
export function handAnimalsToPlayer(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'ChangeAnimalPlayerIdInArea' }>,
): void {
  const { world } = pass;
  const wanted = op.amount > 0 ? Math.min(op.amount, ANIMAL_HANDOVER_CAP) : ANIMAL_HANDOVER_CAP;
  const herd = world
    .canonicalQuery(Settler, Position)
    .filter(
      (e) =>
        !world.has(e, Person) &&
        world.get(e, Settler).tribe === op.tribe &&
        ownedBy(world, e, op.player) &&
        withinRange(world, e, op.point, op.range),
    );
  for (const e of herd.slice(0, wanted)) restamp(pass, e, op.otherPlayer);
}

/**
 * Give `e` its new owner and settle what every change of player settles (original behavior): a soldier
 * or hero forgets its targets and guards the place it holds, and an animal leaves its herd and its farm.
 */
function restamp(pass: MissionPass, e: Entity, player: number): void {
  const { world, ctx } = pass;
  stampOwner(world, e, player);
  if (ownerOf(world, e) !== player) return;
  if (isWildlife(world, e)) cutAnimalBindings(world, ctx, e);
  if (!world.has(e, Person) || !isFighterJob(ctx.content, world.get(e, Settler).jobType)) return;
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  const anchorCell = world.tryGet(e, Stance)?.anchorCell ?? null;
  world.add(e, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell });
  if (anchorCell === null) anchorAtFeet(world, ctx, e);
}

/**
 * Cut a human loose from what it held under its old owner. Original behavior: it leaves its home, its
 * school, its workplace and the site, road or wall it built on, a trader loses its route, and its family
 * links are cleared on both sides. An order it is walking under stands.
 */
function cutLoose(pass: MissionPass, e: Entity): void {
  const { world, ctx } = pass;
  if (!world.has(e, Settler)) return;
  releaseTowerPost(world, ctx, e); // steps him off the tower while the binding it reads is still there
  releaseEmployment(world, ctx, e);
  world.remove(e, Residence);
  world.remove(e, Evicted);
  world.remove(e, TrainingOrder);
  callOffCoinDrill(world, ctx, e);
  world.remove(e, GraduateWait);
  world.remove(e, BuildMode);
  releaseSiteClaim(world, e);
  world.remove(e, SiteAssignment);
  releaseTradeShip(world, e);
  world.remove(e, TradeRoute);
  leaveFamily(world, e);
}

/**
 * Order every handed human out of a vehicle that now belongs to another player, once the whole line has
 * changed hands. Original behavior: the detach order, which a ship at sea refuses; here it is held until
 * the ship moors, as a script's own detach is (approximation).
 */
function leaveForeignVehicles(pass: MissionPass, handed: readonly Handed[]): void {
  const { world } = pass;
  for (const { entity: e } of handed) {
    const vehicle = world.tryGet(e, Rider)?.vehicle;
    if (vehicle !== undefined && ownerOf(world, vehicle) !== ownerOf(world, e)) detachScriptedRider(pass, e);
  }
}
