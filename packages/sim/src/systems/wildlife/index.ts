import {
  ANIMAL_FLAG,
  AnimalFlags,
  HerdMember,
  hasAnimalFlag,
  Owner,
  Position,
  Settler,
  WildHabitat,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { grazingFields, heldByAngerAlone } from '../movement/grazing-fields.js';
import { type HerdRoster, herdEligible, herdRoster } from '../movement/herd-roster.js';
import { settlerMovementNode } from '../movement/traversal.js';
import { animalHitpoints, herdParams } from '../readviews/index.js';
import { settleWildRange, stampAnimalBody, stampAnimalFlags } from '../spawn/animals.js';
import { type BuildingSectors, buildingSectors } from './building-sectors.js';
import { moveBirthPoint, moveWorkCenterPoint } from './range.js';
import { angryStay, type StayPass, stayDecision } from './stay.js';
import { stayClock } from './stay-clock.js';

/**
 * Original behavior: a wild herd leader breeds only when its range upkeep (every 60 ticks, offset by its
 * id) falls inside the first 12 ticks of every 600th 12-tick span. Since 7200 is a multiple of 60, only a
 * leader whose id modulo 60 is 0 or 49..59 ever lands there, once every 7200 ticks; the rest never breed.
 */
export const BREEDING_SPAN_TICKS = 12;
export const BREEDING_SPANS_PER_ROUND = 600;

/**
 * Free-roaming animal life outside a fight: each herd leader's range upkeep on its 60-tick slot, then the
 * stay decision of every wild animal whose clip or walk has ended.
 *
 * Original behavior, the upkeep of an unowned leader: its birth point drifts away from sectors holding
 * buildings, its work center creeps over grass, and a herd of more than one and under
 * `maximumgroupsize` breeds an adult at the leader's feet. An owned herd keeps its range fixed.
 * Approximation: the original skips a leader's update while it is between two map points; here the
 * upkeep runs on its slot regardless.
 */
export const wildlifeSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no ground to range over
  const terrain = ctx.terrain;
  const roster = herdRoster(world);
  let blocked: BlockOverlay | undefined;
  const leaders = roster.leadersDueAt(ctx.tick);
  if (leaders.length > 0) {
    let sectors: BuildingSectors | undefined;
    for (const leader of [...leaders]) {
      if (!world.has(leader, WildHabitat) || world.has(leader, Owner)) continue;
      sectors ??= buildingSectors(world, terrain);
      blocked ??= dynamicBlockOverlay(world, ctx, terrain);
      const here = settlerMovementNode(world, terrain, leader);
      moveBirthPoint(world, ctx, terrain, sectors, blocked, leader, here);
      moveWorkCenterPoint(world, ctx, terrain, sectors, leader, here);
      breed(world, ctx, terrain, roster, leader, here);
    }
  }

  const clock = stayClock(world);
  const due = clock.take(ctx.tick);
  if (due.length === 0) return;
  const fields = grazingFields(world, ctx.content, terrain);
  blocked ??= dynamicBlockOverlay(world, ctx, terrain);
  const pass: StayPass = { ctx, terrain, fields, blocked, taken: new Set<NodeId>() };
  for (let i = 0; i < due.length; i++) {
    const e = due[i] as Entity;
    if (!herdEligible(world, e)) continue; // claimed or gone: its range no longer runs
    if (fields.grazes(e)) stayDecision(world, pass, e);
    else if (!heldByAngerAlone(world, e) || !angryStay(world, pass, e)) {
      clock.wait(e); // walking, or held by a fight, a fright or an order: decide once it stands free
      continue;
    }
    if (world.get(e, WildHabitat).nextStayAt <= ctx.tick) clock.wait(e);
  }
};

/**
 * Original behavior: a leader of a herd larger than one and under `maximumgroupsize` adds an adult on its
 * own map point, on the breeding ticks, unless its flags say it never breeds. The newcomer carries the
 * leader's flags.
 *
 * Deviation: the newcomer joins the herd that bore it. The original leaves it leaderless, so a species
 * without `searchforleader` (bears) founds a one-animal herd that never fills its parents' herd, and a
 * pair keeps breeding without end.
 */
function breed(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  roster: HerdRoster,
  leader: Entity,
  here: NodeId,
): void {
  if (Math.floor(ctx.tick / BREEDING_SPAN_TICKS) % BREEDING_SPANS_PER_ROUND !== 0) return;
  if (hasAnimalFlag(world, leader, ANIMAL_FLAG.NEVER_BREEDS)) return;
  const tribe = world.get(leader, Settler).tribe;
  const herd = herdParams(ctx.content, tribe);
  const size = roster.herdSize(leader);
  if (herd === null || size <= 1 || size >= herd.maxGroupSize) return;
  const hitpoints = animalHitpoints(ctx.content, tribe) ?? 0;
  if (hitpoints <= 0) return;
  const e = world.create();
  world.add(e, Position, positionOfNode(terrain.xOf(here), terrain.yOf(here)));
  stampAnimalBody(world, ctx, e, tribe, hitpoints);
  stampAnimalFlags(world, e, world.tryGet(leader, AnimalFlags)?.bits ?? 0);
  settleWildRange(world, ctx, e, new Set<NodeId>());
  world.add(e, HerdMember, { leader });
  roster.update();
}
