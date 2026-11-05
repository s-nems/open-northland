import { Building } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import { type HalfCellNode, nodeManhattan } from '../../../../nav/halfcell.js';
import { TOWER_POST_STRENGTH } from '../../../ai-shared/military/census.js';
import { buildingCombatClass } from '../../../readviews/index.js';
import type { Share } from '../../difficulty.js';
import { peakFighterPoints } from '../../knowledge/intel/index.js';
import { knownDefendingPoints } from '../enemy-strength.js';
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
import { visibleEnemyFighters } from './raid-target.js';

// Where a landing sails and whom it takes (owner ruling): every land the seat believes holds an enemy
// building is a candidate, the lands of a rival's headquarters first, where the whole wave goes, then his
// colonies, raided by a band sized to the defence the seat has seen there. A landing that clearly outweighs
// what defends a settlement storms it even where towers cover every building. Every figure is authored.

/** The least a landing outweighs what the seat believes defends its target when no building there lies
 *  clear of the towers and shelters ({@link stormDefence}). Authored: twice, so a wave that loses half its
 *  men to the towers on the way in still holds its edge. */
export const LANDING_STORM_EDGE: Share = { num: 2, den: 1 };

/** What one tower covering a storm's objective weighs beside its garrison: the walls the wave must fell
 *  under its fire. Authored: about a dozen armed men of the island maps' late game. */
export const STORM_TOWER_POINTS = 1000;

/** The least a landing outweighs the believed defence of a target clear of every tower: the edge of
 *  `landing.ts` for a known army. Authored: observed on arabskie_wyspy_wolna_gra_mieszana, a landing at
 *  parity with a rival's soldiers all fell within minutes for far fewer of his. */
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
  /** The rival's headquarters stands on the land: the whole wave goes. Else it is a colony raid. */
  readonly headquarters: boolean;
  /** Where the ships seek their shores: the headquarters, else the building nearest the seat. */
  readonly towards: HalfCellNode;
  /** The building at {@link towards}, null for a relief, which heads for a band. */
  readonly entity: Entity | null;
  readonly believed: BelievedLand;
  /** No building there lies clear: the landing strikes covered ground ({@link landingObjective}). */
  readonly storm: boolean;
  /** The wave, strongest first. */
  readonly men: readonly Entity[];
}

/** What the ships the landing may take hold. */
export interface LandingRoom {
  /** The seats of every free ship. */
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
 * The land the seat lands on and the wave it sends, or null while no land is worth it: the candidates
 * ({@link candidatesOf}) in turn, each rival's headquarters land first, nearest `from` first, then the
 * colonies the same way; the first the `ranked` men can take within `room` wins. On a headquarters land the
 * whole wave goes once `ratio` (the posture's launch edge) holds over the believed defence; on a colony the
 * strongest men go, as many as outweigh the defence seen there by {@link LANDING_EDGE}, at least
 * {@link COLONY_RAID_LEAST_MEN}. Costs the believed buildings and, with a colony to weigh, the enemies'
 * fighters.
 */
export function landingAim(
  env: OperationEnv,
  home: number,
  from: HalfCellNode,
  ranked: readonly RankedMan[],
  ratio: Share,
  room: LandingRoom,
): LandingAim | null {
  let fighters: LandFighters | null = null;
  for (const c of candidatesOf(env, home, from)) {
    if (c.headquarters !== null) {
      if (!room.bigLanding) continue;
      const aim = headquartersAim(env, c, ranked.slice(0, room.seats), ratio);
      if (aim !== null) return aim;
      continue;
    }
    fighters ??= landFighters(env);
    const aim = colonyAim(env, c, ranked, ratio, room.seats, fighters);
    if (aim !== null) return aim;
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

function pointsOf(men: readonly RankedMan[]): number {
  let points = 0;
  for (const m of men) points += m.points;
  return points;
}

/** The tribe whose house bow a believed building's shelter fires, read off the building while it stands. */
function tribeOf(env: OperationEnv, target: BelievedTarget | null): number | undefined {
  return target === null ? undefined : env.world.tryGet(target.entity, Building)?.tribe;
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
 * {@link LANDING_EDGE} against an army the seat knows, of the believed army plus the fire there (an unknown
 * army counts at parity, so the fire alone must not outweigh it); with none clear, it storms once it reaches
 * {@link LANDING_STORM_EDGE} over the {@link stormDefence}.
 */
function headquartersAim(
  env: OperationEnv,
  c: Candidate,
  wave: readonly RankedMan[],
  ratio: Share,
): LandingAim | null {
  const { ctx } = env;
  if (wave.length === 0) return null;
  const points = pointsOf(wave);
  const aim = (storm: boolean): LandingAim => ({
    land: c.land,
    owner: c.owner,
    headquarters: true,
    towards: c.towards.at,
    entity: c.towards.entity,
    believed: c.believed,
    storm,
    men: wave.map((m) => m.entity),
  });
  const clear = landingObjective(ctx, c.believed, c.towards.at);
  if (clear !== null) {
    const known = landingArmy(env, c.owner);
    const edge = known === null ? ratio : atLeast(ratio, LANDING_EDGE);
    const fire = fireAt(env, c.believed, clear.at, tribeOf(env, c.headquarters));
    const opposing = known === null ? Math.max(points, fire) : known + fire;
    return launchRatioReached(points, opposing, edge) ? aim(false) : null;
  }
  const storm = landingObjective(ctx, c.believed, c.towards.at, true);
  if (storm === null) return null;
  const opposing = stormDefence(env, c.believed, c.land, c.owner, storm);
  return launchRatioReached(points, opposing, atLeast(ratio, LANDING_STORM_EDGE)) ? aim(true) : null;
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

/** The points of the enemy fighters the seat sees, by the land they stand on. */
type LandFighters = ReadonlyMap<number, number>;

function landFighters(env: OperationEnv): LandFighters {
  const { world, ctx, terrain, seat } = env;
  const byLand = new Map<number, number>();
  for (const f of visibleEnemyFighters(world, ctx, seat)) {
    if (!terrain.inBounds(f.at.hx, f.at.hy)) continue;
    const land = terrain.componentOf(terrain.nodeAt(f.at.hx, f.at.hy));
    byLand.set(land, (byLand.get(land) ?? 0) + f.points);
  }
  return byLand;
}

type Objective = NonNullable<ReturnType<typeof landingObjective>>;

/**
 * What the seat believes defends `goal` on `believed`, the fire there included: on a land holding a
 * headquarters, its owner's known army (none while unknown: the seat has seen nothing of it) and
 * {@link STORM_TOWER_POINTS} for each tower covering the objective; on a colony, those towers with the posts
 * last seen on them and the enemy fighters it sees on the land. `fighters` is read when absent.
 */
function stormDefence(
  env: OperationEnv,
  believed: BelievedLand,
  land: number,
  owner: number | null,
  goal: Objective,
  fighters?: LandFighters,
): number {
  const { ctx } = env;
  const towers = towersReaching(believed.sources, goal.at);
  const headquarters =
    believed.targets.find((t) => buildingCombatClass(ctx, t.buildingType) === 'hq') ?? null;
  let army = 0;
  if (headquarters !== null && owner !== null) {
    army = (landingArmy(env, owner) ?? 0) + towers.length * STORM_TOWER_POINTS;
  } else {
    army = (fighters ?? landFighters(env)).get(land) ?? 0;
    for (const t of towers) army += STORM_TOWER_POINTS + t.postedPoints * TOWER_POST_STRENGTH;
  }
  const target = believed.targets.find((t) => t.entity === goal.entity) ?? null;
  return army + fireAt(env, believed, goal.at, tribeOf(env, target ?? headquarters));
}

/**
 * A raid on a rival's colony: the strongest of `ranked`, as many as reach {@link LANDING_EDGE} (or `ratio`
 * when larger) over the enemy fighters seen on the land and the fire at a clear objective, or
 * {@link LANDING_STORM_EDGE} over the {@link stormDefence} of a covered one, at least
 * {@link COLONY_RAID_LEAST_MEN}, all within `seats`; null when the men at home cannot.
 */
function colonyAim(
  env: OperationEnv,
  c: Candidate,
  ranked: readonly RankedMan[],
  ratio: Share,
  seats: number,
  fighters: LandFighters,
): LandingAim | null {
  const clear = landingObjective(env.ctx, c.believed, c.towards.at);
  const goal = clear ?? landingObjective(env.ctx, c.believed, c.towards.at, true);
  if (goal === null) return null;
  const edge = atLeast(ratio, clear === null ? LANDING_STORM_EDGE : LANDING_EDGE);
  const opposing = stormDefence(env, c.believed, c.land, null, goal, fighters);
  const wave: Entity[] = [];
  let points = 0;
  for (const m of ranked) {
    if (wave.length >= COLONY_RAID_LEAST_MEN && launchRatioReached(points, opposing, edge)) break;
    if (wave.length >= seats) return null;
    wave.push(m.entity);
    points += m.points;
  }
  if (wave.length < COLONY_RAID_LEAST_MEN || !launchRatioReached(points, opposing, edge)) return null;
  return {
    land: c.land,
    owner: c.owner,
    headquarters: false,
    towards: c.towards.at,
    entity: c.towards.entity,
    believed: c.believed,
    storm: clear === null,
    men: wave,
  };
}

/**
 * The objective men landed on `believed` and standing at `from` storm when nothing there lies clear, or
 * null: the storm's objective once their `points` reach {@link LANDING_STORM_EDGE} over its
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
  return launchRatioReached(points, stormDefence(env, believed, land, owner, goal), LANDING_STORM_EDGE)
    ? goal
    : null;
}
