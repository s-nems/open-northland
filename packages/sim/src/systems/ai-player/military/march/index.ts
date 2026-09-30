import {
  AttackOrder,
  Building,
  diplomacyStance,
  Engagement,
  Health,
  MAX_PLAYERS,
  Vehicle,
  vehicleCommander,
  WaveMarch,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { vehicleAnchor } from '../../../footprint/index.js';
import { MILITARY_MODE } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { VEHICLE_TARGET_SNAP_RADIUS } from '../../../vehicles/movement.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { seatBarracksOf } from '../../base.js';
import { anchorCentroid } from '../../node-geometry.js';
import { isRangedFighter, weaponMix } from '../census.js';
import { enemyPosts, seatRaiders } from '../defence/index.js';
import { meleeCoreFor, waveWorthy } from '../muster.js';
import { crewedCatapults, PARK_RING_MAX_NODES, PARK_SPACING_NODES } from '../siege-crew.js';
import { formation, type WaveMarchView } from './formation.js';
import { backOf, type Heading, headingOf, manhattanOf, nodeOf } from './geometry.js';
import {
  catapultOrders,
  driveCatapult,
  type Fire,
  placeOrders,
  recallOrders,
  ringOrders,
  type Wave,
} from './orders.js';
import { routeTo } from './route.js';
import {
  archersOn,
  arrivalOrders,
  catapultOnNearest,
  enemyTowerNodesNear,
  onCatapultContinents,
  SIEGE_TIMEOUT_TICKS,
} from './siege.js';

export { RANKS_BEHIND_CATAPULTS_NODES } from './formation.js';
export { LEG_NODES, SIEGE_STANDOFF_NODES, SIEGE_TOWER_STANDOFF_NODES } from './route.js';
export { SIEGE_TIMEOUT_TICKS, SIEGE_TOWER_RADIUS_NODES } from './siege.js';

// A launched wave marches as one body: leg by leg along one route, the next leg ordered once everybody
// has closed up on the last. The original's army formation is unobserved, so every distance, shape and
// threshold here is an approximation. Distances are Manhattan half-cell nodes unless named hex.

/** The fewest crewed catapults that make a wave a siege march: fewer stay parked at home, and a wave whose
 *  catapults fall below it sends the rest home and marches on without them. */
export const SIEGE_MARCH_MIN_CATAPULTS = 4;

/** How near his own place a man stands to count as closed up. */
export const REGROUP_SLACK_NODES = 4;

/** How near its place (hex) a catapult counts as closed up, still driving or not: the next leg goes out
 *  while it is under way, so the slowest of the wave never stops between legs. More than a catapult
 *  drives between two decisions. */
export const CATAPULT_REGROUP_SLACK_NODES = 4;

/** How long a leg waits for its stragglers before the wave marches on without them: a man left behind
 *  falls back to the muster, a catapult out of the wave to be parked at home. */
export const LEG_TIMEOUT_TICKS = 60 * TICKS_PER_SECOND;

/** How long the wave holds on the way for its catapults' fight before it marches on without them: as long
 *  as a siege, since a catapult fighting what it cannot hit would otherwise hold the wave forever. */
export const FIGHT_HOLD_TIMEOUT_TICKS = SIEGE_TIMEOUT_TICKS;

/** How far around the wave's centre enemy fighters count toward a charge. */
export const CHARGE_RADIUS_NODES = 24;

/** The fewest enemy fighters near the wave that make it charge, and the share of its own men that
 *  raises that floor for a bigger wave. */
export const CHARGE_MIN_ENEMIES = 5;
export const CHARGE_ARMY_DIVISOR = 3;

/** How near the barracks door a crewed catapult stands to join a launching wave: the park band and one
 *  spacing more. */
const HOME_CATAPULT_NODES = PARK_RING_MAX_NODES + PARK_SPACING_NODES;

export interface WaveDecision {
  readonly commands: readonly PlayerCommand[];
  /** Whether a wave still marches after this decision: the door does not launch another meanwhile. */
  readonly active: boolean;
}

const NO_WAVE: WaveDecision = { commands: [], active: false };

/** The men and catapults of the seat's marching wave, or null while none marches. */
export function marchingWave(
  world: World,
  ctx: SystemContext,
  player: number,
): { readonly men: ReadonlySet<Entity>; readonly catapults: ReadonlySet<Entity> } | null {
  const barracks = seatBarracksOf(world, ctx, player);
  const state = barracks === null ? undefined : world.tryGet(barracks, WaveMarch);
  return state === undefined ? null : { men: new Set(state.men), catapults: new Set(state.catapults) };
}

export function endMarch(world: World, barracks: Entity): void {
  world.remove(barracks, WaveMarch);
}

/**
 * Launch `men` from the barracks door `home` on `target`, taking the crewed catapults parked at home when
 * there are at least {@link SIEGE_MARCH_MIN_CATAPULTS} of them: the route is found once, over the lead
 * catapult's walk-block when one goes, so every leg end is ground the catapults can stand on too.
 */
export function launchWave(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  home: NodeId,
  target: Entity,
  objective: NodeId,
  men: readonly Entity[],
): void {
  const door = nodeOf(terrain, home);
  const atHome = crewedCatapults(world, ctx, player)
    .filter(({ vehicle }) => {
      const at = vehicleAnchor(world, vehicle);
      return (
        at !== null &&
        world.get(vehicle, Vehicle).attack === null &&
        manhattanOf(at, door) <= HOME_CATAPULT_NODES
      );
    })
    .map(({ vehicle }) => vehicle);
  // Too few for a siege march: they stay parked as the settlement's defence.
  const catapults = atHome.length >= SIEGE_MARCH_MIN_CATAPULTS ? atHome : [];
  const towers = enemyTowerNodesNear(world, ctx, terrain, player, objective);
  const route = routeTo(world, ctx, terrain, home, objective, towers, catapults[0] ?? null);
  world.add(barracks, WaveMarch, {
    target,
    origin: door,
    waypoints: route,
    leg: 0,
    legSince: ctx.tick,
    arrived: route.length === 0,
    holdSince: null,
    men: [...men],
    catapults,
  });
}

/**
 * One decision for the marching wave: a charge when an enemy catapult shoots at its men or enough enemy
 * fighters stand near it, else a hold while its catapults fight on the way, else the next leg once it has
 * closed up on the last, else the siege or the assault once it has arrived. `field` holds the wave's men this decision may count on; a man in a
 * fight still belongs to it, anyone else has left it.
 * A new `target` routes the wave again from where it stands, and a wave no longer {@link waveWorthy} is
 * spent: its men fall back to the muster.
 */
export function advanceWave(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  target: Entity,
  objective: NodeId,
  field: readonly Entity[],
): WaveDecision {
  const held = world.tryGet(barracks, WaveMarch);
  if (held === undefined) return NO_WAVE;
  const inField = new Set(field);
  const men = held.men.filter((e) => inField.has(e) || fighting(world, e));
  const catapults = held.arrived
    ? held.catapults.filter((v) => crewed(world, v))
    : siegeCatapults(world, ctx, barracks, held.catapults);
  const mix = weaponMix(world, ctx, men);
  if (!waveWorthy(mix, meleeCoreFor(mix))) {
    endMarch(world, barracks);
    return NO_WAVE;
  }
  const centre = anchorCentroid(world, [...men, ...catapults]);
  if (centre === null) {
    endMarch(world, barracks);
    return NO_WAVE;
  }
  if (held.target !== target)
    retarget(world, ctx, terrain, barracks, player, { target, objective }, centre, men, catapults);
  const state = world.get(barracks, WaveMarch);
  const marching: Wave = { men: men.filter((e) => inField.has(e)), members: men, catapults, centre };
  const wave = state.arrived ? marching : withoutStaleFighters(world, ctx, barracks, marching);

  const charge =
    shellingCatapult(world, terrain, player, wave) ?? chargePoint(world, ctx, terrain, player, wave);
  if (charge !== null) {
    // A charge scatters the ranks: the leg and siege timeouts count from its end, not through it.
    world.mut(barracks, WaveMarch).legSince = ctx.tick;
    return { commands: chargeOrders(world, terrain, wave, charge), active: true };
  }
  if (!state.arrived) {
    const hold = holdOrders(world, ctx, terrain, barracks, player, wave);
    if (hold !== null) return { commands: hold, active: true };
    const commands = legOrders(world, ctx, terrain, barracks, player, state, wave);
    if (commands !== null) return { commands, active: true };
  }
  const arrived = world.get(barracks, WaveMarch);
  const fire = fireOver(world, ctx, terrain, player, wave);
  return {
    commands: arrivalOrders(world, ctx, terrain, player, arrived, wave, objective, fire),
    active: true,
  };
}

/**
 * The crewed ones of the marching wave's `catapults`, or none once fewer than
 * {@link SIEGE_MARCH_MIN_CATAPULTS} are left: those go home to be parked (`siege-crew.ts`) and the wave
 * marches on as a plain one from this decision. An arrived wave besieges with whatever it has left. A
 * catapult that lost its driver stays the wave's where it stands, out of the home crew's reach.
 */
function siegeCatapults(
  world: World,
  ctx: SystemContext,
  barracks: Entity,
  catapults: readonly Entity[],
): Entity[] {
  const manned = catapults.filter((v) => crewed(world, v));
  if (manned.length >= SIEGE_MARCH_MIN_CATAPULTS) return manned;
  const home = new Set(manned);
  const kept = catapults.filter((v) => !home.has(v) && (world.tryGet(v, Health)?.hitpoints ?? 0) > 0);
  if (kept.length !== catapults.length) {
    const live = world.mut(barracks, WaveMarch);
    live.catapults = kept;
    live.holdSince = null;
    live.legSince = ctx.tick;
  }
  return [];
}

function fighting(world: World, e: Entity): boolean {
  return world.isAlive(e) && (world.has(e, Engagement) || world.has(e, AttackOrder));
}

function crewed(world: World, vehicle: Entity): boolean {
  const state = world.tryGet(vehicle, Vehicle);
  return (
    state !== undefined &&
    (world.tryGet(vehicle, Health)?.hitpoints ?? 0) > 0 &&
    vehicleCommander(state) !== null
  );
}

function retarget(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  { target, objective }: { readonly target: Entity; readonly objective: NodeId },
  centre: HalfCellNode,
  men: readonly Entity[],
  catapults: readonly Entity[],
): void {
  const start = nearestMemberNode(world, terrain, centre, men) ?? terrain.nodeAtClamped(centre.hx, centre.hy);
  const towers = enemyTowerNodesNear(world, ctx, terrain, player, objective);
  const route = routeTo(world, ctx, terrain, start, objective, towers, catapults[0] ?? null);
  const live = world.mut(barracks, WaveMarch);
  live.target = target;
  live.origin = nodeOf(terrain, start);
  live.waypoints = route;
  live.leg = 0;
  live.legSince = ctx.tick;
  live.arrived = route.length === 0;
  live.holdSince = null;
}

/** The node of the man standing nearest `centre`, the lowest id on a tie: a walkable start for the route. */
function nearestMemberNode(
  world: World,
  terrain: TerrainGraph,
  centre: HalfCellNode,
  men: readonly Entity[],
): NodeId | null {
  let best: NodeId | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of men) {
    const node = entityNode(world, terrain, e);
    const distance = manhattanOf(nodeOf(terrain, node), centre);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The next leg's orders, or null once the wave has closed up on its last leg end: it has arrived. The
 * wave closes up when every man stands on his place and every catapult near or past its own; once the leg
 * has waited {@link LEG_TIMEOUT_TICKS}, it drops the stragglers not in a fight and goes on without them.
 * A man still at a building the wave no longer fights is called back to his place.
 */
function legOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  held: WaveMarchView,
  wave: Wave,
): PlayerCommand[] | null {
  const ahead = legNearest(held, wave.centre);
  if (ahead > held.leg) {
    const live = world.mut(barracks, WaveMarch);
    live.leg = ahead;
    live.legSince = ctx.tick;
  }
  const state = world.get(barracks, WaveMarch);
  let places = formation(world, ctx, terrain, state, wave.members, wave.catapults);
  let march = wave;
  const behind = stragglers(world, terrain, state, places, wave.members, wave.catapults);
  const timedOut = ctx.tick - state.legSince >= LEG_TIMEOUT_TICKS;
  if (behind.size === 0 || timedOut) {
    const dropped = (e: Entity): boolean => behind.has(e) && !fighting(world, e);
    march = {
      ...wave,
      men: wave.men.filter((e) => !dropped(e)),
      members: wave.members.filter((e) => !dropped(e)),
      catapults: wave.catapults.filter((v) => !behind.has(v)),
    };
    const live = world.mut(barracks, WaveMarch);
    live.men = [...march.members];
    // A catapult that lost its driver stays the wave's where it stands, out of the home crew's reach.
    live.catapults = state.catapults.filter(
      (v) => !behind.has(v) && (world.tryGet(v, Health)?.hitpoints ?? 0) > 0,
    );
    live.legSince = ctx.tick;
    if (state.leg + 1 >= state.waypoints.length) {
      live.arrived = true;
      return null;
    }
    live.leg = state.leg + 1;
    places = formation(world, ctx, terrain, live, march.members, march.catapults);
  }
  const fire = fireOver(world, ctx, terrain, player, march);
  return [
    ...recallOrders(world, terrain, march.members, places, fire),
    ...placeOrders(
      world,
      ctx,
      terrain,
      march.men,
      places,
      march.catapults.length === 0 ? null : fire,
      MILITARY_MODE.DEFEND,
    ),
    ...catapultOrders(world, march.catapults, places),
  ];
}

/** `wave` without the catapults still fighting once the hold has lasted {@link FIGHT_HOLD_TIMEOUT_TICKS}:
 *  they go home to be parked, and the wave marches on. */
function withoutStaleFighters(world: World, ctx: SystemContext, barracks: Entity, wave: Wave): Wave {
  const since = world.get(barracks, WaveMarch).holdSince;
  if (since === null || ctx.tick - since < FIGHT_HOLD_TIMEOUT_TICKS) return wave;
  const stale = new Set(wave.catapults.filter((v) => world.get(v, Vehicle).attack !== null));
  const live = world.mut(barracks, WaveMarch);
  live.catapults = live.catapults.filter((v) => !stale.has(v));
  live.holdSince = null;
  return { ...wave, catapults: wave.catapults.filter((v) => !stale.has(v)) };
}

/**
 * The wave's orders while a catapult of it fights on the way, or null once none fights. The wave holds its
 * leg and the leg clock restarts when the fight ends, so a catapult that left its place to fire is no
 * straggler. On a building the idle catapults and the archers join in and the melee holds behind on IGNORE,
 * as in the siege; on men the archers and the melee answer them from their places on DEFEND.
 */
function holdOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  barracks: Entity,
  player: number,
  wave: Wave,
): PlayerCommand[] | null {
  const state = world.get(barracks, WaveMarch);
  const targets = fightTargets(world, wave.catapults);
  if (targets === null) {
    if (state.holdSince !== null) world.mut(barracks, WaveMarch).holdSince = null;
    return null;
  }
  const live = world.mut(barracks, WaveMarch);
  live.holdSince ??= ctx.tick;
  live.legSince = ctx.tick;
  const buildings = onCatapultContinents(world, ctx, terrain, targets.buildings, wave.catapults);
  const commands: PlayerCommand[] = [];
  const idle: Entity[] = [];
  for (const vehicle of wave.catapults) {
    if (world.get(vehicle, Vehicle).attack !== null) continue;
    const command = catapultOnNearest(world, terrain, vehicle, buildings);
    if (command === null) idle.push(vehicle);
    else commands.push(command);
  }
  const places = formation(world, ctx, terrain, live, wave.members, wave.catapults);
  const fire = fireOver(world, ctx, terrain, player, wave);
  if (targets.buildings.length === 0) {
    return [
      ...commands,
      ...placeOrders(world, ctx, terrain, wave.men, places, fire, MILITARY_MODE.DEFEND),
      ...catapultOrders(world, idle, places),
    ];
  }
  const archers = archersOn(world, ctx, terrain, wave.men, targets.buildings);
  return [
    ...commands,
    ...archers.commands,
    ...placeOrders(world, ctx, terrain, archers.melee, places, fire, MILITARY_MODE.IGNORE),
    ...catapultOrders(world, idle, places),
  ];
}

/** What the fighting catapults of `catapults` fire at, the standing buildings among it ascending id, or
 *  null while none fights. */
function fightTargets(
  world: World,
  catapults: readonly Entity[],
): { readonly buildings: readonly Entity[] } | null {
  let fights = false;
  const buildings = new Set<Entity>();
  for (const vehicle of catapults) {
    const attack = world.get(vehicle, Vehicle).attack;
    if (attack === null) continue;
    fights = true;
    const target = attack.target.kind === 'entity' ? attack.target.entity : null;
    if (target !== null && world.has(target, Building) && (world.tryGet(target, Health)?.hitpoints ?? 0) > 0)
      buildings.add(target);
  }
  return fights ? { buildings: [...buildings].sort((a, b) => a - b) } : null;
}

/** The heading of the wave's current leg, from the last leg end (or the origin) to the next. */
function legHeading(state: WaveMarchView): Heading {
  const end = state.waypoints[Math.min(state.leg, state.waypoints.length - 1)] ?? state.origin;
  const from = state.leg === 0 ? state.origin : (state.waypoints[state.leg - 1] ?? state.origin);
  return headingOf(from, end);
}

/** The leg whose end lies nearest `centre`, searching forward from the current one: a wave a charge has
 *  carried past its leg end marches on from where it stands rather than walking back. */
function legNearest(state: WaveMarchView, centre: HalfCellNode): number {
  let leg = state.leg;
  for (;;) {
    const here = state.waypoints[leg];
    const next = state.waypoints[leg + 1];
    if (here === undefined || next === undefined || manhattanOf(next, centre) >= manhattanOf(here, centre)) {
      return leg;
    }
    leg++;
  }
}

/** The men and catapults of the wave not closed up on their places: none when it has. A man closes up
 *  within {@link REGROUP_SLACK_NODES} of his place and a catapult within
 *  {@link CATAPULT_REGROUP_SLACK_NODES} of its own, or either anywhere past its line, as after a fight that
 *  drew it forward: the next leg carries it on rather than walking it back. */
function stragglers(
  world: World,
  terrain: TerrainGraph,
  state: WaveMarchView,
  places: ReadonlyMap<Entity, HalfCellNode>,
  members: readonly Entity[],
  catapults: readonly Entity[],
): Set<Entity> {
  const behind = new Set<Entity>();
  const heading = legHeading(state);
  for (const e of members) {
    const place = places.get(e);
    if (place === undefined) continue;
    const at = nodeOf(terrain, entityNode(world, terrain, e));
    if (manhattanOf(at, place) > REGROUP_SLACK_NODES && backOf(place, heading, at) > 0) behind.add(e);
  }
  for (const vehicle of catapults) {
    const place = places.get(vehicle);
    const at = vehicleAnchor(world, vehicle);
    if (place === undefined || at === null) continue;
    if (hexDistance(at, place) > CATAPULT_REGROUP_SLACK_NODES && backOf(place, heading, at) > 0)
      behind.add(vehicle);
  }
  return behind;
}

/** The enemy fire the wave's men may stand in: every manned tower post, and the loose enemy archers near
 *  enough the wave for their reach to meet it. */
function fireOver(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  wave: Wave,
): readonly Fire[] {
  const fire: Fire[] = enemyPosts(world, ctx, terrain, player).map((post) => ({
    ...post,
    target: post.tower,
  }));
  for (const raider of seatRaiders(world, ctx, terrain, player)) {
    const near =
      manhattanOf({ hx: raider.x, hy: raider.y }, wave.centre) <= CHARGE_RADIUS_NODES + raider.reach;
    if (near && isRangedFighter(world, ctx, raider.entity)) fire.push({ ...raider, target: raider.entity });
  }
  return fire;
}

/**
 * The node of the enemy catapult firing at one of the wave's men, on the continent of the man nearest the
 * wave's centre: the one nearest that centre, the lowest id on a tie, or null. One firing at the wave's
 * catapults is their duel and leaves the men marching. Read off the enemies' vehicle lists.
 */
function shellingCatapult(
  world: World,
  terrain: TerrainGraph,
  player: number,
  wave: Wave,
): HalfCellNode | null {
  const standing = nearestMemberNode(world, terrain, wave.centre, wave.members);
  if (standing === null) return null;
  const reachable = terrain.componentOf(standing);
  const men = new Set(wave.members);
  let best: { at: HalfCellNode; distance: number; vehicle: Entity } | null = null;
  for (let other = 0; other < MAX_PLAYERS; other++) {
    if (other === player || diplomacyStance(world, player, other) !== 'enemy') continue;
    for (const vehicle of vehicleIndex(world).ownedBy(other)) {
      const target = world.get(vehicle, Vehicle).attack?.target;
      if (target?.kind !== 'entity' || !men.has(target.entity)) continue;
      const at = vehicleAnchor(world, vehicle);
      if (at === null || terrain.componentOf(terrain.nodeAtClamped(at.hx, at.hy)) !== reachable) continue;
      const distance = manhattanOf(at, wave.centre);
      if (best === null || distance < best.distance || (distance === best.distance && vehicle < best.vehicle))
        best = { at, distance, vehicle };
    }
  }
  return best?.at ?? null;
}

/**
 * Where the wave charges, or null: once at least max({@link CHARGE_MIN_ENEMIES}, a
 * {@link CHARGE_ARMY_DIVISOR}th of its men) enemy fighters on foot stand within {@link CHARGE_RADIUS_NODES}
 * of its centre, on the continent of the man nearest it, the node of the one nearest that centre (the
 * lowest id on a tie). Read off the seat's raider scan, which its defence has already paid for this tick.
 */
function chargePoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  wave: Wave,
): HalfCellNode | null {
  const threshold = Math.max(CHARGE_MIN_ENEMIES, Math.ceil(wave.members.length / CHARGE_ARMY_DIVISOR));
  const standing = nearestMemberNode(world, terrain, wave.centre, wave.members);
  if (standing === null) return null;
  const reachable = terrain.componentOf(standing);
  let near = 0;
  let best: { at: HalfCellNode; distance: number } | null = null;
  for (const raider of seatRaiders(world, ctx, terrain, player)) {
    if (raider.component !== reachable) continue;
    const at = { hx: raider.x, hy: raider.y };
    const distance = manhattanOf(at, wave.centre);
    if (distance > CHARGE_RADIUS_NODES) continue;
    near++;
    if (best === null || distance < best.distance) best = { at, distance };
  }
  return near >= threshold && best !== null ? best.at : null;
}

/** Everybody onto the enemy body: the men into the ring around `point` as a wave marches on its objective,
 *  the catapults on an attack-move to it. */
function chargeOrders(world: World, terrain: TerrainGraph, wave: Wave, point: HalfCellNode): PlayerCommand[] {
  return [
    ...ringOrders(world, terrain, wave.men, terrain.nodeAtClamped(point.hx, point.hy)),
    ...wave.catapults.flatMap((vehicle) => driveCatapult(world, vehicle, point, VEHICLE_TARGET_SNAP_RADIUS)),
  ];
}
