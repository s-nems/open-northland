import { LandscapeResource, Position, Stockpile } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { MAX_GROUND_STACK } from '../stores/index.js';

/**
 * A loose good pile to lay on the ground before tick zero: the map editor's goods objects. In the original
 * a good on the ground is a landscape object of the good's own `landscapetype`, and the placement's
 * valency is the unit count, so a decoded map's goods placements assemble here as ordinary yard heaps.
 */
export interface GroundGoodsSpec {
  readonly goodType: number;
  /** Units in the pile, clamped to `1..MAX_GROUND_STACK` - the five fill states the pile art has. */
  readonly amount: number;
  /** Half-cell lattice coords. */
  readonly x: number;
  readonly y: number;
  /** The authored or scripted landscape placement this pile replaces. */
  readonly landscapeId?: number;
}

/** Assemble a loose ground heap of one good. It is nobody's, so any side's equip errand or porter may
 *  take from it, and the pickup that empties it reaps the entity. */
export function createGroundGoods(world: World, spec: GroundGoodsSpec): Entity {
  const amount = Math.min(MAX_GROUND_STACK, Math.max(1, Math.floor(spec.amount)));
  const e = world.create();
  if (spec.landscapeId !== undefined) world.add(e, LandscapeResource, { id: spec.landscapeId });
  world.add(e, Position, positionOfNode(spec.x, spec.y)); // before Stockpile: `spatial/stockpiles.ts`
  world.add(e, Stockpile, { amounts: new Map([[spec.goodType, amount]]) });
  return e;
}
