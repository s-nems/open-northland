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
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { ContentContext } from '../context.js';
import { isLoosePile } from '../stores/index.js';
import { mannedPostsOf } from './manned-posts.js';
import { mannedPostOf, postShotReach } from './tower-post.js';

/**
 * Whether `e` is a loose pile ({@link isLoosePile}) a bowman manning a tower shoots at: within his
 * {@link postShotReach} of the post, and his player fights `player` ({@link fightsPlayer}). Owner ruling: a
 * settler's own pickups pass over it, since walking up to it means being shot at; an empty tower keeps
 * nobody away. False for a building and for an unowned `player`.
 */
export function pileUnderEnemyTowers(
  world: World,
  ctx: ContentContext,
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
    if (hexDistanceBetween(bowman.hx, bowman.hy, hx, hy) <= bowman.reach) return true;
  }
  return false;
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

/** A bowman standing on his post: his player, his post's anchor node and how far he shoots from it. */
interface PostedBowman {
  readonly owner: number;
  readonly hx: number;
  readonly hy: number;
  readonly reach: number;
}

/** Every {@link PostedBowman} as of one {@link towerFireRevision}. Derived state, never hashed; the
 *  registered verifier re-derives it from the garrisons. */
interface TowerFire {
  readonly revision: number;
  readonly ctx: ContentContext;
  readonly bowmen: readonly PostedBowman[];
  /** By player, the players of the bowmen who fight that player, as a slot mask, filled on first ask. */
  readonly shooters: Map<number, number>;
}

const towerFires = new WeakMap<World, TowerFire>();

function towerFireOf(world: World, ctx: ContentContext): TowerFire {
  const revision = towerFireRevision(world, ctx);
  const held = towerFires.get(world);
  if (held !== undefined && held.revision === revision) return held;
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
function keepBowman(
  world: World,
  ctx: ContentContext,
  bowmen: PostedBowman[],
  e: Entity,
  post: Entity,
): void {
  const reach = postShotReach(world, ctx, e);
  const owner = ownerOf(world, e);
  const at = world.tryGet(post, Position);
  if (reach === 0 || owner === undefined || at === undefined) return;
  bowmen.push({ owner, hx: nodeHxOfPosition(at.x, at.y), hy: nodeHyOfPosition(at.x, at.y), reach });
}

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
      .map(({ owner, hx, hy, reach }) => `${owner}:${hx}:${hy}:${reach}`)
      .sort()
      .join(' ');
  return key(fire.bowmen) === key(fresh) ? [] : ['towerFire holds stale bowmen'];
}
