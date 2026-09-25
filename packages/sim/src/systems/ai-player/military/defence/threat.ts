import {
  Building,
  DefenceMode,
  diplomacyStance,
  Garrison,
  Health,
  Owner,
  Person,
  Position,
  Settler,
  Weapon,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { SIGHT_RADIUS_NODES } from '../../../conflict/targeting.js';
import { garrisonReach, isManningPost, standsAtPost } from '../../../conflict/tower-post.js';
import { attackerWeapon } from '../../../conflict/weapons.js';
import type { SystemContext } from '../../../context.js';
import { houseBow, isFighterJob } from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { entityNode } from '../../../spatial/nodes.js';

/** An enemy fighter, at the node he stands on this decision, with the walkable component that node
 *  belongs to - the seat can shelter from a man it cannot reach, but it cannot march out at him - and
 *  how far he strikes from there ({@link Shooter}). */
export interface Raider extends Shooter {
  readonly entity: Entity;
  readonly component: number;
}

/** An enemy fighter's node and reach: how far from it his swing or shot lands, in Manhattan nodes. A loose
 *  man's is at least his sight, since he advances on what he sees; a posted man's is his bow's with the
 *  tower's bonus, and he never leaves it. */
export interface Shooter {
  readonly x: number;
  readonly y: number;
  readonly reach: number;
}

/** The enemy's fire over the map, narrowed to the shooters a search can meet before it runs its test. */
export interface EnemyFire {
  /** Whether a site anchored on `(x, y)`, its walls up to `span` nodes out from the anchor, stands inside
   *  some shooter's reach. Linear in the shooters, so narrow it first. */
  reaches(x: number, y: number, span: number): boolean;
  /** The same fire over only the shooters whose reach, plus `span`, meets the Manhattan disc of `radius`
   *  around `(x, y)`: what a search fanning that far from its centre can meet at all, usually nobody. */
  around(x: number, y: number, radius: number, span: number): EnemyFire;
}

/** How far past its watch band ({@link threatWatchNodes}) a raider must draw off before the seat stands
 *  down. Without the margin a fighter pacing the rim would flick the town's economy in and out of cover
 *  every decision. */
export const THREAT_STAND_DOWN_MARGIN_NODES = 6;

/** The house bow's extracted `maximumrange` (`weapons.ini` type 20), for content that declares no wall bow
 *  and whose shelters therefore take their people in unarmed - they still have to be indoors in time. */
const HOUSE_BOW_REACH_NODES = 29;

/** How close a raider comes before a building of `tribe` counts as threatened: the reach of the bow it
 *  fires once its people are inside ({@link houseBow}), at its plain range; the tower bonus belongs to the
 *  employed post. */
export function threatWatchNodes(ctx: SystemContext, tribe: number): number {
  return houseBow(ctx.content, tribe)?.maxRange ?? HOUSE_BOW_REACH_NODES;
}

/**
 * The band `building` watches this decision, widened by {@link THREAT_STAND_DOWN_MARGIN_NODES} while its
 * alarm already stands.
 *
 * The alarm and the sortie read the same band on purpose. A raider inside the margin but outside the plain
 * reach holds the town in cover while standing where nothing indoors can shoot him, so he has to be
 * somebody the seat comes out at - otherwise one man shuts a settlement down for good.
 */
export function watchBandOf(world: World, ctx: SystemContext, building: Entity): number {
  const watch = threatWatchNodes(ctx, world.get(building, Building).tribe);
  return world.has(building, DefenceMode) ? watch + THREAT_STAND_DOWN_MARGIN_NODES : watch;
}

/**
 * Every enemy fighter loose on the map, canonical ascending id. Fighting trades only, so a colonist walking
 * past a tower is not a raid, and the {@link Person} key keeps a claimed herd out.
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
  for (const e of world.canonicalQuery(Person, Owner)) {
    const owner = world.get(e, Owner).player;
    if (owner === player) continue;
    // A fighter is a raid only if his player would engage this seat: an allied army walking past must
    // not hold the town in alarm.
    if (diplomacyStance(world, owner, player) !== 'enemy') continue;
    if (!world.has(e, Position)) continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) continue;
    if (standsAtPost(world, e) !== null) continue;
    const at = entityNode(world, terrain, e);
    const reach = Math.max(weaponReach(world, ctx, e), SIGHT_RADIUS_NODES);
    raiders.push({ entity: e, ...terrain.coordsOf(at), component: terrain.componentOf(at), reach });
  }
  return raiders;
}

/** The far reach of the weapon `e` fights with, 0 for an unarmed man. */
function weaponReach(world: World, ctx: SystemContext, e: Entity): number {
  const settler = world.get(e, Settler);
  return (
    attackerWeapon(ctx, settler.tribe, settler.jobType, world.tryGet(e, Weapon)?.weaponTypeId)?.maxRange ?? 0
  );
}

/**
 * Every enemy fighter manning a tower post, with the post's boosted reach: the fortification the raider
 * scan leaves out, which still shoots a site raised inside its band. Read off the garrison markers, so
 * the walk is over the few posted men, not over every person.
 */
export function enemyPosts(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): Shooter[] {
  const posts: Shooter[] = [];
  for (const e of world.query(Garrison)) {
    const owner = world.tryGet(e, Owner)?.player;
    if (owner === undefined || owner === player || diplomacyStance(world, owner, player) !== 'enemy')
      continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0 || !isManningPost(world, ctx, e)) continue;
    const reach = weaponReach(world, ctx, e);
    if (reach === 0) continue;
    const at = terrain.coordsOf(entityNode(world, terrain, e));
    posts.push({ x: at.x, y: at.y, reach: garrisonReach({ minRange: 0, maxRange: reach }).maxRange });
  }
  return posts;
}

/** The {@link EnemyFire} of every shooter, loose or posted, whatever ground he stands on: a bow shoots
 *  across water. */
export function enemyFire(shooters: readonly Shooter[]): EnemyFire {
  const within = (s: Shooter, x: number, y: number, extra: number): boolean =>
    Math.abs(s.x - x) + Math.abs(s.y - y) <= s.reach + extra;
  return {
    reaches: (x, y, span) => shooters.some((s) => within(s, x, y, span)),
    around: (x, y, radius, span) => enemyFire(shooters.filter((s) => within(s, x, y, radius + span))),
  };
}

/**
 * The raider nearest `(x, y)` within `radius`, with his distance, or null when none is that close.
 * Candidates arrive ascending-id, so the strict `<` keeps the lowest id among equal distances.
 *
 * `reachable` is the walkable component a candidate must share, or null to take him wherever he stands:
 * the alarm answers anyone who can shoot into the town, while an order to go out at him cannot.
 */
export function nearestRaiderWithin(
  raiders: readonly Raider[],
  x: number,
  y: number,
  radius: number,
  reachable: number | null,
): { raider: Raider; distance: number } | null {
  let best: { raider: Raider; distance: number } | null = null;
  for (const raider of raiders) {
    if (reachable !== null && raider.component !== reachable) continue;
    const distance = Math.abs(raider.x - x) + Math.abs(raider.y - y);
    if (distance > radius) continue;
    if (best === null || distance < best.distance) best = { raider, distance };
  }
  return best;
}

/**
 * The raider standing closest to anything the seat owns and can walk to, or null when nothing is at the
 * gates. Read off every building rather than the shelters alone, construction sites included: a band
 * burning the outlying farms is a raid, and a site is a building the seat is losing.
 *
 * A man on ground the building's door does not connect to is skipped. He may still hold the alarm up, but
 * answering him is impossible, and treating him as a raid would bench the campaign for a siege that can
 * never be joined. Ties break on the raider's id, so two buildings equidistant from two men cannot pick by
 * iteration order.
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
    const at = terrain.coordsOf(entityNode(world, terrain, e));
    const door = terrain.componentOf(interactionCell(world, ctx, terrain, e));
    const found = nearestRaiderWithin(raiders, at.x, at.y, watchBandOf(world, ctx, e), door);
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
