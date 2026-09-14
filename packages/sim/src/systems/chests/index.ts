import type { ContentSet } from '@open-northland/data';
import {
  Age,
  addPaper,
  Chest,
  type ChestKind,
  CurrentAtomic,
  OpenChestOrder,
  Owner,
  type Paper,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { eventAt } from '../../core/events.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { System, SystemContext } from '../context.js';
import { scatterSpilledStock } from '../economy/goods-spill.js';
import {
  resourceWorkCell,
  stampResourceFootprintData,
  unstampResourceFootprint,
} from '../footprint/index.js';
import { deferOrderDuringAtomic, isOrderableSettler } from '../orders/guards.js';
import { moveUnit } from '../orders/movement.js';
import { atomicDuration } from '../readviews/animations.js';
import { isHeroJob } from '../readviews/index.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { spawnAnimalHerd, spawnSettler } from '../spawn/index.js';
import { resolveChestReward } from './contents.js';
import { chestFootprint, druidJobType } from './footprint.js';

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
  /** The `[GfxLandscape]` record the map placed; omitted for a scene spawn. */
  readonly gfxIndex?: number;
}

/** Assemble a closed chest: its position, contents and the blocking footprint its record declares. */
export function createChest(world: World, content: ContentSet, spec: ChestSpec): Entity {
  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Chest, {
    kind: spec.kind,
    contents: spec.contents,
    ...(spec.gfxIndex !== undefined ? { gfxIndex: spec.gfxIndex } : {}),
  });
  stampResourceFootprintData(world, e, chestFootprint(content, spec.kind, spec.gfxIndex));
  return e;
}

/**
 * Whether a settler of `jobType` may open a `kind` chest (`Item_IsAbleToOpenChest`): a wooden chest takes
 * any adult trade, a magical one only the druid or a hero. Adulthood is the caller's `Age` check.
 */
export function jobCanOpenChest(content: ContentSet, jobType: number | null, kind: ChestKind): boolean {
  if (kind === 'wooden') return true;
  return isHeroJob(content, jobType) || (jobType !== null && jobType === druidJobType(content));
}

function canOpenChest(world: World, content: ContentSet, settler: Entity, chest: Entity): boolean {
  if (!world.isAlive(chest) || !world.has(chest, Chest)) return false;
  if (world.has(settler, Age)) return false; // a child opens nothing
  return jobCanOpenChest(content, world.get(settler, Settler).jobType, world.get(chest, Chest).kind);
}

/**
 * Order one owned settler to open `chest` - see the command doc. Runs as a normal {@link moveUnit} walk to
 * the chest's work cell carrying an {@link OpenChestOrder}, which {@link chestOrderSystem} turns into the
 * open-chest clip on arrival.
 */
export function orderOpenChest(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'openChest' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to walk
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !world.has(e, Position)) return;
  if (!canOpenChest(world, ctx.content, e, command.chest)) return;
  // A non-interruptible atomic parks the whole command, as an inner moveUnit alone would strand the marker.
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;
  const stance = resourceWorkCell(world, terrain, command.chest, entityNode(world, terrain, e));
  const c = terrain.coordsOf(stance);
  moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y });
  if (!world.has(e, PlayerOrder)) return; // the walk was refused (confinement, no route): no order stands
  world.add(e, OpenChestOrder, { chest: command.chest });
}

/**
 * Turn an arrived {@link OpenChestOrder} into the one-shot open-chest clip. Runs after the player-order
 * system retires the walk and before the planner, so the clip starts before the economy could re-task the
 * settler. The chest is re-checked on arrival because it may have been opened by someone else en route.
 */
export const chestOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  // Canonical order: two settlers arriving the same tick at one chest race, and the lower id must win.
  for (const e of canonicalById(world.query(Settler, OpenChestOrder))) {
    const chest = world.get(e, OpenChestOrder).chest;
    if (!canOpenChest(world, ctx.content, e, chest) || !world.has(e, Owner)) {
      world.remove(e, OpenChestOrder); // chest gone, or the settler no longer qualifies
      continue;
    }
    const atomic = world.tryGet(e, CurrentAtomic);
    if (atomic !== undefined) {
      if (atomic.effect.kind === 'openChest') continue; // bending over the lid - wait for the effect
      if (world.has(e, PlayerOrder)) continue; // the walk's own preamble (setting a carried load down)
      world.remove(e, OpenChestOrder); // a need drive took over - the order is abandoned
      continue;
    }
    const here = entityNode(world, terrain, e);
    const stance = resourceWorkCell(world, terrain, chest, here);
    if (here === stance) {
      world.remove(e, OpenChestOrder);
      const settler = world.get(e, Settler);
      const p = world.get(chest, Position);
      const target = nodeOfPosition(p.x, p.y);
      world.add(e, CurrentAtomic, {
        atomicId: OPEN_CHEST_ATOMIC_ID,
        elapsed: 0,
        progress: fx.fromInt(0),
        duration: atomicDuration(ctx.content, settler, OPEN_CHEST_ATOMIC_ID),
        effect: { kind: 'openChest', chest },
        targetEntity: chest,
        targetTile: { x: target.hx, y: target.hy },
      });
      continue;
    }
    if (world.has(e, PlayerOrder)) continue; // still walking the order out
    world.remove(e, OpenChestOrder); // walk failed or was superseded - return to autonomy
  }
};

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
  ctx.events.emit({ kind: 'chestOpened', chest, at, player });

  switch (reward.kind) {
    case 'goods':
      scatterSpilledStock(world, ctx, {
        x: p.x,
        y: p.y,
        goods: [{ goodType: reward.goodType, amount: reward.amount }],
      });
      return;
    case 'paper':
      grantPaper(world, ctx, player, reward.paper, at);
      return;
    case 'workshop':
      grantPaper(world, ctx, player, reward.paper, at);
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
  }
}

/** Add `paper` to `player`'s list and announce it; a full list drops the paper silently. */
export function grantPaper(
  world: World,
  ctx: SystemContext,
  player: number,
  paper: Paper,
  at: { readonly hx: number; readonly hy: number },
): void {
  if (!addPaper(world, player, paper)) return;
  ctx.events.emit({ kind: 'paperFound', player, paper: { ...paper }, at });
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
  at: { readonly hx: number; readonly hy: number },
): void {
  for (let i = 0; i < count; i++) {
    spawnSettler(world, ctx, { kind: 'spawnSettler', jobType, x: at.hx, y: at.hy, tribe, owner: player });
  }
}
