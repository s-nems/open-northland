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
  type BuildingCombatClass,
  buildingCombatClass,
  houseBow,
  shelterCapacityOf,
} from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { believedBuildings, rememberedBuildings } from '../../knowledge/intel/index.js';
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

/** One enemy building the seat believes stands, with where a band walks to strike it, its owner when last
 *  seen and the points the seat last saw posted on it. */
export interface BelievedTarget {
  readonly entity: Entity;
  readonly buildingType: number;
  readonly owner: number;
  readonly at: HalfCellNode;
  readonly approach: NodeId;
  readonly postedPoints: number;
}

/** Whether a building of `buildingType` shoots a landing: a tower, or a type its owner's people shelter in
 *  and fire from on alarm. */
function shoots(ctx: SystemContext, buildingType: number): boolean {
  return (
    buildingCombatClass(ctx, buildingType) === 'tower' || shelterCapacityOf(ctx.content, buildingType) > 0
  );
}

/** The enemy buildings the seat believes stand and could fall, by the land component they are struck from:
 *  a seen one with hitpoints left, a remembered one out of sight of a type with hitpoints. Walls are no
 *  target, and land `only` keeps a single land. Costs the believed buildings. */
function believedTargets(env: BeliefEnv, only: number | null): Map<number, BelievedTarget[]> {
  const { world, ctx, terrain, seat } = env;
  const enemy = (owner: number): boolean => owner !== seat && diplomacyStance(world, seat, owner) === 'enemy';
  const byLand = new Map<number, BelievedTarget[]>();
  const add = (land: number, target: BelievedTarget): void => {
    if (only !== null && land !== only) return;
    if (buildingCombatClass(ctx, target.buildingType) === 'wall') return;
    const list = byLand.get(land);
    if (list === undefined) byLand.set(land, [target]);
    else list.push(target);
  };
  const { seen, remembered } = believedBuildings(world, ctx, seat);
  // The posts last seen on each remembered building, a seen one's included.
  const posted = new Map<Entity, number>();
  for (const b of rememberedBuildings(world, seat)) posted.set(b.entity, b.postedPoints);
  for (const e of seen) {
    const building = world.get(e, Building);
    const owner = ownerOf(world, e);
    if (owner === undefined || !enemy(owner) || (world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    const at = anchorNodeOf(world, e);
    const approach = interactionCell(world, ctx, terrain, e);
    if (at === null) continue;
    add(terrain.componentOf(approach), {
      entity: e,
      buildingType: building.buildingType,
      owner,
      at,
      approach,
      postedPoints: posted.get(e) ?? 0,
    });
  }
  for (const b of remembered) {
    if (!enemy(b.owner)) continue;
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || buildingHitpointsFor(type, undefined) === undefined) continue;
    const approach = terrain.nodeAtClamped(b.hx, b.hy);
    add(terrain.componentOf(approach), {
      entity: b.entity,
      buildingType: b.buildingType,
      owner: b.owner,
      at: { hx: b.hx, hy: b.hy },
      approach,
      postedPoints: b.postedPoints,
    });
  }
  return byLand;
}

/** A tower or shelter the seat believes shoots a landing, with the people it shelters on alarm. */
export interface FireSource {
  readonly entity: Entity;
  readonly at: HalfCellNode;
  readonly room: number;
  /** A tower, which fights with its garrison; else a shelter, which fires its people's house bow. */
  readonly tower: boolean;
  /** The points the seat last saw posted on it. */
  readonly postedPoints: number;
}

function fireSourcesOf(ctx: SystemContext, targets: readonly BelievedTarget[]): FireSource[] {
  return targets
    .filter((t) => shoots(ctx, t.buildingType))
    .map((t) => ({
      entity: t.entity,
      at: t.at,
      room: shelterCapacityOf(ctx.content, t.buildingType),
      tower: buildingCombatClass(ctx, t.buildingType) === 'tower',
      postedPoints: t.postedPoints,
    }));
}

/** What the seat believes stands on one land: the enemy buildings that could fall, and of them the towers
 *  and shelters ({@link shoots}). Read once per decision and handed to every reader of that land. */
export interface BelievedLand {
  readonly targets: readonly BelievedTarget[];
  readonly sources: readonly FireSource[];
}

/** The {@link BelievedLand} of `land`. Costs the believed buildings. */
export function believedLand(env: BeliefEnv, land: number): BelievedLand {
  const targets = believedTargets(env, land).get(land) ?? [];
  return { targets, sources: fireSourcesOf(env.ctx, targets) };
}

/** The {@link BelievedLand} of every land the seat believes holds an enemy building, ascending land. Costs
 *  the believed buildings once. */
export function believedLands(env: BeliefEnv): ReadonlyMap<number, BelievedLand> {
  const lands = new Map<number, BelievedLand>();
  const byLand = believedTargets(env, null);
  for (const land of [...byLand.keys()].sort((a, b) => a - b)) {
    const targets = byLand.get(land) ?? [];
    lands.set(land, { targets, sources: fireSourcesOf(env.ctx, targets) });
  }
  return lands;
}

/** The `sources` within {@link RAID_TOWER_CLEARANCE_NODES} of `at`, but the building `except`. */
function sourcesReaching(sources: readonly FireSource[], at: HalfCellNode, except?: Entity): FireSource[] {
  return sources.filter((s) => s.entity !== except && nodeManhattan(s.at, at) <= RAID_TOWER_CLEARANCE_NODES);
}

/** Whether any of `sources` reaches `at` ({@link sourcesReaching}). */
export function underFire(sources: readonly FireSource[], at: HalfCellNode): boolean {
  return sourcesReaching(sources, at).length > 0;
}

/** A storm's objective tiers by {@link buildingCombatClass}, best first (owner ruling): the headquarters,
 *  the war aim, then the towers, before the rest of a covered settlement. */
const STORM_RANK: Readonly<Record<BuildingCombatClass, number>> = { hq: 0, tower: 1, other: 2, wall: 3 };

/**
 * What landed men standing at `from` on the `believed` land strike next: an enemy headquarters there that
 * no other tower or shelter covers (it falls fast and is the war aim), else the enemy building nearest
 * `from` that lies clear of every believed tower's and shelter's reach ({@link underFire}), the lower id
 * on a tie. A `storm` strikes covered ground too: the headquarters, else the nearest tower, else the
 * nearest building. Null once none is left. Authored: observed on arabskie_wyspy_wolna_gra_mieszana,
 * waves sent on a headquarters beside a large tower lost most of their dead near it while it fell, so only
 * a landing that clearly outweighs the cover storms it (`landing-aim.ts`).
 */
export function landingObjective(
  ctx: SystemContext,
  believed: BelievedLand,
  from: HalfCellNode,
  storm = false,
): { readonly entity: Entity; readonly node: NodeId; readonly at: HalfCellNode } | null {
  const { targets, sources } = believed;
  let best: BelievedTarget | null = null;
  let bestRank = 0;
  let bestDistance = 0;
  for (const t of targets) {
    const tier = buildingCombatClass(ctx, t.buildingType);
    const hq = tier === 'hq';
    let rank: number;
    if (storm) rank = STORM_RANK[tier];
    else if (sourcesReaching(sources, t.at, hq ? t.entity : undefined).length > 0) continue;
    else rank = hq ? 0 : 1;
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

/** The towers of `sources` that reach `at` ({@link sourcesReaching}), the building `except` left out. */
export function towersReaching(
  sources: readonly FireSource[],
  at: HalfCellNode,
  except?: Entity,
): readonly FireSource[] {
  return sourcesReaching(sources, at, except).filter((s) => s.tower);
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
