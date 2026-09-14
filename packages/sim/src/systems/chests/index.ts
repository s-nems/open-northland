import type { ContentSet } from '@open-northland/data';
import {
  addPaper,
  Chest,
  type ChestKind,
  Owner,
  type Paper,
  Position,
  Settler,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import { contentIndex } from '../../core/content-index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { scatterSpilledStock } from '../economy/goods-spill.js';
import { stampResourceFootprintData, unstampResourceFootprint } from '../footprint/index.js';
import { isHeroJob } from '../readviews/index.js';
import { spawnAnimalHerd, spawnSettler } from '../spawn/index.js';
import { resolveChestReward } from './contents.js';
import { chestFootprint, chestRecord } from './footprint.js';

export { CHEST_CONTENTS, type ChestReward, resolveChestReward } from './contents.js';

/** The open-chest action id (`logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_OPEN_CHEST 91`), the clip
 *  the original starts when its human reaches the chest. */
export const OPEN_CHEST_ATOMIC_ID = 91;

export interface ChestSpec {
  readonly kind: ChestKind;
  /** The chest type, the map's `lmlv` value on the placement. */
  readonly contents: number;
  /** Half-cell lattice coords. */
  readonly x: number;
  readonly y: number;
  /** The `[GfxLandscape]` record the map placed; omitted for a scene spawn, which takes the kind's first. */
  readonly gfxIndex?: number;
}

/** Assemble a closed chest: its position, contents, the record it draws by, and the blocking footprint
 *  that record declares. */
export function createChest(world: World, content: ContentSet, spec: ChestSpec): Entity {
  const record = chestRecord(content, spec.kind, spec.gfxIndex);
  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Chest, {
    kind: spec.kind,
    contents: spec.contents,
    ...(record !== undefined ? { gfxIndex: record.index } : {}),
  });
  stampResourceFootprintData(world, e, chestFootprint(record));
  return e;
}

/**
 * Whether a settler of `jobType` may open a `kind` chest (`Item_IsAbleToOpenChest`): a wooden chest takes
 * any adult trade, a magical one only the druid or a hero. Adulthood is the caller's `Age` check.
 */
export function jobCanOpenChest(content: ContentSet, jobType: number | null, kind: ChestKind): boolean {
  if (kind === 'wooden') return true;
  return isHeroJob(content, jobType) || (jobType !== null && contentIndex(content).druidJobs.has(jobType));
}

/**
 * Hand a chest's contents out to `opener`'s player and remove the chest. Goods heap on the ground around
 * the chest's cell, a paper enters the player's list (raising `paperFound`), settlers stand up at the
 * chest for the opener's player and tribe, and animals spawn as a herd there. A chest already gone whiffs.
 *
 * Approximations: the original also switches the named good's production on for a workshop paper, which
 * the presence-based tech gate covers while the spawned worker lives; chest settlers take the opener's
 * tribe where the original mints vikings; and the catapult chest opens empty (no land vehicles).
 */
export function openChest(world: World, ctx: SystemContext, opener: Entity, chest: Entity): void {
  if (!world.isAlive(chest) || !world.has(chest, Chest)) return;
  const owner = world.tryGet(opener, Owner);
  if (owner === undefined) return;
  const player = owner.player;
  const { kind, contents } = world.get(chest, Chest);
  const p = world.get(chest, Position);
  const at = eventAt(p.x, p.y);
  const tribe = world.get(opener, Settler).tribe;
  const reward = resolveChestReward(ctx.content, kind, contents);

  unstampResourceFootprint(world, chest);
  world.destroy(chest);
  ctx.events.emit({ kind: 'chestOpened', chest, at });

  switch (reward.kind) {
    case 'goods':
      scatterSpilledStock(world, ctx, {
        x: p.x,
        y: p.y,
        goods: [{ goodType: reward.goodType, amount: reward.amount }],
      });
      return;
    case 'paper':
      grantPaper(world, ctx, player, reward.paper, chest, at);
      return;
    case 'workshop':
      grantPaper(world, ctx, player, reward.paper, chest, at);
      standUpSettlers(world, ctx, player, tribe, reward.jobType, 1, at);
      return;
    case 'settlers':
      standUpSettlers(world, ctx, player, tribe, reward.jobType, reward.count, at);
      return;
    case 'animals':
      spawnAnimalHerd(world, ctx, {
        kind: 'spawnAnimalHerd',
        tribe: reward.tribe,
        x: at.hx,
        y: at.hy,
        count: reward.count,
      });
      return;
    case 'nothing':
      return;
    default:
      assertNever(reward);
  }
}

/** Add `paper` to `player`'s list and announce it; a full list drops the paper silently. */
function grantPaper(
  world: World,
  ctx: SystemContext,
  player: number,
  paper: Paper,
  chest: Entity,
  at: HalfCellNode,
): void {
  if (!addPaper(world, player, paper)) return;
  ctx.events.emit({ kind: 'paperFound', player, paper: { ...paper }, chest, at });
}

/** Spawn `count` settlers of `jobType` at the chest through the ordinary spawn seam, so each is pushed off
 *  blocked ground, flagged like any recruit and announced as born. */
function standUpSettlers(
  world: World,
  ctx: SystemContext,
  player: number,
  tribe: number,
  jobType: number,
  count: number,
  at: HalfCellNode,
): void {
  for (let i = 0; i < count; i++) {
    spawnSettler(world, ctx, { kind: 'spawnSettler', jobType, x: at.hx, y: at.hy, tribe, owner: player });
  }
}
