import {
  Building,
  Health,
  Palisade,
  Position,
  type ProjectileStateView,
  Resting,
  Settler,
  SettlerProgress,
  Vehicle,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, translatedCells } from '../footprint/geometry.js';
import { weaponClassHits, withFightDamageBonus, withHouseDamageExperience } from '../progression/index.js';
import { weaponDamageVsMaterial } from '../readviews/index.js';
import { type PendingHitReaction, resolveCombatHit } from '../settlers/atomics/effects/combat/index.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { targetBodyNodes } from './target-node.js';
import { isStructureTarget } from './targeting.js';
import { damageVsTarget, glancesOff, hitSoundVsMaterial, targetMaterial } from './weapons.js';

// A siege shot's burst: the original's delayed weapon hit fills its list from the one landing node -
// every human and animal standing on it and the vehicle, house or wall whose body covers it - and lands
// one blow on each, the shooter's own side included (original behavior, docs/formats/VEHICLES.md
// "Catapult"). A wall takes the blow through its own valency rule, like any other weapon's.

/**
 * Land a ground-burst shot on its aim: strike everything on its node and report whether anything was hit.
 * The victims are visited in ascending entity order, so two runs land the same staggers and the same kill
 * tallies. The scan over the standing settlers is a filter of the whole store, paid once per landing shot
 * rather than per tick (approximation of cost, not behaviour).
 */
export function resolveGroundImpact(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  p: Entity,
  proj: ProjectileStateView,
  pendingReactions: PendingHitReaction[],
): boolean {
  const node = terrain.nodeAtClamped(nodeHxOfPosition(proj.aimX, proj.aimY), nodeHyOfPosition(proj.aimY));
  const at = eventAt(proj.aimX, proj.aimY);
  const experience = world.tryGet(proj.source, SettlerProgress)?.experience;
  const hits = experience === undefined ? 0 : weaponClassHits(experience, proj.weaponMainType);
  let struck = false;
  for (const target of victimsOn(world, ctx, terrain, node)) {
    const material = targetMaterial(world, ctx, target);
    const damage = burstDamage(world, target, weaponDamageVsMaterial(proj, material), hits);
    const hitSoundType = glancesOff(world, target, damage) ? undefined : hitSoundVsMaterial(proj, material);
    resolveCombatHit(
      world,
      ctx,
      proj.source,
      target,
      { damage, weaponMainType: proj.weaponMainType, hitSoundType: hitSoundType ?? null },
      pendingReactions,
      'projectile',
    );
    ctx.events.emit({
      kind: 'projectileHit',
      projectile: p,
      shooter: proj.source,
      target,
      munitionType: proj.munitionType,
      at,
      ...(hitSoundType !== undefined ? { soundType: hitSoundType } : {}),
      ...(isStructureTarget(world, target) ? { structure: true } : {}),
    });
    struck = true;
  }
  return struck;
}

/** The commander's experience scales a stone's blow as it scales a swing's: by the original's formula
 *  against a building, by the authored bonus against anyone else, and a wall takes the bare column. */
function burstDamage(world: World, target: Entity, base: number, hits: number): number {
  if (world.has(target, Palisade)) return damageVsTarget(world, target, base);
  if (world.has(target, Building)) return withHouseDamageExperience(base, hits);
  return withFightDamageBonus(base, hits);
}

/** Everything with a pool standing on `node`, ascending by id: the settlers and animals out in the open
 *  on it, and the vehicles, buildings and walls whose bodies cover it. A felled one (0 hitpoints, unreaped) is skipped. */
function victimsOn(world: World, ctx: SystemContext, terrain: TerrainGraph, node: NodeId): Entity[] {
  const out: Entity[] = [];
  for (const e of world.query(Settler, Health, Position)) {
    // A settler resting indoors is out of reach, as for every other shot.
    if (!world.has(e, Resting) && entityNode(world, terrain, e) === node) out.push(e);
  }
  for (const e of world.query(Vehicle, Health, Position)) {
    if (targetBodyNodes(world, ctx, terrain, e)?.includes(node)) out.push(e);
  }
  for (const e of world.query(Palisade, Health, Position)) {
    if (targetBodyNodes(world, ctx, terrain, e)?.includes(node)) out.push(e);
  }
  for (const e of world.query(Building, Health, Position)) {
    if (buildingCoversNode(world, ctx, terrain, e, node)) out.push(e);
  }
  return canonicalById(out).filter((e) => world.get(e, Health).hitpoints > 0);
}

/** Whether a stone on `node` strikes building `e`: its walls, its reserved ground or its anchor.
 *  Approximation: the original asks the house whether the point lies inside it, an area it does not
 *  spell out; the footprint's reserved ring stands in for the yard around the walls. */
function buildingCoversNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  node: NodeId,
): boolean {
  if (entityNode(world, terrain, e) === node) return true;
  const footprint = buildingFootprintOf(ctx.content, world.get(e, Building).buildingType);
  if (footprint === undefined) return false;
  const anchor = terrain.coordsOf(entityNode(world, terrain, e));
  return (
    translatedCells(terrain, footprint.blocked, anchor.x, anchor.y).includes(node) ||
    translatedCells(terrain, footprint.reserved, anchor.x, anchor.y).includes(node)
  );
}
