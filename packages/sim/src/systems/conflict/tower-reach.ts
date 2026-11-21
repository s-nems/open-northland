import {
  DiplomacyRules,
  fightsPlayer,
  Garrison,
  Owner,
  ownerOf,
  PeaceRules,
  Position,
  Weapon,
} from '../../components/index.js';
import type { Fixed } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext } from '../context.js';
import { isLoosePile } from '../stores/index.js';
import { mannedPostsOf } from './manned-posts.js';
import { buildingBodyNodes } from './target-node.js';
import { mannedPostOf, postShotReach } from './tower-post.js';

/**
 * Whether `e` is a loose pile ({@link isLoosePile}) a bowman manning a tower shoots at: within his
 * {@link postShotReach} of the post's nearest wall ({@link postReachDistance}), and his player fights
 * `player` ({@link fightsPlayer}). Owner ruling: a
 * settler's own pickups pass over it, since walking up to it means being shot at; an empty tower keeps
 * nobody away. False for a building and for an unowned `player`.
 */
export function pileUnderEnemyTowers(
  world: World,
  ctx: MapContext,
  player: number | undefined,
  e: Entity,
): boolean {
  if (player === undefined) return false;
  const p = world.tryGet(e, Position);
  if (p === undefined || !isLoosePile(world, e)) return false;
  const fire = towerFireOf(world, ctx);
  const shooters = shootersAt(world, fire, player);
  if (shooters === 0) return false;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  for (const bowman of fire.bowmen) {
    if ((shooters & (1 << bowman.owner)) === 0) continue;
    if (nearestWallDistance(bowman.walls, hx, hy) <= bowman.reach) return true;
  }
  return false;
}

/** The map-point distance from (`hx`, `hy`) to the nearest of `walls`, node coordinates in pairs. */
function nearestWallDistance(walls: readonly number[], hx: number, hy: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < walls.length; i += 2) {
    nearest = Math.min(nearest, hexDistanceBetween(walls[i] ?? 0, walls[i + 1] ?? 0, hx, hy));
  }
  return nearest;
}

/** A number that only rises, and moves whenever a {@link pileUnderEnemyTowers} answer may change for a pile
 *  that stays put: a bowman taking or leaving a post, changing his bow or his player, or a stance or peace
 *  changed. */
export function towerFireRevision(world: World, ctx: ContentContext): number {
  const posts = mannedPostsOf(world, ctx.content);
  posts.sync(ctx);
  return (
    posts.revision +
    world.componentGeneration(Weapon) +
    world.componentValueGeneration(Weapon) +
    world.componentGeneration(Owner) +
    world.componentValueGeneration(Owner) +
    world.componentGeneration(DiplomacyRules) +
    world.componentValueGeneration(DiplomacyRules) +
    world.componentGeneration(PeaceRules) +
    world.componentValueGeneration(PeaceRules)
  );
}

/** A bowman standing on his post: his player, his post's wall nodes as `x, y` pairs (its anchor without a
 *  map) and how far he shoots from the nearest of them. */
interface PostedBowman {
  readonly owner: number;
  readonly walls: readonly number[];
  readonly reach: number;
}

/** Every {@link PostedBowman} as of one {@link towerFireRevision}. Derived state, never hashed; the
 *  registered verifier re-derives it from the garrisons. */
interface TowerFire {
  readonly revision: number;
  readonly ctx: MapContext;
  readonly bowmen: readonly PostedBowman[];
  /** By player, the players of the bowmen who fight that player, as a slot mask, filled on first ask. */
  readonly shooters: Map<number, number>;
}

const towerFires = new WeakMap<World, TowerFire>();

function towerFireOf(world: World, ctx: MapContext): TowerFire {
  const revision = towerFireRevision(world, ctx);
  const held = towerFires.get(world);
  if (held !== undefined && held.revision === revision && held.ctx.terrain === ctx.terrain) return held;
  if (held === undefined) world.registerCacheVerifier('towerFire', () => verifyTowerFire(world));
  const bowmen: PostedBowman[] = [];
  mannedPostsOf(world, ctx.content).forEachManning((e, post) => keepBowman(world, ctx, bowmen, e, post));
  const fire: TowerFire = { revision, ctx, bowmen, shooters: new Map() };
  towerFires.set(world, fire);
  return fire;
}

/**
 * List `e`, manning `post`, when he holds a bow. His own player decides whom he shoots, as in a fight, not
 * the tower's. A dying bowman counts until he is gone: hitpoints move with every blow, too often for the
 * list to key on.
 */
function keepBowman(world: World, ctx: MapContext, bowmen: PostedBowman[], e: Entity, post: Entity): void {
  const reach = postShotReach(world, ctx, e);
  const owner = ownerOf(world, e);
  const at = world.tryGet(post, Position);
  if (reach === 0 || owner === undefined || at === undefined) return;
  bowmen.push({ owner, walls: postWalls(world, ctx, post, at.x, at.y), reach });
}

/** The nodes {@link postReachDistance} measures `post`'s reach from, as `x, y` pairs: its walls on the map,
 *  its anchor (`x`, `y`) without one. */
function postWalls(world: World, ctx: MapContext, post: Entity, x: Fixed, y: Fixed): readonly number[] {
  const terrain = ctx.terrain;
  const walls = terrain === undefined ? NO_WALLS : buildingBodyNodes(world, ctx, terrain, post);
  if (terrain === undefined || walls.length === 0) return [nodeHxOfPosition(x, y), nodeHyOfPosition(x, y)];
  const held = wallPairs.get(walls);
  if (held !== undefined && held.width === terrain.width) return held.pairs;
  const pairs: number[] = [];
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i] as NodeId;
    pairs.push(terrain.xOf(wall), terrain.yOf(wall));
  }
  wallPairs.set(walls, { width: terrain.width, pairs });
  return pairs;
}

const NO_WALLS: readonly NodeId[] = [];

/** {@link postWalls}' pairs by the body list they were read off, a pure function of its nodes and the
 *  map's width: a body is held across ticks while its building stands, so every re-listing of its bowmen
 *  shares one pair list. */
const wallPairs = new WeakMap<
  readonly NodeId[],
  { readonly width: number; readonly pairs: readonly number[] }
>();

/** The players of `fire`'s bowmen who fight `player`, one way: a bowman shoots at whom his player fights, and
 *  never at his own side. */
function shootersAt(world: World, fire: TowerFire, player: number): number {
  let mask = fire.shooters.get(player);
  if (mask === undefined) {
    mask = 0;
    for (const { owner } of fire.bowmen) {
      const bit = 1 << owner;
      if (owner === player || (mask & bit) !== 0) continue;
      if (fightsPlayer(world, owner, player)) mask |= bit;
    }
    fire.shooters.set(player, mask);
  }
  return mask;
}

/** The bowmen the next ask reads against a fresh read of every garrison, past the post index. */
function verifyTowerFire(world: World): string[] {
  const held = towerFires.get(world);
  if (held === undefined) return [];
  const fire = towerFireOf(world, held.ctx);
  const fresh: PostedBowman[] = [];
  for (const e of world.query(Garrison)) {
    const post = mannedPostOf(world, fire.ctx, e);
    if (post !== null) keepBowman(world, fire.ctx, fresh, e, post);
  }
  const key = (bowmen: readonly PostedBowman[]): string =>
    bowmen
      .map(({ owner, walls, reach }) => `${owner}:${walls.join(',')}:${reach}`)
      .sort()
      .join(' ');
  return key(fire.bowmen) === key(fresh) ? [] : ['towerFire holds stale bowmen'];
}
