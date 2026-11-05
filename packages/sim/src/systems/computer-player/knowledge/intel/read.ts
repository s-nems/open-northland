import {
  aiControlEntity,
  ComputerIntel,
  type ComputerIntelSnapshot,
  type ComputerIntelState,
  diplomacyStance,
  type IntelBuilding,
  type IntelForces,
  NEVER_SEEN,
} from '../../../../components/index.js';
import type { DeepReadonly, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { everyFighterPoints } from '../../military/points.js';
import { decayedPeak, LAND_FORCES_HALF_LIFE_TICKS } from './update.js';

type IntelView = DeepReadonly<ComputerIntelState>;
type IntelBuildingView = DeepReadonly<IntelBuilding>;

const NOTHING: readonly IntelBuildingView[] = [];

function intelOf(world: World, seat: number): IntelView | undefined {
  const carrier = aiControlEntity(world, seat);
  return carrier === null ? undefined : world.tryGet(carrier, ComputerIntel);
}

/** Every building `seat` remembers, of any owner, ascending entity id. */
export function rememberedBuildings(world: World, seat: number): readonly IntelBuildingView[] {
  return intelOf(world, seat)?.buildings ?? NOTHING;
}

/** The buildings `seat` believes stand, of the owners it holds an `enemy` stance toward now (relations
 *  read live), ascending entity id. */
export function believedEnemyBuildings(world: World, seat: number): readonly IntelBuildingView[] {
  const intel = intelOf(world, seat);
  if (intel === undefined) return NOTHING;
  return intel.buildings.filter((b) => diplomacyStance(world, seat, b.owner) === 'enemy');
}

/** The enemy buildings `seat` last saw fighters holding a post on, ascending entity id. */
export function believedTowerPosts(world: World, seat: number): readonly IntelBuildingView[] {
  return believedEnemyBuildings(world, seat).filter((b) => b.posted > 0);
}

/** The most fighters of `owner` that `seat` saw at once, aged to `tick`; null when it has seen none
 *  recently enough to remember, so the caller decides what an unknown army counts as. */
export function believedFighterStrength(
  world: World,
  seat: number,
  owner: number,
  tick: number,
): number | null {
  const forces = intelOf(world, seat)?.forces.find((f) => f.player === owner);
  return forces === undefined ? null : peakOrUnknown(forces, tick);
}

/** The most fighter points of `owner` that `seat` saw at once, aged to `tick` like
 *  {@link believedFighterStrength}; null when none is remembered. */
export function believedFighterPoints(
  world: World,
  seat: number,
  owner: number,
  tick: number,
): number | null {
  const forces = intelOf(world, seat)?.forces.find((f) => f.player === owner);
  return forces === undefined ? null : pointsOrUnknown(forces, tick);
}

/** The most times over {@link peakFighterPoints} lets a remembered army grow out of sight. Authored: on
 *  arabskie_wyspy_wolna_gra_mieszana armies first seen around minute 90 grew about tenfold by minute 150;
 *  the limit keeps a sighting made while the seat's own army was a handful from reading a hundredfold. */
export const UNSEEN_ARMY_GROWTH_LIMIT = 8;

/**
 * The most fighter points of `owner` that `seat` ever saw at once, never aged, grown in proportion as the
 * seat's own fighter points ({@link everyFighterPoints}) grew since that sighting, at most
 * {@link UNSEEN_ARMY_GROWTH_LIMIT} times and never shrunk; null when none is remembered. For a decision that
 * cannot be taken back, where a faded memory would undercount an army out of sight. Approximation: seats
 * of one map arm at about one pace, so an army unseen since grows like the seat's own. Costs the seat's
 * fighters unless the caller passes their points as `own`.
 */
export function peakFighterPoints(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number,
  own: number = everyFighterPoints(world, ctx, seat),
): number | null {
  const forces = intelOf(world, seat)?.forces.find((f) => f.player === owner);
  if (forces === undefined || forces.mostPoints <= 0) return null;
  const { mostPoints, ownPointsAtMost } = forces;
  // A sighting made while the seat had no fighter gives no base to grow from, so it reads as seen.
  if (own <= ownPointsAtMost || ownPointsAtMost <= 0) return mostPoints;
  const grown = Math.floor((mostPoints * own) / ownPointsAtMost);
  return Math.min(mostPoints * UNSEEN_ARMY_GROWTH_LIMIT, grown);
}

/** The most fighter points of `owner` that `seat` saw at once standing on `land`, aged to `tick` by
 *  {@link LAND_FORCES_HALF_LIFE_TICKS}; 0 when it saw none there. */
export function rememberedLandPoints(
  world: World,
  seat: number,
  owner: number,
  land: number,
  tick: number,
): number {
  const held = intelOf(world, seat)
    ?.forces.find((f) => f.player === owner)
    ?.lands.find((l) => l.land === land);
  return held === undefined ? 0 : decayedPeak(held.points, held.seenAt, tick, LAND_FORCES_HALF_LIFE_TICKS);
}

function peakOrUnknown(forces: DeepReadonly<IntelForces>, tick: number): number | null {
  const peak = decayedPeak(forces.peak, forces.peakAt, tick);
  return peak > 0 ? peak : null;
}

function pointsOrUnknown(forces: DeepReadonly<IntelForces>, tick: number): number | null {
  const peak = decayedPeak(forces.peakPoints, forces.peakPointsAt, tick);
  return peak > 0 ? peak : null;
}

/** Ticks since `seat` last saw into `zone`, or null when it never has. */
export function zoneStaleness(world: World, seat: number, zone: number, tick: number): number | null {
  const seenAt = intelOf(world, seat)?.zoneSeenAt[zone] ?? NEVER_SEEN;
  return seenAt === NEVER_SEEN ? null : tick - seenAt;
}

/** The zones where `seat` lost a scout within `memory` ticks before `tick`, ascending. */
export function scoutLossZones(world: World, seat: number, tick: number, memory: number): number[] {
  return recentZones(intelOf(world, seat)?.scoutLostAt, tick, memory);
}

/** The zones `seat`'s scout turned back from a goal in within `memory` ticks before `tick`, ascending. */
export function scoutTurnBackZones(world: World, seat: number, tick: number, memory: number): number[] {
  return recentZones(intelOf(world, seat)?.scoutTurnedBackAt, tick, memory);
}

/** The zones whose per-zone tick lies within `memory` ticks before `tick`, ascending. */
function recentZones(at: readonly number[] | undefined, tick: number, memory: number): number[] {
  const zones: number[] = [];
  if (at === undefined) return zones;
  for (let zone = 0; zone < at.length; zone++) {
    const when = at[zone] ?? NEVER_SEEN;
    if (when !== NEVER_SEEN && tick - when < memory) zones.push(zone);
  }
  return zones;
}

/** One other seat as a computer seat believes it, for a debug view. */
export interface IntelOwnerSummary {
  readonly owner: number;
  /** Remembered buildings, of them never seen (known from the start layout), and manned posts. */
  readonly buildings: number;
  readonly unseenBuildings: number;
  readonly posts: number;
  /** The aged peak of fighters seen at once, null when none is remembered. */
  readonly fighters: number | null;
  /** The aged peak of fighter points seen at once, null when none is remembered. */
  readonly points: number | null;
  /** The last fighter sighting and the zone most stood in, null before any. */
  readonly fightersSeenAt: number | null;
  readonly fightersZone: number | null;
}

export interface SeatIntelSummary {
  /** Ascending owner. */
  readonly owners: readonly IntelOwnerSummary[];
  /** Zones the seat has ever seen into, of all the brief's zones. */
  readonly zonesSeen: number;
  readonly zones: number;
}

/** A plain-data digest of one seat's memory at `tick`; takes the `ComputerIntel` component as a snapshot
 *  carries it, so a debug view can feed it a snapshot's copy. */
export function summarizeIntel(intel: DeepReadonly<ComputerIntelSnapshot>, tick: number): SeatIntelSummary {
  const owners = new Map<number, { buildings: number; unseenBuildings: number; posts: number }>();
  const tally = (owner: number) => {
    let held = owners.get(owner);
    if (held === undefined) {
      held = { buildings: 0, unseenBuildings: 0, posts: 0 };
      owners.set(owner, held);
    }
    return held;
  };
  for (const b of intel.buildings) {
    const held = tally(b.owner);
    held.buildings++;
    if (b.seenAt === NEVER_SEEN) held.unseenBuildings++;
    if (b.posted > 0) held.posts++;
  }
  for (const f of intel.forces) tally(f.player);
  const summaries = [...owners.keys()]
    .sort((a, b) => a - b)
    .map((owner): IntelOwnerSummary => {
      const forces = intel.forces.find((f) => f.player === owner);
      return {
        owner,
        ...tally(owner),
        fighters: forces === undefined ? null : peakOrUnknown(forces, tick),
        points: forces === undefined ? null : pointsOrUnknown(forces, tick),
        fightersSeenAt: forces?.lastSeenAt ?? null,
        fightersZone: forces?.lastZone ?? null,
      };
    });
  return {
    owners: summaries,
    zonesSeen: intel.zoneSeenAt.filter((t) => t !== NEVER_SEEN).length,
    zones: intel.zoneSeenAt.length,
  };
}
