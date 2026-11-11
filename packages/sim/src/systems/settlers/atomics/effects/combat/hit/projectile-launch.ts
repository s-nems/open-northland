import {
  Building,
  Health,
  Owner,
  Palisade,
  Position,
  Projectile,
  Settler,
  SettlerProgress,
} from '../../../../../../components/index.js';
import type { AtomicEffect } from '../../../../../../core/atomic-effect.js';
import { eventAt } from '../../../../../../core/events.js';
import type { Fixed } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import {
  hexDistanceBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
  positionOfNode,
} from '../../../../../../nav/halfcell.js';
import {
  leadPoint,
  mapPointDistance,
  marksmanSpread,
  scatteredNode,
  shotFlightTicks,
  shotLandDelay,
} from '../../../../../conflict/shot-aim.js';
import { buildingBodyNodes } from '../../../../../conflict/target-node.js';
import type { SystemContext } from '../../../../../context.js';
import { weaponClassHits } from '../../../../../progression/index.js';
import { isHeroJob, WEAPON_MAIN_TYPE } from '../../../../../readviews/index.js';
import { entityNode } from '../../../../../spatial/nodes.js';
import { exploreAround, SHOT_SIGHT_NODES } from '../../../../../vision/index.js';

type RangedSwing = NonNullable<Extract<AtomicEffect, { kind: 'attack' }>['projectile']>;

/** One shot as its shooter looses it: who fires, the weapon it carries, and where it comes down. */
export interface LooseShot {
  readonly source: Entity;
  readonly target: Entity;
  readonly player: number | null;
  readonly weapon: RangedSwing;
  readonly weaponMainType: number | null;
  /** The defence-mode building that fires the shot itself, read only by the render. */
  readonly cover: Entity | null;
  readonly aim: { readonly x: Fixed; readonly y: Fixed };
  /** Where the shot leaves from when its source stands nowhere on the map: the ship a deck bowman rides. */
  readonly from?: { readonly x: Fixed; readonly y: Fixed };
}

/**
 * Loose a settler's ranged swing at its attack-event frame. The shot is aimed where the target will be:
 * ahead of a walking one, at a random node of a building's or a wall's body. Its damage resolves on contact
 * against whatever it strikes. Original behavior.
 */
export function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
): void {
  const weapon = effect.projectile;
  if (weapon === undefined) return; // not a ranged swing; the caller already gates this
  if (!world.has(attacker, Position) || !world.has(effect.target, Position)) return;
  // A target drained to 0 earlier this tick is dead but not yet reaped: no shot, and no launch cue, at a
  // corpse. Checked before the aim draws, so a withheld shot takes nothing from the stream.
  if ((world.tryGet(effect.target, Health)?.hitpoints ?? 0) <= 0) return;
  looseSettlerShot(world, ctx, attacker, attacker, effect.target, weapon, effect.weaponMainType ?? null, 0);
}

/**
 * Loose settler `shooter`'s shot at `target` from `body`: the shooter himself, or the ship a deck bowman
 * rides. `extraSpread` nodes widen its scatter.
 */
export function looseSettlerShot(
  world: World,
  ctx: SystemContext,
  shooter: Entity,
  body: Entity,
  target: Entity,
  weapon: RangedSwing,
  weaponMainType: number | null,
  extraSpread: number,
): void {
  const release = world.tryGet(body, Position);
  if (release === undefined) return;
  const experience = world.tryGet(shooter, SettlerProgress)?.experience ?? new Map<number, number>();
  looseProjectile(world, ctx, {
    source: shooter,
    target,
    player: world.tryGet(shooter, Owner)?.player ?? null,
    weapon,
    weaponMainType,
    cover: null,
    aim: settlerAim(world, ctx, shooter, body, target, weapon.speed, experience, extraSpread),
    ...(body !== shooter ? { from: release } : {}),
  });
}

/**
 * Where a settler's shot at `target` comes down: the point it aims at, scattered by how practised a bowman
 * it is over the range. Original behavior; a hero always shoots true.
 */
function settlerAim(
  world: World,
  ctx: SystemContext,
  shooter: Entity,
  body: Entity,
  target: Entity,
  speed: number,
  experience: ReadonlyMap<number, number>,
  extraSpread: number,
): { x: Fixed; y: Fixed } {
  const terrain = ctx.terrain;
  if (terrain === undefined) return world.get(target, Position);
  let aim: { x: Fixed; y: Fixed };
  let mark = entityNode(world, terrain, target);
  if (world.has(target, Building) || world.has(target, Palisade)) {
    const walls = buildingBodyNodes(world, ctx, terrain, target);
    mark = walls[ctx.rng.int(walls.length)] ?? mark;
    aim = positionOfNode(terrain.xOf(mark), terrain.yOf(mark));
  } else {
    aim = leadPoint(world, ctx, world.get(body, Position), target, speed);
    mark = terrain.nodeAtClamped(nodeHxOfPosition(aim.x, aim.y), nodeHyOfPosition(aim.x, aim.y));
  }
  if (isHeroJob(ctx.content, world.tryGet(shooter, Settler)?.jobType ?? null)) return aim;
  const from = entityNode(world, terrain, body);
  const distance = hexDistanceBetween(
    terrain.xOf(from),
    terrain.yOf(from),
    terrain.xOf(mark),
    terrain.yOf(mark),
  );
  const spread =
    marksmanSpread(ctx, distance, weaponClassHits(experience, WEAPON_MAIN_TYPE.BOW)) + extraSpread;
  if (spread === 0) return aim;
  const landing = scatteredNode(ctx, terrain, mark, spread);
  return positionOfNode(terrain.xOf(landing), terrain.yOf(landing));
}

/** Put `shot` in flight from its source's position toward its aim. */
export function looseProjectile(world: World, ctx: SystemContext, shot: LooseShot): void {
  const from = shot.from ?? world.tryGet(shot.source, Position);
  if (from === undefined) return;
  const p = world.create();
  world.add(p, Position, { x: from.x, y: from.y });
  world.add(p, Projectile, {
    source: shot.source,
    target: shot.target,
    player: shot.player,
    hitSelf: shot.weapon.hitSelf,
    area: shot.weapon.area,
    // The shot owns its copies, as the swing owns its own.
    damage: { ...shot.weapon.damage },
    hitSounds: { ...shot.weapon.hitSounds },
    weaponMainType: shot.weaponMainType,
    missSounds: { ...shot.weapon.missSounds },
    munitionType: shot.weapon.munitionType,
    // Frozen at release: the render's ballistic-arc origin and the landing blow's direction.
    originX: from.x,
    originY: from.y,
    // Both the sim and render follow this release-time chord; a runner cannot bend an arrow in flight.
    aimX: shot.aim.x,
    aimY: shot.aim.y,
    cover: shot.cover,
    launchTick: ctx.tick,
    // Original behavior: the flight time runs from the shooter to where the shot comes down.
    landTick: ctx.tick + shotLandDelay(shotFlightTicks(mapPointDistance(from, shot.aim), shot.weapon.speed)),
    impact: null,
  });
  // Original behavior: a shooter sees where its shot is aimed.
  exploreAround(ctx.fog, shot.player, shot.aim, SHOT_SIGHT_NODES);
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: p,
    shooter: shot.source,
    target: shot.target,
    munitionType: shot.weapon.munitionType,
    at: eventAt(from.x, from.y),
  });
}
