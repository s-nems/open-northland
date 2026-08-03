import { CurrentAtomic, EquipOrder, Stance, TrainingOrder } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE } from '../../readviews/index.js';
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
 *  have somebody standing in front of them. */
export const WAVE_MELEE_CORE = 1;

/** How far short of the objective a wave forms up before it charges (user rule). Outside the longest
 *  defensive reach in the base data - the tower's `house bow` at `maximumrange 29` - so the group can
 *  assemble before the arrows start. */
export const STAGING_STANDOFF_NODES = 30;

/** Whether the gathered `mix` marches this decision - a strong enough, mixed enough group that wins its
 *  roll. */
export function waveReady(ctx: SystemContext, mix: WeaponMix): boolean {
  if (mix.melee < WAVE_MELEE_CORE) return false;
  const strength = mix.total - WAVE_MIN_SOLDIERS;
  return strength >= 0 && ctx.rng.int(WAVE_FULL_SOLDIERS - WAVE_MIN_SOLDIERS + 1) <= strength;
}

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
  // component): a standoff nobody can walk to would bench the wave. A line that never lands (a bay
  // between the two shores) yields null, and the wave charges from the barracks instead.
  for (let back = STAGING_STANDOFF_NODES; back < span; back++) {
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
 * Gather `units` at `rally` - the barracks door at home, the staging node in the field. Waiting fighters
 * keep the fighter default ATTACK stance, so a gathered body still fights what comes to it and this drive
 * only has to fetch in the ones a chase or an errand left standing elsewhere; arrivals spread themselves
 * over the neighbouring nodes (the planner's idle spacing).
 *
 * Skipped for a fighter another drive owns, one mid-errand, and one on ground the point cannot be walked
 * to: `moveUnit` would cancel the errand, and an unreachable point would be re-ordered every decision.
 */
export function gatherAt(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  rally: NodeId,
): Command[] {
  const commands: Command[] = [];
  const { x, y } = terrain.coordsOf(rally);
  const reachable = terrain.componentOf(rally);
  for (const e of units) {
    if (formedUpAt(world, terrain, e, rally)) continue;
    if (terrain.componentOf(entityNode(world, terrain, e)) !== reachable) continue;
    if (anotherSystemOwns(world, e) || isBusy(world, e)) continue;
    commands.push({ kind: 'moveUnit', entity: e, x, y });
  }
  return commands;
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
