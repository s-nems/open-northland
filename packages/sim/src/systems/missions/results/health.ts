import {
  Building,
  Health,
  HOUSE_BEHAVIOUR,
  hasHouseBehaviour,
  MissionObjectId,
  ownerOf,
  Person,
  Position,
} from '../../../components/index.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { markStructureDamaged } from '../../economy/repair.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { withinRange } from '../targets.js';

/** How many houses one damage line may hit, whatever it addresses (reading: the original fills a
 *  100-entry buffer and stops). */
const HOUSE_DAMAGE_CAP = 100;

/** Set every human standing within `range` of the point to its max, whoever owns it - the original heals
 *  friend and foe alike, and takes a temple's surplus away too. */
export function healHumansInArea(pass: MissionPass, point: HalfCellNode, range: number): void {
  const { world } = pass;
  for (const e of world.query(Person, Health, Position)) {
    const health = world.get(e, Health);
    if (health.hitpoints === health.max) continue; // mut-on-change: a full human must not be dirtied
    if (!withinRange(world, e, point, range)) continue;
    world.mut(e, Health).hitpoints = health.max;
  }
}

/**
 * Take `amount` hit points off the player's houses within `range` of the point, floored at zero; a
 * house drained to zero is razed by the reaper like any other. An indestructible house is skipped,
 * and so is the house carrying `exemptId` where the line names one.
 */
export function damageHousesInArea(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'RemoveHPsOfHousesInArea' | 'RemoveHPsOfHousesInAreaX' }>,
): void {
  if (op.amount <= 0) return; // a non-positive line would heal what it addresses
  const { world } = pass;
  const exemptId = 'objectId' in op ? op.objectId : 0;
  const addressed = world
    .canonicalQuery(Building, Health, Position)
    .filter(
      (e) =>
        ownerOf(world, e) === op.player &&
        withinRange(world, e, op.point, op.range) &&
        (exemptId === 0 || world.tryGet(e, MissionObjectId)?.id !== exemptId),
    );
  for (const e of addressed.slice(0, HOUSE_DAMAGE_CAP)) {
    if (hasHouseBehaviour(world, e, HOUSE_BEHAVIOUR.INDESTRUCTIBLE)) continue;
    const health = world.mut(e, Health);
    health.hitpoints = Math.max(0, health.hitpoints - op.amount);
    markStructureDamaged(world, pass.ctx, e);
  }
}
