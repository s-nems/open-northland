import { CurrentAtomic, EquipOrder, Stance, TrainingOrder } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE, type MilitaryMode } from '../../readviews/index.js';
import { anotherSystemOwns } from '../../settlers/planner/replan.js';
import { entityNode, isTravelling, manhattan } from '../../spatial/nodes.js';
import type { WeaponMix } from './census.js';

// Where the army gathers and when it leaves. Every constant here is a named approximation: the original
// exposes one `HAI_DisableMilitary` toggle and no readable army plan, so the sizes and radii are genre
// convention.

/** How close to a gathering point (Manhattan half-cell nodes) counts as formed up; an idle fighter
 *  outside this ring is called in. */
export const RALLY_HOLD_RADIUS_NODES = 6;

/** The smallest group the seat will send (user rule: a wave is a band of men, never one). */
export const WAVE_MIN_SOLDIERS = 5;

/** The group that marches on any draw - the top of the wave band (user rule: somewhere between
 *  {@link WAVE_MIN_SOLDIERS} and this many). `P(march) = (strength + 1) / band` per decision, where
 *  `strength` is the group's size over the minimum, so both the size and the moment of a wave vary per
 *  game while a full band always leaves. */
export const WAVE_FULL_SOLDIERS = 50;

/** A wave never marches as a pure shooting line: at least this many of it fight in reach, so the archers
 *  have somebody standing in front of them. Waived when the seat owns no melee man at all ({@link
 *  meleeCoreFor}) - archers are then the army, and holding out for a swordsman would bench it forever. */
export const WAVE_MELEE_CORE = 1;

/** The longest `maximumrange` any base weapon row carries (`house bow`; the catapult's 24 and the long
 *  bow's 23 come next). Half-cell nodes, the metric the reach checks already use. */
const LONGEST_REACH_NODES = 29;

/** How far short of the objective a wave forms up before it charges (user rule): far enough that the
 *  WHOLE hold ring, not just its centre, clears {@link LONGEST_REACH_NODES}. No building shoots yet
 *  (docs/tickets/features/tower-defence-mode.md), so today this only keeps the muster out of the town. */
export const STAGING_STANDOFF_NODES = LONGEST_REACH_NODES + RALLY_HOLD_RADIUS_NODES;

/** The melee floor to hold `army` to: the core, or none when the whole army fights at range. */
export function meleeCoreFor(army: WeaponMix): number {
  return army.melee > 0 ? WAVE_MELEE_CORE : 0;
}

/** An army sorted around one charge point: the band standing on it, the men committed forward to it, and
 *  the men still behind. */
export interface Muster {
  readonly formed: readonly Entity[];
  readonly closing: readonly Entity[];
  readonly waiting: readonly Entity[];
}

/** Sort `units` around `charge`. A man closer to the charge point than to `home` counts as committed
 *  forward and is never recalled by a lost roll - that is what keeps an arrival which landed just outside
 *  the hold ring from being walked home and straight out again. */
export function musterAround(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  charge: NodeId,
  home: NodeId,
): Muster {
  const formed: Entity[] = [];
  const closing: Entity[] = [];
  const waiting: Entity[] = [];
  for (const e of units) {
    const at = entityNode(world, terrain, e);
    const toCharge = manhattan(terrain, at, charge);
    if (toCharge <= RALLY_HOLD_RADIUS_NODES) formed.push(e);
    else if (toCharge < manhattan(terrain, at, home)) closing.push(e);
    else waiting.push(e);
  }
  return { formed, closing, waiting };
}

/** Whether the gathered `mix` marches this decision - a strong enough, mixed enough group that wins its
 *  roll. */
export function waveReady(ctx: SystemContext, mix: WeaponMix, meleeCore: number): boolean {
  if (mix.melee < meleeCore) return false;
  const strength = mix.total - WAVE_MIN_SOLDIERS;
  return strength >= 0 && ctx.rng.int(WAVE_FULL_SOLDIERS - WAVE_MIN_SOLDIERS + 1) <= strength;
}

/** How much further than the standoff the walk-back may probe for walkable ground before giving up, so a
 *  line crossing a bay costs a bounded scan per decision instead of one proportional to the map. Past it
 *  the wave forms up at the barracks, which always walks. */
const STAGING_BACKOFF_LIMIT_NODES = STAGING_STANDOFF_NODES;

/**
 * Where a wave forms up before it charges `objective`: the point {@link STAGING_STANDOFF_NODES} back along
 * the straight line to `home`, on ground connected to it. Null when the objective stands closer to the
 * barracks than the standoff - the fight is at the door, and there is nothing left to stage behind.
 */
export function stagingNode(terrain: TerrainGraph, home: NodeId, objective: NodeId): NodeId | null {
  const span = manhattan(terrain, home, objective);
  if (span <= STAGING_STANDOFF_NODES) return null;
  const component = terrain.componentOf(home);
  const ox = terrain.xOf(objective);
  const oy = terrain.yOf(objective);
  const dx = terrain.xOf(home) - ox;
  const dy = terrain.yOf(home) - oy;
  // Keep stepping back toward home while the line lands on water or another island (label -1 / another
  // component): a standoff nobody can walk to would bench the wave. A line that never lands within the
  // backoff limit (a bay between the two shores) yields null, and the wave charges from the barracks.
  const stop = Math.min(span, STAGING_STANDOFF_NODES + STAGING_BACKOFF_LIMIT_NODES);
  for (let back = STAGING_STANDOFF_NODES; back < stop; back++) {
    const node = terrain.nodeAtClamped(
      ox + Math.trunc((dx * back) / span),
      oy + Math.trunc((dy * back) / span),
    );
    if (terrain.componentOf(node) === component) return node;
  }
  return null;
}

/** March `units` on `target`: the ATTACK stance (so they engage what they meet on the road and keep
 *  fighting once the objective falls) and the focus that carries them to it regardless of sight. */
export function marchOrders(world: World, units: readonly Entity[], target: Entity): Command[] {
  const commands: Command[] = [];
  for (const e of units) {
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    commands.push({ kind: 'attackUnit', entity: e, target });
  }
  return commands;
}

/**
 * Gather `units` at `rally` and set the stance they wait in. Arrivals spread over the neighbouring nodes
 * (the planner's idle spacing).
 *
 * `hold` is what keeps a band a band: an idle ATTACK fighter auto-acquires anything hostile in sight
 * (`conflict/engagement.ts`), so a group waiting in the enemy's town would each walk off at a different
 * house, and an engaged man leaves the census - the muster could never fill. DEFEND binds him to where he
 * stands when the order lands, so he crosses the map inert and is re-anchored on arrival.
 *
 * Skipped for a fighter another drive owns, one mid-errand, and one on ground the point cannot be walked
 * to: `moveUnit` would cancel the errand, and an unreachable point would be re-ordered every decision.
 */
export function gatherAt(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  rally: NodeId,
  hold: MilitaryMode,
): Command[] {
  const commands: Command[] = [];
  const { x, y } = terrain.coordsOf(rally);
  const reachable = terrain.componentOf(rally);
  for (const e of units) {
    if (terrain.componentOf(entityNode(world, terrain, e)) !== reachable) continue;
    if (!waitsIn(world, terrain, e, rally, hold)) {
      commands.push({ kind: 'setStance', entity: e, mode: hold });
    }
    if (formedUpAt(world, terrain, e, rally)) continue;
    if (anotherSystemOwns(world, e) || isBusy(world, e)) continue;
    commands.push({ kind: 'moveUnit', entity: e, x, y });
  }
  return commands;
}

/** Whether `e` already waits the way {@link gatherAt} wants: the right mode, and - once he stands on the
 *  rally - a DEFEND anchor on it rather than the one he set out from. */
function waitsIn(world: World, terrain: TerrainGraph, e: Entity, rally: NodeId, hold: MilitaryMode): boolean {
  const stance = world.tryGet(e, Stance);
  if (stance?.mode !== hold) return false;
  if (hold !== MILITARY_MODE.DEFEND || !formedUpAt(world, terrain, e, rally)) return true;
  const anchor = stance.anchorCell;
  return anchor !== null && manhattan(terrain, anchor, rally) <= RALLY_HOLD_RADIUS_NODES;
}

function formedUpAt(world: World, terrain: TerrainGraph, e: Entity, rally: NodeId): boolean {
  return manhattan(terrain, entityNode(world, terrain, e), rally) <= RALLY_HOLD_RADIUS_NODES;
}

/** Errands a recall would silently throw away: `moveUnit` strips the drill and equip orders and cancels
 *  a running action, and a fighter already walking is on his way somewhere for a reason. */
function isBusy(world: World, e: Entity): boolean {
  return (
    world.has(e, TrainingOrder) ||
    world.has(e, EquipOrder) ||
    world.has(e, CurrentAtomic) ||
    isTravelling(world, e)
  );
}
