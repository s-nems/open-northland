import { buildingHitpointsFor } from '@open-northland/data';
import { Building, diplomacyStance, Health, ownerOf } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../../context.js';
import {
  ARMOR_MATERIAL,
  buildingCombatClass,
  houseBow,
  shelterCapacityOf,
} from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { believedBuildings } from '../../knowledge/intel/index.js';
import { fighterPoints } from '../points.js';
import type { OperationEnv } from './lifecycle.js';
import { RAID_TOWER_CLEARANCE_NODES } from './raid-target.js';

// What a landing strikes once ashore and what it keeps clear of: the rival's towers and the buildings
// his people shelter in on alarm, which shoot every landed man in reach and fall only to a siege. Read
// from what the seat believes stands, so no fog leaks.

/** A bare man's armour blocks nothing. */
const NO_BLOCKING = 0;

/** What reading a seat's belief of a land takes: no operation need be open. */
type BeliefEnv = Pick<OperationEnv, 'world' | 'ctx' | 'terrain' | 'seat'>;

/** One enemy building the seat believes stands, with where a band walks to strike it. */
export interface BelievedTarget {
  readonly entity: Entity;
  readonly buildingType: number;
  readonly at: HalfCellNode;
  readonly approach: NodeId;
}

/** Whether a building of `buildingType` shoots a landing: a tower, or a type its owner's people shelter in
 *  and fire from on alarm. */
function shoots(ctx: SystemContext, buildingType: number): boolean {
  return (
    buildingCombatClass(ctx, buildingType) === 'tower' || shelterCapacityOf(ctx.content, buildingType) > 0
  );
}

/** The enemy buildings on `land` the seat believes stand and could fall: a seen one with hitpoints left, a
 *  remembered one out of sight of a type with hitpoints. Walls are no target. Costs the believed
 *  buildings. */
function believedTargets(env: BeliefEnv, land: number): BelievedTarget[] {
  const { world, ctx, terrain, seat } = env;
  const enemy = (owner: number): boolean => owner !== seat && diplomacyStance(world, seat, owner) === 'enemy';
  const targets: BelievedTarget[] = [];
  const { seen, remembered } = believedBuildings(world, ctx, seat);
  for (const e of seen) {
    const building = world.get(e, Building);
    const owner = ownerOf(world, e);
    if (owner === undefined || !enemy(owner) || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    const at = anchorNodeOf(world, e);
    const approach = interactionCell(world, ctx, terrain, e);
    if (at !== null && terrain.componentOf(approach) === land)
      targets.push({ entity: e, buildingType: building.buildingType, at, approach });
  }
  for (const b of remembered) {
    if (!enemy(b.owner)) continue;
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || buildingHitpointsFor(type, undefined) === undefined) continue;
    const approach = terrain.nodeAtClamped(b.hx, b.hy);
    if (terrain.componentOf(approach) === land)
      targets.push({ entity: b.entity, buildingType: b.buildingType, at: { hx: b.hx, hy: b.hy }, approach });
  }
  return targets.filter((t) => buildingCombatClass(ctx, t.buildingType) !== 'wall');
}

/** A tower or shelter the seat believes shoots a landing, with the people it shelters on alarm. */
export interface FireSource {
  readonly entity: Entity;
  readonly at: HalfCellNode;
  readonly room: number;
}

function fireSourcesOf(ctx: SystemContext, targets: readonly BelievedTarget[]): FireSource[] {
  return targets
    .filter((t) => shoots(ctx, t.buildingType))
    .map((t) => ({ entity: t.entity, at: t.at, room: shelterCapacityOf(ctx.content, t.buildingType) }));
}

/** What the seat believes stands on one land: the enemy buildings that could fall, and of them the towers
 *  and shelters ({@link shoots}). Read once per decision and handed to every reader of that land. */
export interface BelievedLand {
  readonly targets: readonly BelievedTarget[];
  readonly sources: readonly FireSource[];
}

/** The {@link BelievedLand} of `land`. Costs the believed buildings. */
export function believedLand(env: BeliefEnv, land: number): BelievedLand {
  const targets = believedTargets(env, land);
  return { targets, sources: fireSourcesOf(env.ctx, targets) };
}

/** The `sources` within {@link RAID_TOWER_CLEARANCE_NODES} of `at`, but the building `except`. */
function sourcesReaching(sources: readonly FireSource[], at: HalfCellNode, except?: Entity): FireSource[] {
  return sources.filter((s) => s.entity !== except && nodeManhattan(s.at, at) <= RAID_TOWER_CLEARANCE_NODES);
}

/** Whether any of `sources` reaches `at` ({@link sourcesReaching}). */
export function underFire(sources: readonly FireSource[], at: HalfCellNode): boolean {
  return sourcesReaching(sources, at).length > 0;
}

/**
 * What landed men standing at `from` on the `believed` land strike next: an enemy headquarters there that
 * no other tower or shelter covers (it falls fast and is the war aim), else the enemy building nearest
 * `from` that lies clear of every believed tower's and shelter's reach ({@link underFire}), the lower id
 * on a tie.
 * Null once none is left: the rest of the land is a siege, not a landing's work. Authored: observed on
 * arabskie_wyspy_wolna_gra_mieszana, waves sent on a headquarters beside a large tower lost most of their
 * dead near it, mostly to the people sheltering inside, while it fell.
 */
export function landingObjective(
  ctx: SystemContext,
  believed: BelievedLand,
  from: HalfCellNode,
): { readonly entity: Entity; readonly node: NodeId; readonly at: HalfCellNode } | null {
  const { targets, sources } = believed;
  let best: BelievedTarget | null = null;
  let bestRank = 0;
  let bestDistance = 0;
  for (const t of targets) {
    const hq = buildingCombatClass(ctx, t.buildingType) === 'hq';
    if (sourcesReaching(sources, t.at, hq ? t.entity : undefined).length > 0) continue;
    const rank = hq ? 0 : 1;
    const distance = nodeManhattan(t.at, from);
    if (
      best === null ||
      rank < bestRank ||
      (rank === bestRank &&
        (distance < bestDistance || (distance === bestDistance && t.entity < best.entity)))
    ) {
      best = t;
      bestRank = rank;
      bestDistance = distance;
    }
  }
  return best === null ? null : { entity: best.entity, node: best.approach, at: best.at };
}

/**
 * The fire the seat believes covers `at`, in fighter points: each of the believed `sources` in reach
 * counts its whole room as archers of `tribe`'s house bow ({@link houseBow}), bare men weighed by
 * {@link fighterPoints}. Approximation: the room is taken as full and the archers as men who can be cut
 * down, where a shelter's people are reached only through its walls.
 */
export function believedFireAt(
  ctx: SystemContext,
  sources: readonly FireSource[],
  at: HalfCellNode,
  tribe: number,
): number {
  const bow = houseBow(ctx.content, tribe);
  if (bow === undefined) return 0;
  let room = 0;
  for (const s of sourcesReaching(sources, at)) room += s.room;
  return room * fighterPoints(ctx.content, bow, ARMOR_MATERIAL.NONE, NO_BLOCKING);
}
