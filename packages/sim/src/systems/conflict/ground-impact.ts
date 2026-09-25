import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  Building,
  diplomacyStance,
  Health,
  ownerOf,
  Palisade,
  Position,
  type ProjectileStateView,
  Resting,
  Settler,
  Vehicle,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf } from '../footprint/geometry.js';
import { vehicleFootprintNodes } from '../footprint/index.js';
import { weaponDamageVsMaterial } from '../readviews/index.js';
import { type PendingHitReaction, resolveCombatHit } from '../settlers/atomics/effects/combat/index.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { passIndexOf } from './combat-index.js';
import { isStructureTarget } from './targeting.js';
import { damageVsTarget, glancesOff, hitSoundVsMaterial, targetMaterial } from './weapons.js';

// A siege shot's burst: the original's delayed weapon hit fills its list from the one landing node -
// every human and animal standing on it and the vehicle, house or wall whose body covers it - and lands
// one blow on each, the shooter's own side included (original behavior, docs/formats/VEHICLES.md
// "Catapult"). A wall takes the blow through its own valency rule, like any other weapon's. A side not at
// war with the shooter takes the wound without turning hostile over it (approximation: the original's
// diplomacy reaction to friendly splash is unconfirmed).

/**
 * Land a ground-burst shot on its aim: strike everything on its node and report whether anything was hit.
 * The victims are visited in ascending entity order, so two runs land the same staggers and the same kill
 * tallies.
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
  const shooter = ownerOf(world, proj.source);
  let struck = false;
  for (const target of victimsOn(world, ctx, terrain, node)) {
    const material = targetMaterial(world, ctx, target);
    // A stone takes the bare column, as every shot does; the commander's experience steers only its aim.
    const damage = damageVsTarget(world, target, weaponDamageVsMaterial(proj, material));
    const hitSoundType = glancesOff(world, target, damage) ? undefined : hitSoundVsMaterial(proj, material);
    const landed = resolveCombatHit(
      world,
      ctx,
      proj.source,
      target,
      {
        damage,
        weaponMainType: proj.weaponMainType,
        hitSoundType: hitSoundType ?? null,
        from: { x: proj.originX, y: proj.originY },
      },
      pendingReactions,
      atWar(world, shooter, ownerOf(world, target)) ? 'projectile' : 'collateral',
    );
    // Original behavior: a stone that does a victim no damage passes it like one that strikes nothing.
    if (!landed) continue;
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

/** Whether a blow between these owners is an act of war: either side holds `enemy` toward the other, or
 *  one of them is no player (wildlife and neutral bodies take no diplomacy). */
function atWar(world: World, shooter: number | undefined, victim: number | undefined): boolean {
  if (shooter === undefined || victim === undefined) return true;
  if (shooter === victim) return false;
  return (
    diplomacyStance(world, shooter, victim) === 'enemy' || diplomacyStance(world, victim, shooter) === 'enemy'
  );
}

/** Everything with a pool standing on `node`, ascending by id: the settlers and animals out in the open
 *  on it, and the vehicles, buildings and walls whose bodies cover it. A felled one (0 hitpoints, unreaped)
 *  is skipped. The combat pass's index answers for the settlers and vehicles when it ran this tick; the
 *  buildings and walls are matched cell by cell without allocating. */
function victimsOn(world: World, ctx: SystemContext, terrain: TerrainGraph, node: NodeId): Entity[] {
  const out: Entity[] = [];
  const x = terrain.xOf(node);
  const y = terrain.yOf(node);
  const index = passIndexOf(world, ctx.tick);
  if (index !== null) {
    // The index holds every settler at its node and every vehicle at each node of its disc.
    const unit = (e: Entity): boolean => !world.has(e, Building) && !world.has(e, Resting);
    for (const { entity } of index.nearestFew(x, y, 0, 0, unit, Number.MAX_SAFE_INTEGER, null, 0))
      out.push(entity);
  } else {
    for (const e of world.query(Settler, Health, Position)) {
      // A settler resting indoors is out of reach, as for every other shot.
      if (!world.has(e, Resting) && entityNode(world, terrain, e) === node) out.push(e);
    }
    for (const e of world.query(Vehicle, Health, Position)) {
      if (vehicleFootprintNodes(world, ctx.content, terrain, e).includes(node)) out.push(e);
    }
  }
  for (const e of world.query(Palisade, Health, Position)) {
    const anchor = terrain.coordsOf(entityNode(world, terrain, e));
    const walk = world.get(e, Palisade).walk;
    const covers =
      walk.length === 0 ? anchor.x === x && anchor.y === y : coversCell(walk, anchor.x, anchor.y, x, y);
    if (covers) out.push(e);
  }
  for (const e of world.query(Building, Health, Position)) {
    if (buildingCoversNode(world, ctx, terrain, e, x, y)) out.push(e);
  }
  return canonicalById(out).filter((e) => world.get(e, Health).hitpoints > 0);
}

/** Whether one of `cells`, laid at the anchor, lands on node (x, y). */
function coversCell(
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
  x: number,
  y: number,
): boolean {
  return cells.some((c) => anchorY + c.dy === y && anchorX + footprintCellDx(anchorY, c) === x);
}

/** Whether a stone on node (x, y) strikes building `e`: its walls, its reserved ground or its anchor.
 *  Approximation: the original asks the house whether the point lies inside it, an area it does not
 *  spell out; the footprint's reserved ring stands in for the yard around the walls. */
function buildingCoversNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  x: number,
  y: number,
): boolean {
  const anchor = terrain.coordsOf(entityNode(world, terrain, e));
  if (anchor.x === x && anchor.y === y) return true;
  const footprint = buildingFootprintOf(ctx.content, world.get(e, Building).buildingType);
  if (footprint === undefined) return false;
  return (
    coversCell(footprint.blocked, anchor.x, anchor.y, x, y) ||
    coversCell(footprint.reserved, anchor.x, anchor.y, x, y)
  );
}
