import type { ContentSet } from '@open-northland/data';
import {
  Building,
  combatHostileMasks,
  DiplomacyRules,
  hostileMaskOf,
  Owner,
  ownerOf,
  PeaceRules,
  Position,
  UnderConstruction,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { ContentContext } from '../context.js';
import { combatClassOfType, isFighterJob, isRangedWeapon } from '../readviews/index.js';
import { forEachBuildingNear } from '../spatial/buildings.js';
import { isLoosePile } from '../stores/index.js';
import { garrisonReach } from './tower-post.js';
import { attackerWeapon } from './weapons.js';

/**
 * How far a tower of `buildingType` built by `tribe` shoots from its anchor, in map points: the farthest bow
 * any of its post classes holds, raised as a posted man's is ({@link garrisonReach}), so the long bow's 23
 * reaches 28. 0 for a building with no bow post.
 */
export function towerShotReach(content: ContentSet, buildingType: number, tribe: number): number {
  let byTribe = reachesByContent.get(content);
  if (byTribe === undefined) {
    byTribe = new Map();
    reachesByContent.set(content, byTribe);
  }
  const key = buildingType * TRIBE_KEY_SPAN + tribe;
  let reach = byTribe.get(key);
  if (reach === undefined) {
    reach = deriveTowerShotReach(content, buildingType, tribe);
    byTribe.set(key, reach);
  }
  return reach;
}

/** Packs `(buildingType, tribe)` into one key; content tribe ids sit far below it. */
const TRIBE_KEY_SPAN = 1 << 12;

const reachesByContent = new WeakMap<ContentSet, Map<number, number>>();

function deriveTowerShotReach(content: ContentSet, buildingType: number, tribe: number): number {
  const type = contentIndex(content).buildings.get(buildingType);
  if (type === undefined || combatClassOfType(type) !== 'tower') return 0;
  let reach = 0;
  for (const { jobType } of type.workers) {
    if (!isFighterJob(content, jobType)) continue;
    const held = attackerWeapon({ content }, tribe, jobType);
    if (held !== null && isRangedWeapon(held.weapon)) reach = Math.max(reach, garrisonReach(held).maxRange);
  }
  return reach;
}

/** The farthest {@link towerShotReach} of any tower and tribe in `content`: the box a search reads. */
function farthestTowerShot(content: ContentSet): number {
  let reach = farthestByContent.get(content);
  if (reach === undefined) {
    reach = 0;
    const tribes = [...contentIndex(content).weaponsByTribeAndJob.keys()];
    for (const type of content.buildings) {
      for (const tribe of tribes) reach = Math.max(reach, towerShotReach(content, type.typeId, tribe));
    }
    farthestByContent.set(content, reach);
  }
  return reach;
}

const farthestByContent = new WeakMap<ContentSet, number>();

/**
 * Whether `e` is a loose pile ({@link isLoosePile}) lying within {@link towerShotReach} of a finished tower
 * whose owner and `player` fight ({@link combatHostileMasks}), manned or empty. Owner ruling: a settler's own
 * pickups pass over it, since walking up to it under the wall means being shot at. False for a building and
 * for an unowned `player`.
 */
export function pileUnderEnemyTowers(
  world: World,
  ctx: ContentContext,
  player: number | undefined,
  e: Entity,
): boolean {
  if (player === undefined) return false;
  const hostile = hostileMaskOf(combatHostileMasks(world), player);
  if (hostile === 0) return false;
  const box = farthestTowerShot(ctx.content);
  const p = world.tryGet(e, Position);
  if (box === 0 || p === undefined || !isLoosePile(world, e)) return false;
  probe.world = world;
  probe.content = ctx.content;
  probe.hostile = hostile;
  probe.hx = nodeHxOfPosition(p.x, p.y);
  probe.hy = nodeHyOfPosition(p.x, p.y);
  probe.covered = false;
  try {
    // A hex distance is never below either axis offset, so the box holds every tower that can reach.
    forEachBuildingNear(world, probe.hx, probe.hy, box, visitTower);
  } finally {
    probe.world = undefined;
    probe.content = undefined;
  }
  return probe.covered;
}

/** A number that moves whenever a {@link pileUnderEnemyTowers} answer may change for a pile that stays put:
 *  a building raised, finished, razed, upgraded or captured, or a stance or peace changed. */
export function towerFireRevision(world: World): number {
  return (
    world.componentGeneration(Building) +
    world.componentValueGeneration(Building) +
    world.componentGeneration(UnderConstruction) +
    world.componentGeneration(Owner) +
    world.componentValueGeneration(Owner) +
    world.componentGeneration(DiplomacyRules) +
    world.componentValueGeneration(DiplomacyRules) +
    world.componentGeneration(PeaceRules) +
    world.componentValueGeneration(PeaceRules)
  );
}

/** The running {@link pileUnderEnemyTowers} question, so its visit allocates no closure per pile. */
const probe: {
  world: World | undefined;
  content: ContentSet | undefined;
  hostile: number;
  hx: number;
  hy: number;
  covered: boolean;
} = { world: undefined, content: undefined, hostile: 0, hx: 0, hy: 0, covered: false };

function visitTower(building: Entity, bx: number, by: number): void {
  const { world, content } = probe;
  if (probe.covered || world === undefined || content === undefined) return;
  const owner = ownerOf(world, building);
  if (owner === undefined || (probe.hostile & (1 << owner)) === 0) return;
  if (world.has(building, UnderConstruction)) return;
  const b = world.get(building, Building);
  const reach = towerShotReach(content, b.buildingType, b.tribe);
  if (reach > 0 && hexDistanceBetween(bx, by, probe.hx, probe.hy) <= reach) probe.covered = true;
}
