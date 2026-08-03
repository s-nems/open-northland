import { Building, Health, Livestock, Owner, Position, Settler } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { standsAtPost } from '../../../conflict/tower-post.js';
import type { SystemContext } from '../../../context.js';
import { houseBow, isFighterJob } from '../../../readviews/index.js';
import { canonicalById, entityNode } from '../../../spatial/nodes.js';
import { isBuilt } from '../../shared.js';

// The raid a seat reads before it decides anything: which enemy fighters stand on its ground, and how close
// they have come to a building of its own.

/** An enemy fighter, at the node he stands on this decision. */
export interface Raider {
  readonly entity: Entity;
  readonly x: number;
  readonly y: number;
}

/** How far past its watch band ({@link threatWatchNodes}) a raider must draw off before the seat stands
 *  down. Without the margin a fighter pacing the rim would flick the town's economy in and out of cover
 *  every decision. */
export const THREAT_STAND_DOWN_MARGIN_NODES = 6;

/** The house bow's extracted `maximumrange` (`weapons.ini` type 20), for content that declares no wall bow
 *  and whose shelters therefore take their people in unarmed - they still have to be indoors in time. */
const HOUSE_BOW_REACH_NODES = 29;

/** How close a raider comes before a building of `tribe` counts as threatened: the reach of the bow its
 *  people answer with from inside ({@link houseBow} - a sheltering civilian shoots at its plain range, the
 *  tower bonus belongs to the employed post), so the seat reacts exactly when the building can shoot back. */
export function threatWatchNodes(ctx: SystemContext, tribe: number): number {
  return houseBow(ctx.content, tribe)?.maxRange ?? HOUSE_BOW_REACH_NODES;
}

/**
 * Every enemy fighter loose on the map, canonical ascending id. Fighting trades only, so a colonist walking
 * past a tower is not a raid; a claimed herd is no threat either, and a wild animal carries no {@link Owner}.
 *
 * A man holding his own tower is dropped because `conflict/targeting.ts` refuses him as a target: a
 * garrison parked within reach of this seat's edge would otherwise hold the town in cover forever.
 *
 * Not fog-gated, like the campaign's own target scan: an alarm behind the fog would ring only once the
 * town had been walked into.
 */
export function seatRaiders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): Raider[] {
  const raiders: Raider[] = [];
  for (const e of canonicalById(world.query(Settler, Owner))) {
    if (world.get(e, Owner).player === player) continue;
    if (world.has(e, Livestock) || !world.has(e, Position)) continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) continue;
    if (standsAtPost(world, e) !== null) continue;
    raiders.push({ entity: e, ...terrain.coordsOf(entityNode(world, terrain, e)) });
  }
  return raiders;
}

/** The raider nearest `(x, y)` within `radius`, with his distance, or null when none is that close.
 *  Candidates arrive ascending-id, so the strict `<` keeps the lowest id among equal distances. */
export function nearestRaiderWithin(
  raiders: readonly Raider[],
  x: number,
  y: number,
  radius: number,
): { raider: Raider; distance: number } | null {
  let best: { raider: Raider; distance: number } | null = null;
  for (const raider of raiders) {
    const distance = Math.abs(raider.x - x) + Math.abs(raider.y - y);
    if (distance > radius) continue;
    if (best === null || distance < best.distance) best = { raider, distance };
  }
  return best;
}

/**
 * The raider standing closest to anything the seat has built, or null when nothing is at the gates. Read
 * off every standing building rather than the shelters alone: a band burning the outlying farms is a raid
 * too. Ties break on the raider's id, so two buildings equidistant from two men cannot pick by iteration
 * order.
 */
export function raidOnTheSettlement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): Raider | null {
  if (raiders.length === 0) return null;
  let best: { raider: Raider; distance: number } | null = null;
  for (const e of owned) {
    if (!isBuilt(world, e)) continue;
    const at = terrain.coordsOf(entityNode(world, terrain, e));
    const watch = threatWatchNodes(ctx, world.get(e, Building).tribe);
    const found = nearestRaiderWithin(raiders, at.x, at.y, watch);
    if (found === null) continue;
    if (
      best === null ||
      found.distance < best.distance ||
      (found.distance === best.distance && found.raider.entity < best.raider.entity)
    ) {
      best = found;
    }
  }
  return best?.raider ?? null;
}
