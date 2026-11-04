import {
  type ColonyPhase,
  diplomacyStance,
  type LandingOperation,
  MAX_PLAYERS,
  Vehicle,
} from '../../../../components/index.js';
import type { DeepReadonly, Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId } from '../../../../nav/terrain/index.js';
import { seatColonies } from '../../../ai-shared/home-roster.js';
import { ownedFightersOf } from '../../../movement/collision/owned-fighters.js';
import { isShipVehicle } from '../../../readviews/vehicles.js';
import { vehicleIndex } from '../../../vehicles/registry.js';
import { playerSeesNode } from '../../../vision/gates.js';
import { minutesToTicks } from '../../game-phase.js';
import { SOLDIERS_PER_SHIP } from '../../workforce/craft.js';
import { isLiveFighter, unitPoints } from '../points.js';
import { LANDING_EDGE, type LandingAim, type RankedMan } from './landing-aim.js';
import { believedLand } from './landing-target.js';
import type { OperationEnv } from './lifecycle.js';
import { nodeOfEntity, visibleEnemyFighters } from './raid-target.js';

// A relief (owner ruling): an enemy band on one of the seat's colonies sends a landing from home to fight
// it, sized to outweigh what the seat sees there beyond the colony's own fighters; an enemy ship moored at
// the colony adds the load it may still carry. The landed men go for the enemy fighters they see on the
// colony and sail home once none is left. A relief is the landing with no building for its target. Every
// figure is authored.

/** The fewest men a relief sails with. */
export const RELIEF_LEAST_MEN = 5;

/** How long a band seen about a colony keeps it worth relieving after the colony last saw it: the colony's
 *  own threat memory is longer, but a relief sails for a band still there. */
const RELIEF_THREAT_TICKS = minutesToTicks(5);

/** An enemy ship the seat sees moored at a colony's land, or an enemy fighter it sees there. */
interface ColonyThreatSeen {
  readonly land: number;
  readonly owner: number;
  readonly at: HalfCellNode;
  readonly points: number;
}

/** The colony phases in which the colony stands on its land, so there is something to relieve. */
const STANDING_PHASES: ReadonlySet<ColonyPhase> = new Set(['landing', 'founding', 'running']);

/** Whether the seat has a colony standing on its land, which a relief may sail for. */
export function mayRelieve(env: OperationEnv): boolean {
  return seatColonies(env.world, env.seat).some((c) => STANDING_PHASES.has(c.phase));
}

/** Whether `op` is a relief: the only landing aimed at no building (`reliefAim`). */
export function isRelief(op: DeepReadonly<LandingOperation>): boolean {
  return op.target.entity === null;
}

/**
 * The relief of the colony the seat sees most threatened, or null: for each colony standing on its land
 * with a band its garrison saw lately or an enemy ship moored there, and enemy fighters in sight on that
 * land, the enemy points seen there (a moored ship adds {@link SOLDIERS_PER_SHIP} men of the `ranked` men's
 * mean, an approximation of a load the seat cannot see) past {@link LANDING_EDGE} of the seat's own fighters
 * on that land; the strongest of `ranked` that outweigh the gap by that edge, at least
 * {@link RELIEF_LEAST_MEN}, within `seats`. Costs the enemies' ships and, with a colony to weigh, their
 * fighters and the seat's own.
 */
export function reliefAim(env: OperationEnv, ranked: readonly RankedMan[], seats: number): LandingAim | null {
  const { world, ctx, seat } = env;
  const colonies = seatColonies(world, seat).filter((c) => STANDING_PHASES.has(c.phase));
  if (colonies.length === 0 || ranked.length === 0) return null;
  let total = 0;
  for (const m of ranked) total += m.points;
  const shipPoints = Math.floor((total * SOLDIERS_PER_SHIP) / ranked.length);
  const ships = enemyShipsAt(env, new Set(colonies.map((c) => c.land)), shipPoints);
  const watched = colonies.filter(
    (c) =>
      ships.some((s) => s.land === c.land) ||
      (c.threat !== null && ctx.tick - c.threat.since < RELIEF_THREAT_TICKS),
  );
  if (watched.length === 0) return null;
  const fighters = enemyFightersOn(env, new Set(watched.map((c) => c.land)));
  const own = ownPointsOn(env, new Set(watched.map((c) => c.land)));
  let best: { readonly land: number; readonly gap: number; readonly first: ColonyThreatSeen } | null = null;
  for (const colony of watched) {
    const band = fighters.filter((t) => t.land === colony.land);
    const first = band[0];
    if (first === undefined) continue;
    let enemy = 0;
    for (const t of [...band, ...ships.filter((t) => t.land === colony.land)]) enemy += t.points;
    const gap = enemy * LANDING_EDGE.num - (own.get(colony.land) ?? 0) * LANDING_EDGE.den;
    if (gap > 0 && (best === null || gap > best.gap)) best = { land: colony.land, gap, first };
  }
  if (best === null) return null;
  const men: Entity[] = [];
  let points = 0;
  for (const m of ranked) {
    if (men.length >= RELIEF_LEAST_MEN && points * LANDING_EDGE.den >= best.gap) break;
    if (men.length >= seats) return null;
    men.push(m.entity);
    points += m.points;
  }
  if (men.length < RELIEF_LEAST_MEN || points * LANDING_EDGE.den < best.gap) return null;
  return {
    land: best.land,
    owner: best.first.owner,
    headquarters: false,
    towards: best.first.at,
    entity: null,
    believed: believedLand(env, best.land),
    storm: false,
    men,
  };
}

/**
 * Where the men a relief set ashore on `land` go: the enemy fighter the seat sees there nearest `from`, the
 * first in sighting order on a tie, or null once it sees none.
 */
export function reliefObjective(env: OperationEnv, land: number, from: HalfCellNode): NodeId | null {
  const { terrain } = env;
  let best: { readonly at: HalfCellNode; readonly distance: number } | null = null;
  for (const t of enemyFightersOn(env, new Set([land]))) {
    const distance = nodeManhattan(t.at, from);
    if (best === null || distance < best.distance) best = { at: t.at, distance };
  }
  return best === null ? null : terrain.nodeAtClamped(best.at.hx, best.at.hy);
}

function landOf(env: OperationEnv, at: HalfCellNode): number {
  const { terrain } = env;
  return terrain.inBounds(at.hx, at.hy) ? terrain.componentOf(terrain.nodeAt(at.hx, at.hy)) : NO_COMPONENT;
}

/** The enemy ships the seat sees moored on one of `lands`, each weighed `points`. */
function enemyShipsAt(env: OperationEnv, lands: ReadonlySet<number>, points: number): ColonyThreatSeen[] {
  const { world, ctx, seat } = env;
  const vehicles = ctx.content.vehicles;
  const seen: ColonyThreatSeen[] = [];
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === seat || diplomacyStance(world, seat, owner) !== 'enemy') continue;
    for (const e of vehicleIndex(world).ownedBy(owner)) {
      const state = world.get(e, Vehicle);
      if (!state.moored || state.mooring === null) continue;
      const land = landOf(env, state.mooring);
      if (!lands.has(land) || !playerSeesNode(ctx.fog, seat, state.mooring.hx, state.mooring.hy)) continue;
      const type = vehicles.find((v) => v.typeId === state.vehicleType);
      if (type === undefined || !isShipVehicle(type)) continue;
      seen.push({ land, owner, at: { hx: state.mooring.hx, hy: state.mooring.hy }, points });
    }
  }
  return seen;
}

/** The enemy fighters the seat sees standing on one of `lands`. */
function enemyFightersOn(env: OperationEnv, lands: ReadonlySet<number>): ColonyThreatSeen[] {
  const seen: ColonyThreatSeen[] = [];
  for (const f of visibleEnemyFighters(env.world, env.ctx, env.seat)) {
    const land = landOf(env, f.at);
    if (lands.has(land)) seen.push({ land, owner: f.owner, at: f.at, points: f.points });
  }
  return seen;
}

/** The seat's own fighters' points by the land of `lands` they stand on. */
function ownPointsOn(env: OperationEnv, lands: ReadonlySet<number>): Map<number, number> {
  const { world, ctx, seat } = env;
  const byLand = new Map<number, number>();
  for (const e of ownedFightersOf(world, ctx.content, seat)) {
    if (!isLiveFighter(world, e)) continue;
    const at = nodeOfEntity(world, e);
    if (at === null) continue;
    const land = landOf(env, at);
    if (lands.has(land)) byLand.set(land, (byLand.get(land) ?? 0) + unitPoints(world, ctx, e));
  }
  return byLand;
}
