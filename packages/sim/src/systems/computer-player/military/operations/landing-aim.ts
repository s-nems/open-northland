import {
  diplomacyStance,
  MAX_PLAYERS,
  mapBriefOf,
  playerPlacementTribes,
} from '../../../../components/index.js';
import { isPlayerDead } from '../../../../components/match.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { NO_COMPONENT } from '../../../../nav/terrain/index.js';
import { buildingCombatClass } from '../../../readviews/index.js';
import type { Share } from '../../difficulty.js';
import { peakFighterPoints, rememberedLandPoints } from '../../knowledge/intel/index.js';
import { landOfPoint } from '../../sea-route.js';
import { knownDefendingPoints, ownArmyPoints } from '../enemy-strength.js';
import { launchRatioReached } from '../plan.js';
import {
  type BelievedLand,
  type BelievedTarget,
  believedFireAt,
  believedLands,
  landingObjective,
  towersReaching,
} from './landing-target.js';
import type { OperationEnv } from './lifecycle.js';
import { defenceAt, RAID_TOWER_DEFENCE, visibleEnemyFighters } from './raid-target.js';

// Where a landing sails and whom it takes (owner ruling): every land the seat believes holds an enemy
// building is a candidate, the lands of a rival's headquarters first, where the whole wave goes, then his
// colonies, raided by a band sized to the defence the seat has seen there. A landing that clearly outweighs
// what defends a settlement storms it even where towers cover every building. Every figure is authored.

/** The least a landing outweighs what the seat believes defends its target when no building there lies
 *  clear of the towers and shelters ({@link stormDefence}). Authored: twice, so a wave that loses half its
 *  men to the towers on the way in still holds its edge. */
export const LANDING_STORM_EDGE: Share = { num: 2, den: 1 };

/** The least the men a storm set ashore keep outweighing what defends their objective to storm on: half
 *  {@link LANDING_STORM_EDGE}, the losses on the way in its margin allows for. */
export const LANDING_STORM_HOLD_EDGE: Share = { num: 1, den: 1 };

/** The least a landing outweighs the believed defence of a target clear of every tower, and a rescue the
 *  band it sails for. Authored: observed on arabskie_wyspy_wolna_gra_mieszana, a landing at parity with a
 *  rival's soldiers all fell within minutes for far fewer of his. */
export const LANDING_EDGE: Share = { num: 3, den: 2 };

/** The fewest men a raid on a rival's colony sets out with, however little the seat saw defend it: half a
 *  small ship's load, enough to fell a store before an unseen garrison gathers. */
export const COLONY_RAID_LEAST_MEN = 10;

/** A man the seat could send, with his points. */
export interface RankedMan {
  readonly entity: Entity;
  readonly points: number;
}

/** Where a landing sails and with whom. */
export interface LandingAim {
  readonly land: number;
  /** The owner of the headquarters there, else of most of the buildings the seat believes stand there. */
  readonly owner: number;
  /** Where the ships seek their shores: the headquarters, else the building nearest the seat. */
  readonly towards: HalfCellNode;
  /** The building at {@link towards}, null for a rescue, which heads for a band. */
  readonly entity: Entity | null;
  readonly believed: BelievedLand;
  /** The wave, strongest first. */
  readonly men: readonly Entity[];
}

/** What the ships the landing may take hold. */
export interface LandingRoom {
  /** The seats of each free ship, its helm's included, in the order the landing fills them. */
  readonly ships: readonly number[];
  /** Their seats together. */
  readonly seats: number;
  /** Enough ships and men for a big landing on a headquarters (`landing.ts`). */
  readonly bigLanding: boolean;
}

/** One candidate land as the seat believes it. */
interface Candidate {
  readonly land: number;
  readonly owner: number;
  readonly headquarters: BelievedTarget | null;
  readonly towards: BelievedTarget;
  readonly believed: BelievedLand;
}

function atLeast(a: Share, b: Share): Share {
  return a.num * b.den >= b.num * a.den ? a : b;
}

/**
 * The first landing `launch` makes of the lands the seat may land on, or null while none is worth it or
 * none yields one: the candidates ({@link candidatesOf}) in turn, each rival's headquarters land first,
 * nearest `from` first, then the colonies the same way, each offered to `launch` once the `ranked` men can
 * take it within `room`. On a headquarters land the whole wave goes once `ratio` (the posture's launch edge)
 * holds over the believed defence; on a colony the strongest men go, as many as outweigh the defence seen
 * there by {@link LANDING_EDGE}, at least {@link COLONY_RAID_LEAST_MEN}. Every edge weighs the men who go
 * ashore ({@link pointsAshore}). Costs the believed buildings and, with a colony to weigh, the enemies'
 * fighters.
 */
export function landingAim<T>(
  env: OperationEnv,
  home: number,
  from: HalfCellNode,
  ranked: readonly RankedMan[],
  ratio: Share,
  room: LandingRoom,
  launch: (aim: LandingAim) => T | null,
): T | null {
  let fighters: LandFighters | null = null;
  const armies = armyWeights(env);
  const wave = { ranked, prefix: prefixPoints(ranked), ships: room.ships, seats: room.seats };
  for (const c of candidatesOf(env, home, from)) {
    let aim: LandingAim | null = null;
    if (c.headquarters !== null) {
      if (room.bigLanding) aim = headquartersAim(env, c, wave, ratio, armies);
    } else {
      fighters ??= landFighters(env);
      aim = colonyAim(env, c, wave, ratio, armies, fighters);
    }
    const launched = aim === null ? null : launch(aim);
    if (launched !== null) return launched;
  }
  return null;
}

/** The enemy lands other than `home`, headquarters lands first, each group nearest `from` first. */
function candidatesOf(env: OperationEnv, home: number, from: HalfCellNode): Candidate[] {
  const { ctx } = env;
  const candidates: (Candidate & { readonly distance: number })[] = [];
  for (const [land, believed] of believedLands(env)) {
    if (land === home || believed.targets.length === 0) continue;
    let headquarters: BelievedTarget | null = null;
    let nearest: BelievedTarget | null = null;
    const owned = new Map<number, number>();
    for (const t of believed.targets) {
      owned.set(t.owner, (owned.get(t.owner) ?? 0) + 1);
      if (
        buildingCombatClass(ctx, t.buildingType) === 'hq' &&
        (headquarters === null || t.entity < headquarters.entity)
      )
        headquarters = t;
      if (nearest === null || nodeManhattan(t.at, from) < nodeManhattan(nearest.at, from)) nearest = t;
    }
    const towards = headquarters ?? nearest;
    if (towards === null) continue;
    let owner = headquarters?.owner ?? -1;
    if (owner < 0) {
      let most = 0;
      for (const [o, count] of [...owned].sort((a, b) => a[0] - b[0])) {
        if (count > most) {
          owner = o;
          most = count;
        }
      }
    }
    candidates.push({
      land,
      owner,
      headquarters,
      towards,
      believed,
      distance: nodeManhattan(towards.at, from),
    });
  }
  const group = (c: Candidate): number => (c.headquarters === null ? 1 : 0);
  return candidates.sort((a, b) => group(a) - group(b) || a.distance - b.distance || a.land - b.land);
}

/** The points of the strongest `i` of `ranked` at index `i`, 0 at 0. */
export function prefixPoints(ranked: readonly RankedMan[]): number[] {
  const prefix = [0];
  for (const m of ranked) prefix.push((prefix.at(-1) ?? 0) + m.points);
  return prefix;
}

/**
 * The points ashore of a wave of the strongest `count` men of `prefix` ({@link prefixPoints}) aboard the
 * fewest of `ships` ({@link LandingRoom.ships}) that seat them: every such ship keeps its weakest man aboard
 * at the helm (`crewsOf` in `landing.ts`), so the rest go ashore.
 */
export function pointsAshore(prefix: readonly number[], count: number, ships: readonly number[]): number {
  let seats = 0;
  let hulls = 0;
  for (const room of ships) {
    if (seats >= count) break;
    seats += room;
    hulls++;
  }
  return prefix[Math.max(0, count - hulls)] ?? 0;
}

/** The men a landing may send, strongest first with their {@link prefixPoints}, and the ships that seat
 *  them ({@link LandingRoom}). */
interface WaveRoom {
  readonly ranked: readonly RankedMan[];
  readonly prefix: readonly number[];
  readonly ships: readonly number[];
  readonly seats: number;
}

/** The tribe whose house bow a believed building's shelter fires: its owner's first tribe in the lobby's
 *  placement, which every seat knows, never the building itself, which may have fallen out of sight. */
function tribeOf(env: OperationEnv, target: BelievedTarget | null): number | undefined {
  return target === null ? undefined : playerPlacementTribes(env.world, target.owner)?.[0];
}

/** The fire the seat believes covers `at`, 0 without a tribe to arm it. */
function fireAt(
  env: OperationEnv,
  believed: BelievedLand,
  at: HalfCellNode,
  tribe: number | undefined,
): number {
  return tribe === undefined ? 0 : believedFireAt(env.ctx, believed.sources, at, tribe);
}

/**
 * The whole wave on a rival's headquarters land: to a clear objective once it reaches `ratio`, at least
 * {@link LANDING_EDGE}, of his army ({@link ArmyWeights}) plus the fire there; with none clear, it storms
 * once it reaches {@link LANDING_STORM_EDGE} over the {@link stormDefence}.
 */
function headquartersAim(
  env: OperationEnv,
  c: Candidate,
  room: WaveRoom,
  ratio: Share,
  armies: ArmyWeights,
): LandingAim | null {
  const { ctx } = env;
  const wave = room.ranked.slice(0, room.seats);
  if (wave.length === 0) return null;
  const points = pointsAshore(room.prefix, wave.length, room.ships);
  const aim: LandingAim = {
    land: c.land,
    owner: c.owner,
    towards: c.towards.at,
    entity: c.towards.entity,
    believed: c.believed,
    men: wave.map((m) => m.entity),
  };
  const clear = landingObjective(ctx, c.believed, c.towards.at);
  if (clear !== null) {
    const fire = fireAt(env, c.believed, clear.at, tribeOf(env, c.headquarters));
    const opposing = armies(c.owner) + fire;
    return launchRatioReached(points, opposing, atLeast(ratio, LANDING_EDGE)) ? aim : null;
  }
  const storm = landingObjective(ctx, c.believed, c.towards.at, true);
  if (storm === null) return null;
  const opposing = stormDefence(env, c.believed, c.land, c.owner, storm, armies);
  return launchRatioReached(points, opposing, atLeast(ratio, LANDING_STORM_EDGE)) ? aim : null;
}

/**
 * What `owner`'s army weighs against a landing on his headquarters land: what the seat believes defends
 * him ({@link knownDefendingPoints}), at least the most it ever saw of his army at once, grown since as
 * its own army grew ({@link peakFighterPoints}): landed men cannot fall back, and a memory faded while his
 * army was out of sight undercounts it. Null when the seat knows nothing of it.
 */
function landingArmy(env: OperationEnv, owner: number): number | null {
  const { world, ctx, seat } = env;
  const known = knownDefendingPoints(world, ctx, seat, owner);
  const peak = peakFighterPoints(world, ctx, seat, owner);
  if (known === null) return peak;
  return peak === null ? known : Math.max(known, peak);
}

/** What a rival's army weighs against a landing on his headquarters land, each read once a decision. */
type ArmyWeights = (owner: number) => number;

/**
 * The {@link ArmyWeights} of one decision: a rival's {@link landingArmy}; one the seat never saw, the
 * strongest army it believes of any living enemy, else its own army's points. Approximation: seats of one
 * map arm at about one pace, so an unseen army is weighed like the strongest seen, or at parity, never as
 * nothing; the same weight holds a clear landing and a storm. Costs the enemies' fighters once.
 */
function armyWeights(env: OperationEnv): ArmyWeights {
  const { world, ctx, seat } = env;
  const known = new Map<number, number | null>();
  const knownOf = (owner: number): number | null => {
    if (!known.has(owner)) known.set(owner, landingArmy(env, owner));
    return known.get(owner) ?? null;
  };
  let unseen: number | null = null;
  return (owner) => {
    const army = knownOf(owner);
    if (army !== null) return army;
    if (unseen === null) {
      let strongest: number | null = null;
      for (let other = 0; other < MAX_PLAYERS; other++) {
        if (other === seat || diplomacyStance(world, seat, other) !== 'enemy' || isPlayerDead(world, other))
          continue;
        const seen = knownOf(other);
        if (seen !== null && (strongest === null || seen > strongest)) strongest = seen;
      }
      unseen = strongest ?? ownArmyPoints(world, ctx, seat).points;
    }
    return unseen;
  };
}

/** The land component `owner` started the match on, known to every seat from the map's start layout. */
function startLandOf(world: World, owner: number): number | null {
  return mapBriefOf(world)?.seats.find((s) => s.player === owner)?.component ?? null;
}

/** The points of the enemy fighters the seat sees, by the land they stand on. */
type LandFighters = ReadonlyMap<number, number>;

function landFighters(env: OperationEnv): LandFighters {
  const { world, ctx, terrain, seat } = env;
  const byLand = new Map<number, number>();
  for (const f of visibleEnemyFighters(world, ctx, seat)) {
    const land = landOfPoint(terrain, f.at);
    if (land !== NO_COMPONENT) byLand.set(land, (byLand.get(land) ?? 0) + f.points);
  }
  return byLand;
}

type Objective = NonNullable<ReturnType<typeof landingObjective>>;

/**
 * What the seat believes defends `goal` on `believed`, the fire there included. On a land holding a
 * headquarters, or `owner`'s start land, where his army stands even once it fell: his army
 * ({@link ArmyWeights}) and {@link RAID_TOWER_DEFENCE} for each tower covering the objective. On a colony:
 * those towers with the posts last seen on them ({@link defenceAt}), and the enemy fighters it sees on the
 * land, at least the
 * most of `owner`'s it ever saw there at once ({@link rememberedLandPoints}), so a raid that met the
 * garrison and turned back weighs it next time. `fighters` is read when absent.
 */
function stormDefence(
  env: OperationEnv,
  believed: BelievedLand,
  land: number,
  owner: number | null,
  goal: Objective,
  armies: ArmyWeights,
  fighters?: LandFighters,
): number {
  const { world, ctx, seat } = env;
  const towers = towersReaching(believed.sources, goal.at);
  const headquarters =
    believed.targets.find((t) => buildingCombatClass(ctx, t.buildingType) === 'hq') ?? null;
  let army = 0;
  if (owner !== null && (headquarters !== null || startLandOf(world, owner) === land)) {
    army = armies(owner) + towers.length * RAID_TOWER_DEFENCE;
  } else {
    const remembered = owner === null ? 0 : rememberedLandPoints(world, seat, owner, land);
    army = Math.max((fighters ?? landFighters(env)).get(land) ?? 0, remembered);
    army += defenceAt({ towers, fighters: [] }, goal.at);
  }
  const target = believed.targets.find((t) => t.entity === goal.entity) ?? null;
  return army + fireAt(env, believed, goal.at, tribeOf(env, target ?? headquarters));
}

/**
 * A raid on a rival's colony: the strongest of `room`, as many as set ashore ({@link pointsAshore}) reach
 * {@link LANDING_EDGE} (or `ratio` when larger) over the {@link stormDefence} of a clear objective, or
 * {@link LANDING_STORM_EDGE} over that of a covered one, at least {@link COLONY_RAID_LEAST_MEN}, all within
 * its seats; null when the men at home cannot.
 */
function colonyAim(
  env: OperationEnv,
  c: Candidate,
  room: WaveRoom,
  ratio: Share,
  armies: ArmyWeights,
  fighters: LandFighters,
): LandingAim | null {
  const clear = landingObjective(env.ctx, c.believed, c.towards.at);
  const goal = clear ?? landingObjective(env.ctx, c.believed, c.towards.at, true);
  if (goal === null) return null;
  const edge = atLeast(ratio, clear === null ? LANDING_STORM_EDGE : LANDING_EDGE);
  const opposing = stormDefence(env, c.believed, c.land, c.owner, goal, armies, fighters);
  const reached = (count: number): boolean =>
    count >= COLONY_RAID_LEAST_MEN &&
    launchRatioReached(pointsAshore(room.prefix, count, room.ships), opposing, edge);
  let count = 0;
  while (!reached(count)) {
    if (count >= Math.min(room.ranked.length, room.seats)) return null;
    count++;
  }
  return {
    land: c.land,
    owner: c.owner,
    towards: c.towards.at,
    entity: c.towards.entity,
    believed: c.believed,
    men: room.ranked.slice(0, count).map((m) => m.entity),
  };
}

/**
 * The objective men landed on `believed` and standing at `from` storm when nothing there lies clear, or
 * null: the storm's objective while their `points` hold {@link LANDING_STORM_HOLD_EDGE} over its
 * {@link stormDefence}.
 */
export function stormObjective(
  env: OperationEnv,
  believed: BelievedLand,
  land: number,
  owner: number | null,
  from: HalfCellNode,
  points: number,
): Objective | null {
  const goal = landingObjective(env.ctx, believed, from, true);
  if (goal === null) return null;
  const defence = stormDefence(env, believed, land, owner, goal, armyWeights(env));
  return launchRatioReached(points, defence, LANDING_STORM_HOLD_EDGE) ? goal : null;
}
