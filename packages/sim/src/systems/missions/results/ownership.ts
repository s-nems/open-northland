import {
  isValidPlayer,
  Owner,
  Person,
  Position,
  Residence,
  Settler,
  stampOwner,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { releaseEmployment } from '../../economy/jobs/binding.js';
import { canonicalById } from '../../spatial/nodes.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHouses, missionHumans, ownedBy, ownedInRange, withinRange } from '../targets.js';

/** How many animals one `ChangeAnimalPlayerIdInArea` may take, whatever it asks for (reading). */
const ANIMAL_HANDOVER_CAP = 50;

/** Hand every human stamped with the id to `player`, detaching each from the job and home it held
 *  under its old owner (reading). */
export function handHumansToPlayer(pass: MissionPass, id: number, player: number): void {
  if (!isValidPlayer(player)) return;
  for (const e of missionHumans(pass.world, id)) {
    detachFromHouses(pass.world, pass.ctx, e);
    stampOwner(pass.world, e, player);
  }
}

/** Hand every house stamped with the id to `player`. */
export function handHousesToPlayer(pass: MissionPass, id: number, player: number): void {
  for (const e of missionHouses(pass.world, id)) stampOwner(pass.world, e, player);
}

/** Hand everything one player owns to another - units, houses, vehicles and animals alike. Nobody is
 *  evicted: a town changes flag whole, so every binding inside it still points at the same owner. */
export function handPlayerToPlayer(pass: MissionPass, from: number, to: number): void {
  const { world } = pass;
  if (!isValidPlayer(from)) return;
  const owned = canonicalById(world.query(Owner)).filter((e) => world.get(e, Owner).player === from);
  for (const e of owned) stampOwner(world, e, to);
}

/** Hand everything one player owns within `range` of the point to another; its humans leave the job
 *  and home they held, as under `ChangeHumanPlayerId` (reading). */
export function handAreaToPlayer(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'ChangePlayerIdInArea' }>,
): void {
  if (!isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) return;
  for (const e of ownedInRange(pass.world, op.player, op.point, op.range)) {
    if (pass.world.has(e, Person)) detachFromHouses(pass.world, pass.ctx, e);
    stampOwner(pass.world, e, op.otherPlayer);
  }
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
  let taken = 0;
  for (const e of canonicalById(world.query(Settler, Position))) {
    if (taken >= wanted) break;
    if (world.has(e, Person) || world.get(e, Settler).tribe !== op.tribe) continue;
    if (!ownedBy(world, e, op.player) || !withinRange(world, e, op.point, op.range)) continue;
    stampOwner(world, e, op.otherPlayer);
    taken++;
  }
}

function detachFromHouses(world: World, ctx: SystemContext, e: Entity): void {
  if (!world.has(e, Settler)) return;
  releaseEmployment(world, ctx, e);
  world.remove(e, Residence);
}
