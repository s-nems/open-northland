import { CurrentAtomic, EquipOrder, Stance, TrainingOrder } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { anotherSystemOwns } from '../../settlers/planner/replan.js';
import { entityNode, isTravelling, manhattan } from '../../spatial/nodes.js';
import type { ArmyCensus } from './census.js';

// Where the army waits and when it leaves. Every constant here is a named approximation: the original
// exposes one `HAI_DisableMilitary` toggle and no readable army plan, so the sizes and radii are genre
// convention.

/** How far (Manhattan half-cell nodes) from the barracks a fighter still counts as part of the muster -
 *  a settlement's rough spread. Past it he is out on campaign and is re-aimed, never recalled. */
export const MUSTER_HOME_RADIUS_NODES = 32;

/** How close to the barracks door counts as formed up; an idle fighter outside this ring is called in. */
export const RALLY_HOLD_RADIUS_NODES = 6;

/** The smallest wave the seat will send - below this the muster keeps growing. */
export const WAVE_MIN_SOLDIERS = 8;

/** The launch roll's spread: `P(march) = (surplus + 1) / spread` per decision, where `surplus` is the
 *  muster's strength over {@link WAVE_MIN_SOLDIERS}. Both the size and the moment of a wave therefore
 *  vary per game, while a muster a full spread over the minimum always leaves. */
export const WAVE_LAUNCH_SPREAD = 12;

/** A wave never marches as a pure shooting line: at least this many of it fight in reach, so the archers
 *  have somebody standing in front of them. */
export const WAVE_MELEE_CORE = 1;

/** Whether the muster marches this decision - a strong enough, mixed enough wave that wins its roll. */
export function waveReady(ctx: SystemContext, army: ArmyCensus): boolean {
  if (army.melee < WAVE_MELEE_CORE) return false;
  const surplus = army.muster.length - WAVE_MIN_SOLDIERS;
  return surplus >= 0 && ctx.rng.int(WAVE_LAUNCH_SPREAD) <= surplus;
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
 * Call the muster in to the barracks door. Waiting fighters keep the fighter default ATTACK stance, so
 * the gathered army still defends the settlement at full sight and this drive only has to fetch back the
 * ones a chase or an errand left standing elsewhere; arrivals spread themselves over the neighbouring
 * nodes (the planner's idle spacing).
 *
 * Skipped for a fighter another drive owns, one mid-errand, and one on ground the door cannot be walked
 * to: `moveUnit` would cancel the errand, and an unreachable door would be re-ordered every decision.
 */
export function holdMuster(world: World, terrain: TerrainGraph, army: ArmyCensus, rally: NodeId): Command[] {
  const commands: Command[] = [];
  const { x, y } = terrain.coordsOf(rally);
  const home = terrain.componentOf(rally);
  for (const e of army.muster) {
    const at = entityNode(world, terrain, e);
    if (manhattan(terrain, at, rally) <= RALLY_HOLD_RADIUS_NODES) continue;
    if (terrain.componentOf(at) !== home) continue;
    if (anotherSystemOwns(world, e) || isBusy(world, e)) continue;
    commands.push({ kind: 'moveUnit', entity: e, x, y });
  }
  return commands;
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
