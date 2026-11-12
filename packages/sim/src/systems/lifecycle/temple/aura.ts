import {
  Health,
  needsEnabled,
  ownerOf,
  Person,
  Position,
  SettlerNeeds,
  TempleFire,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { System, SystemContext } from '../../context.js';
import { applyNeedUnits, carriesNeeds, NEED_SATED_THRESHOLD } from '../needs/index.js';
import { finishedTemples } from './finished.js';
import { tendTempleFire } from './fire.js';

/** Map points (hex distance) from a temple's anchor its blessing reaches. Original behavior. */
export const TEMPLE_AURA_RANGE = 50;
/** Religion reserve units a blessing adds, only to a bar at or under the sated level. Original behavior. */
export const TEMPLE_AURA_PIETY_UNITS = 250;
/** Hitpoints a blessing adds, past the max. Original behavior. */
export const TEMPLE_AURA_HITPOINTS = 50;

/** The most hitpoints a blessing raises a pool of `max` to: the max plus half again. Original behavior:
 *  the only ceiling on a human's hitpoints, so nothing but damage takes the surplus away. */
export function blessedHitpointCeiling(max: number): number {
  return max + Math.trunc(max / 2);
}

/**
 * Once per game second, each finished temple at full hitpoints blesses every person of its owner within
 * {@link TEMPLE_AURA_RANGE}: hitpoints above the max, and religion up to the sated level for a settler
 * whose bars move. One wound on the temple stops the blessing until it is whole again. Original behavior;
 * the original also blesses children, whose bars this sim does not keep. Departures: a temple that stores
 * fuel blesses only while it burns some ({@link tendTempleFire}, owner ruling); the original blesses once
 * per temple in reach, so a cluster of temples multiplies the bonus, where here a person is blessed once
 * a second however many temples reach it.
 */
export const templeAuraSystem: System = (world, ctx) => {
  // Caught up every tick, so a busy tick's building writes never pile past the feed's limit.
  const temples = finishedTemples(world, ctx);
  if (ctx.tick % TICKS_PER_SECOND !== 0) {
    for (const e of temples) if (!world.has(e, TempleFire)) tendTempleFire(world, ctx, e, false);
    return;
  }
  if (temples.length === 0) return;
  const anchorsByOwner = blessingTempleAnchors(world, ctx, temples);
  if (anchorsByOwner.size === 0) return;
  const piety = needsEnabled(world);
  for (const e of world.query(Person, Position, Health)) {
    const owner = ownerOf(world, e);
    const anchors = owner === undefined ? undefined : anchorsByOwner.get(owner);
    if (anchors === undefined) continue;
    const at = world.get(e, Position);
    if (!withinAnyAnchor(anchors, nodeHxOfPosition(at.x, at.y), nodeHyOfPosition(at.x, at.y))) continue;
    bless(world, ctx, e, piety);
  }
};

/** Tend every temple's fire for this second, and return the anchors of the ones that bless,
 *  flattened as `hx, hy` pairs per owner. */
function blessingTempleAnchors(
  world: World,
  ctx: SystemContext,
  temples: readonly Entity[],
): Map<number, number[]> {
  const byOwner = new Map<number, number[]>();
  for (const e of temples) {
    if (!tendTempleFire(world, ctx, e)) continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;
    const at = world.get(e, Position);
    let anchors = byOwner.get(owner);
    if (anchors === undefined) {
      anchors = [];
      byOwner.set(owner, anchors);
    }
    anchors.push(nodeHxOfPosition(at.x, at.y), nodeHyOfPosition(at.x, at.y));
  }
  return byOwner;
}

function withinAnyAnchor(anchors: readonly number[], hx: number, hy: number): boolean {
  for (let i = 0; i < anchors.length; i += 2) {
    if (hexDistanceBetween(anchors[i] ?? 0, anchors[i + 1] ?? 0, hx, hy) <= TEMPLE_AURA_RANGE) return true;
  }
  return false;
}

function bless(world: World, ctx: SystemContext, e: Entity, piety: boolean): void {
  const health = world.get(e, Health);
  if (health.hitpoints > 0) {
    const raised = Math.min(health.hitpoints + TEMPLE_AURA_HITPOINTS, blessedHitpointCeiling(health.max));
    if (raised > health.hitpoints) world.mut(e, Health).hitpoints = raised;
  }
  if (!piety || !carriesNeeds(world, ctx.content, e)) return;
  if (world.get(e, SettlerNeeds).piety < NEED_SATED_THRESHOLD) return;
  const s = world.mut(e, SettlerNeeds);
  s.piety = applyNeedUnits(s.piety, TEMPLE_AURA_PIETY_UNITS);
}
