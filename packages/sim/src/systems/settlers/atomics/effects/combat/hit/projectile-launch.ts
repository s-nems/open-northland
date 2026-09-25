import {
  Building,
  Health,
  Owner,
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
import { leadPoint, marksmanSpread, scatteredNode } from '../../../../../conflict/shot-aim.js';
import { buildingBodyNodes } from '../../../../../conflict/target-node.js';
import type { SystemContext } from '../../../../../context.js';
import { weaponClassHits } from '../../../../../progression/index.js';
import { isHeroJob, WEAPON_MAIN_TYPE } from '../../../../../readviews/index.js';
import { entityNode } from '../../../../../spatial/nodes.js';

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
}

/**
 * Loose a settler's ranged swing at its attack-event frame. The shot is aimed where the target will be:
 * ahead of a walking one, at a random node of a building's body. Its damage resolves on contact against
 * whatever it strikes. Original behavior.
 */
export function launchProjectile(
  world: World,
  ctx: SystemContext,
  attacker: Entity,
  effect: Extract<AtomicEffect, { kind: 'attack' }>,
): void {
  const weapon = effect.projectile;
  if (weapon === undefined) return; // not a ranged swing; the caller already gates this
  const from = world.tryGet(attacker, Position);
  if (from === undefined || world.tryGet(effect.target, Position) === undefined) return;
  // A target drained to 0 earlier this tick is dead but not yet reaped: no shot, and no launch cue, at a
  // corpse. Checked before the aim draws, so a withheld shot takes nothing from the stream.
  if ((world.tryGet(effect.target, Health)?.hitpoints ?? 0) <= 0) return;
  const experience = world.tryGet(attacker, SettlerProgress)?.experience ?? new Map<number, number>();
  looseProjectile(world, ctx, {
    source: attacker,
    target: effect.target,
    player: world.tryGet(attacker, Owner)?.player ?? null,
    weapon,
    weaponMainType: effect.weaponMainType ?? null,
    cover: null,
    aim: settlerAim(world, ctx, attacker, from, effect.target, weapon.speed, experience),
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
  release: { x: Fixed; y: Fixed },
  target: Entity,
  speed: number,
  experience: ReadonlyMap<number, number>,
): { x: Fixed; y: Fixed } {
  const terrain = ctx.terrain;
  if (terrain === undefined) return world.get(target, Position);
  let aim: { x: Fixed; y: Fixed };
  let mark = entityNode(world, terrain, target);
  if (world.has(target, Building)) {
    const body = buildingBodyNodes(world, ctx, terrain, target);
    mark = body[ctx.rng.int(body.length)] ?? mark;
    aim = positionOfNode(terrain.xOf(mark), terrain.yOf(mark));
  } else {
    aim = leadPoint(world, ctx, release, target, speed);
    mark = terrain.nodeAtClamped(nodeHxOfPosition(aim.x, aim.y), nodeHyOfPosition(aim.y));
  }
  if (isHeroJob(ctx.content, world.tryGet(shooter, Settler)?.jobType ?? null)) return aim;
  const from = entityNode(world, terrain, shooter);
  const distance = hexDistanceBetween(
    terrain.xOf(from),
    terrain.yOf(from),
    terrain.xOf(mark),
    terrain.yOf(mark),
  );
  const spread = marksmanSpread(ctx, distance, weaponClassHits(experience, WEAPON_MAIN_TYPE.BOW));
  if (spread === 0) return aim;
  const landing = scatteredNode(ctx, terrain, mark, spread);
  return positionOfNode(terrain.xOf(landing), terrain.yOf(landing));
}

/** Put `shot` in flight from its source's position toward its aim. */
export function looseProjectile(world: World, ctx: SystemContext, shot: LooseShot): void {
  const from = world.tryGet(shot.source, Position);
  if (from === undefined) return;
  const p = world.create();
  world.add(p, Position, { x: from.x, y: from.y });
  world.add(p, Projectile, {
    source: shot.source,
    target: shot.target,
    player: shot.player,
    // The shot owns its copies, as the swing owns its own.
    damage: { ...shot.weapon.damage },
    hitSounds: { ...shot.weapon.hitSounds },
    weaponMainType: shot.weaponMainType,
    missSounds: { ...shot.weapon.missSounds },
    munitionType: shot.weapon.munitionType,
    speed: shot.weapon.speed,
    // The render's ballistic-arc origin, frozen at release and never read in flight.
    originX: from.x,
    originY: from.y,
    // Both the sim and render follow this release-time chord; a runner cannot bend an arrow in flight.
    aimX: shot.aim.x,
    aimY: shot.aim.y,
    cover: shot.cover,
    launchTick: ctx.tick,
  });
  ctx.events.emit({
    kind: 'projectileLaunched',
    projectile: p,
    shooter: shot.source,
    target: shot.target,
    munitionType: shot.weapon.munitionType,
    at: eventAt(from.x, from.y),
  });
}
